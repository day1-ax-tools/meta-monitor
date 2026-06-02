import { createServer } from "node:http";
import { mkdir, readFile, appendFile, stat } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const root = resolve(process.env.MONITOR_BRIDGE_ROOT || process.cwd());
const port = Number(process.env.MONITOR_BRIDGE_PORT || 8787);
const host = process.env.MONITOR_BRIDGE_HOST || "127.0.0.1";
const metaDir = join(root, "meta-monitor");
const boardPath = join(metaDir, "briefing-board.html");
const questionQueuePath = join(metaDir, "questions.jsonl");
const mainSessionEventsPath = join(metaDir, "main-session-events.jsonl");
const monitorInputPath = join(metaDir, "monitor-input.latest.json");
const sessionDataPath = join(metaDir, "session-data.jsonl");
const metaAdvicePath = join(metaDir, "meta-advice.md");
const eventClients = new Set();
let lastSnapshotSignature = "";

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

function event(res, name, payload) {
  res.write(`event: ${name}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function safeStaticPath(pathname) {
  const normalized = normalize(pathname).replace(/^\/+/, "");
  const requested = pathname === "/" ? boardPath : join(root, normalized);
  const resolved = resolve(requested);
  return resolved === root || resolved.startsWith(root + sep) ? resolved : null;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readTextWithMtime(filePath) {
  try {
    const [body, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    return {
      exists: true,
      text: body,
      updatedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, text: "", updatedAt: "" };
    }
    throw error;
  }
}

function latestJsonLine(body) {
  const lines = body.trim().split("\n").filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Ignore malformed historical lines and keep looking for the latest valid event.
    }
  }
  return null;
}

async function monitorSnapshot() {
  const [queue, mainEvents, monitorInput, advice] = await Promise.all([
    readTextWithMtime(questionQueuePath),
    readTextWithMtime(mainSessionEventsPath),
    readTextWithMtime(monitorInputPath),
    readTextWithMtime(metaAdvicePath)
  ]);

  return {
    ok: true,
    latestQuestion: queue.exists ? latestJsonLine(queue.text) : null,
    latestMainSessionEvent: mainEvents.exists ? latestJsonLine(mainEvents.text) : null,
    queue: {
      path: "meta-monitor/questions.jsonl",
      exists: queue.exists,
      updatedAt: queue.updatedAt
    },
    mainSessionEvents: {
      path: "meta-monitor/main-session-events.jsonl",
      exists: mainEvents.exists,
      updatedAt: mainEvents.updatedAt
    },
    monitorInput: {
      path: "meta-monitor/monitor-input.latest.json",
      exists: monitorInput.exists,
      updatedAt: monitorInput.updatedAt
    },
    advice: {
      path: "meta-monitor/meta-advice.md",
      exists: advice.exists,
      updatedAt: advice.updatedAt,
      text: advice.text
    }
  };
}

async function handleMonitorOutput(_req, res) {
  json(res, 200, await monitorSnapshot());
}

function snapshotSignature(snapshot) {
  return JSON.stringify({
    latestQuestionId: snapshot.latestQuestion?.id || "",
    latestMainSessionEventId: snapshot.latestMainSessionEvent?.eventId || "",
    queueUpdatedAt: snapshot.queue.updatedAt || "",
    mainSessionEventsUpdatedAt: snapshot.mainSessionEvents.updatedAt || "",
    monitorInputUpdatedAt: snapshot.monitorInput.updatedAt || "",
    adviceUpdatedAt: snapshot.advice.updatedAt || "",
    adviceTextLength: snapshot.advice.text.length
  });
}

async function broadcastSnapshot(force = false) {
  if (eventClients.size === 0) {
    return;
  }
  const snapshot = await monitorSnapshot();
  const signature = snapshotSignature(snapshot);
  if (!force && signature === lastSnapshotSignature) {
    return;
  }
  lastSnapshotSignature = signature;
  for (const client of eventClients) {
    try {
      event(client, "snapshot", snapshot);
    } catch {
      eventClients.delete(client);
    }
  }
}

async function handleEvents(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write(": connected\n\n");
  eventClients.add(res);
  event(res, "hello", {
    ok: true,
    stream: "/api/events",
    queue: "meta-monitor/questions.jsonl",
    mainSessionEvents: "meta-monitor/main-session-events.jsonl",
    monitorInput: "meta-monitor/monitor-input.latest.json",
    output: "meta-monitor/meta-advice.md"
  });
  event(res, "snapshot", await monitorSnapshot());
  req.on("close", () => {
    eventClients.delete(res);
  });
}

async function handleQuestion(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  const question = String(payload.question || "").trim();
  if (!question) {
    json(res, 400, { ok: false, error: "empty_question" });
    return;
  }

  const event = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source: payload.source || "briefing-board",
    question
  };
  const sessionEvent = {
    timestamp: event.timestamp,
    sessionRole: "monitor",
    eventType: "question",
    contextUsageRatio: 0,
    sourcesRead: ["meta-monitor/briefing-board.html"],
    artifactsWritten: ["meta-monitor/questions.jsonl", "meta-monitor/session-data.jsonl"],
    questionRef: event.id,
    answerRef: "",
    valueSignals: ["question submitted from Briefing Board"],
    featureCandidates: []
  };

  await mkdir(metaDir, { recursive: true });
  await appendFile(questionQueuePath, `${JSON.stringify(event)}\n`, "utf8");
  await appendFile(sessionDataPath, `${JSON.stringify(sessionEvent)}\n`, "utf8");
  await broadcastSnapshot(true);
  json(res, 200, { ok: true, id: event.id, queuedAt: event.timestamp });
}

setInterval(() => {
  broadcastSnapshot(false).catch((error) => {
    console.error("event broadcast failed", error);
  });
}, 1000);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        queue: "meta-monitor/questions.jsonl",
        mainSessionEvents: "meta-monitor/main-session-events.jsonl",
        monitorInput: "meta-monitor/monitor-input.latest.json",
        output: "meta-monitor/meta-advice.md",
        events: "/api/events"
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/monitor-output") {
      await handleMonitorOutput(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      await handleEvents(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/questions") {
      await handleQuestion(req, res);
      return;
    }
    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    const filePath = safeStaticPath(url.pathname);
    if (!filePath) {
      text(res, 403, "forbidden");
      return;
    }
    const body = await readFile(filePath);
    const contentType = filePath.endsWith(".html")
      ? "text/html; charset=utf-8"
      : "application/octet-stream";
    text(res, 200, body, contentType);
  } catch (error) {
    if (error?.code === "ENOENT") {
      text(res, 404, "not found");
      return;
    }
    json(res, 500, { ok: false, error: "internal_error" });
  }
});

server.listen(port, host, () => {
  console.log(`Meta monitor bridge: http://${host}:${port}/`);
  console.log("Question queue: meta-monitor/questions.jsonl");
});
