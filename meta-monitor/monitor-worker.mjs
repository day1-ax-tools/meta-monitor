import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";

const root = resolve(process.env.MONITOR_WORKER_ROOT || process.cwd());
const metaDir = join(root, "meta-monitor");
const settingsPath = join(metaDir, "settings.json");
const questionsPath = join(metaDir, "questions.jsonl");
const mainSessionEventsPath = join(metaDir, "main-session-events.jsonl");
const monitorPromptPath = join(metaDir, "monitor-prompt.md");
const monitorInputPath = join(metaDir, "monitor-input.latest.json");
const advicePath = join(metaDir, "meta-advice.md");
const statePath = join(metaDir, "monitor-state.json");
const sessionDataPath = join(metaDir, "session-data.jsonl");
const briefingBoardPath = join(metaDir, "briefing-board.html");
const intervalMs = Number(process.env.MONITOR_WORKER_INTERVAL_MS || 2500);
const processHistory = process.env.MONITOR_WORKER_PROCESS_HISTORY === "1";
const codexModelOverride = process.env.MONITOR_WORKER_CODEX_MODEL || "";

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function readText(path, fallback = "") {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
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

async function readJson(path, fallback) {
  const text = await readText(path, "");
  if (!text.trim()) {
    return fallback;
  }
  return JSON.parse(text);
}

async function readJsonl(path) {
  const text = await readText(path, "");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendSessionEvent(event) {
  await appendFile(sessionDataPath, `${JSON.stringify(event)}\n`, "utf8");
}

function defaultState() {
  return {
    version: 2,
    startedAt: new Date().toISOString(),
    processedQuestionIds: [],
    skippedQuestionIds: [],
    failedQuestionIds: [],
    processedObservationSignatures: [],
    failedObservationSignatures: [],
    lastQuestionId: "",
    lastObservationSignature: "",
    lastMainSessionEventId: "",
    lastMonitorMode: "",
    lastAnswerAt: "",
    worker: {
      provider: "openai",
      configuredModel: "gpt-5-codex",
      runtimeModel: codexModelOverride || "codex-cli-default",
      mode: "codex-exec-read-only"
    }
  };
}

function normalizeState(value) {
  const base = defaultState();
  const state = { ...base, ...value };
  state.processedQuestionIds = Array.isArray(state.processedQuestionIds) ? state.processedQuestionIds : [];
  state.skippedQuestionIds = Array.isArray(state.skippedQuestionIds) ? state.skippedQuestionIds : [];
  state.failedQuestionIds = Array.isArray(state.failedQuestionIds) ? state.failedQuestionIds : [];
  state.processedObservationSignatures = Array.isArray(state.processedObservationSignatures) ? state.processedObservationSignatures : [];
  state.failedObservationSignatures = Array.isArray(state.failedObservationSignatures) ? state.failedObservationSignatures : [];
  state.worker = { ...base.worker, ...(state.worker || {}) };
  return state;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function relativePath(filePath) {
  return relative(root, filePath) || ".";
}

async function artifactRef(filePath) {
  try {
    const stats = await stat(filePath);
    return {
      path: relativePath(filePath),
      exists: true,
      updatedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        path: relativePath(filePath),
        exists: false,
        updatedAt: ""
      };
    }
    throw error;
  }
}

async function runCommand(command, args) {
  return await new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolveRun({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      resolveRun({ code: 1, stdout, stderr: String(error) });
    });
  });
}

function ensureArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null).map(String) : [];
}

function normalizeMainSessionEvent(event, index) {
  const roles = new Set(["user", "main-assistant", "tool", "system-summary", "artifact"]);
  const eventTypes = new Set(["user-request", "assistant-response", "tool-summary", "artifact-change", "verification", "decision", "handoff"]);
  const visibilityValues = new Set(["visible", "exported-summary"]);

  return {
    eventId: String(event.eventId || event.id || `main-event-${index}`),
    timestamp: String(event.timestamp || new Date().toISOString()),
    turnId: String(event.turnId || event.turn || ""),
    role: roles.has(event.role) ? event.role : "system-summary",
    eventType: eventTypes.has(event.eventType) ? event.eventType : "tool-summary",
    visibility: visibilityValues.has(event.visibility) ? event.visibility : "visible",
    summary: String(event.summary || ""),
    content: String(event.content || ""),
    evidenceRefs: ensureArray(event.evidenceRefs),
    artifactsRead: ensureArray(event.artifactsRead),
    artifactsWritten: ensureArray(event.artifactsWritten),
    commands: ensureArray(event.commands),
    decisions: ensureArray(event.decisions),
    risks: ensureArray(event.risks),
    nextActions: ensureArray(event.nextActions)
  };
}

function normalizeManualQuestion(question) {
  return {
    id: String(question.id || ""),
    timestamp: String(question.timestamp || ""),
    source: String(question.source || "briefing-board"),
    question: String(question.question || "")
  };
}

function normalizeLanguage(settings) {
  return {
    current: settings.language?.current || "ko",
    fallback: settings.language?.fallback || "en",
    source: settings.language?.source || "main-session-input"
  };
}

function mainSessionSettings(settings) {
  return {
    provider: settings.design?.provider || settings.provider || "openai",
    model: settings.mainSession?.model || settings.model || "gpt-5-codex",
    sessionId: settings.mainSession?.sessionId || "main-session",
    description: settings.mainSession?.description || "Visible main AI CLI onboarding session"
  };
}

function observationSignature(events) {
  return sha256(JSON.stringify(events.map((event) => ({
    eventId: event.eventId,
    timestamp: event.timestamp,
    summary: event.summary,
    content: event.content
  }))));
}

async function buildMonitorInput(workItem, settings) {
  const generatedAt = new Date().toISOString();
  const [gitStatus, gitDiffStat, branchResult, remoteResult, questions, allMainEvents, advice, artifacts] = await Promise.all([
    runCommand("git", ["status", "--short"]),
    runCommand("git", ["diff", "--stat"]),
    runCommand("git", ["branch", "--show-current"]),
    runCommand("git", ["remote", "get-url", "origin"]),
    readJsonl(questionsPath).catch(() => []),
    readJsonl(mainSessionEventsPath).catch(() => []),
    readTextWithMtime(advicePath),
    Promise.all([
      artifactRef(settingsPath),
      artifactRef(briefingBoardPath),
      artifactRef(advicePath),
      artifactRef(statePath),
      artifactRef(sessionDataPath),
      artifactRef(mainSessionEventsPath),
      artifactRef(monitorPromptPath)
    ])
  ]);

  const mainSessionEvents = (workItem.mainSessionEvents || allMainEvents.slice(-12))
    .map((event, index) => normalizeMainSessionEvent(event, index));
  const manualQuestions = questions.slice(-8).map(normalizeManualQuestion);
  const [
    settingsArtifact,
    briefingBoardArtifact,
    metaAdviceArtifact,
    monitorStateArtifact,
    sessionDataArtifact,
    mainSessionEventsArtifact,
    monitorPromptArtifact
  ] = artifacts;

  return {
    version: 1,
    generatedAt,
    repo: {
      root,
      remote: remoteResult.stdout.trim(),
      branch: branchResult.stdout.trim()
    },
    language: normalizeLanguage(settings),
    monitorMode: workItem.monitorMode,
    mainSession: mainSessionSettings(settings),
    sourcePolicy: {
      allowedSources: [
        "meta-monitor/main-session-events.jsonl",
        "visible main-session transcript/export when available",
        "repo files",
        "git status --short",
        "git diff --stat"
      ],
      excludedSources: [
        "hidden model reasoning",
        "private chain-of-thought",
        "unstored assumptions"
      ],
      writeScope: Array.isArray(settings.writeScope) ? settings.writeScope : ["meta-monitor/**"]
    },
    mainSessionEvents,
    manualQuestions,
    repoSignals: {
      gitStatusShort: gitStatus.stdout.trim(),
      gitDiffStat: gitDiffStat.stdout.trim()
    },
    artifacts: {
      settings: settingsArtifact,
      briefingBoard: briefingBoardArtifact,
      metaAdvice: metaAdviceArtifact,
      monitorState: monitorStateArtifact,
      sessionData: sessionDataArtifact,
      mainSessionEvents: mainSessionEventsArtifact,
      monitorInput: {
        path: relativePath(monitorInputPath),
        exists: true,
        updatedAt: generatedAt
      },
      monitorPrompt: monitorPromptArtifact
    },
    previousAdvice: {
      exists: advice.exists,
      updatedAt: advice.updatedAt,
      preview: advice.text.slice(0, 1600)
    }
  };
}

function defaultPromptTemplate() {
  return `You are the meta monitor for this repo.

Use the monitor input JSON below. Prefer main-session events over manual questions. Do not use hidden model reasoning.

Return concise Korean advice with these sections:
- What Happened
- Meta Explanation
- Current Risk
- Next Best Action
- Evidence

\`\`\`json
{{MONITOR_INPUT_JSON}}
\`\`\`
`;
}

function renderPrompt(template, packet) {
  const inputJson = JSON.stringify(packet, null, 2);
  if (template.includes("{{MONITOR_INPUT_JSON}}")) {
    return template.replace("{{MONITOR_INPUT_JSON}}", inputJson);
  }
  return `${template.trim()}\n\nMonitor input JSON:\n\`\`\`json\n${inputJson}\n\`\`\`\n`;
}

async function runCodexAnswer(prompt) {
  const outputPath = join(metaDir, ".codex-answer.tmp");
  await writeFile(outputPath, "", "utf8");
  const args = [
    "exec",
    "-C",
    root,
    "-s",
    "read-only",
    "--ephemeral",
    "-o",
    outputPath,
    "-"
  ];
  if (codexModelOverride) {
    args.splice(args.indexOf("-o"), 0, "-m", codexModelOverride);
  }

  return await new Promise((resolveRun) => {
    const child = spawn("codex", args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      process.stderr.write(chunk);
    });
    child.on("close", async (code) => {
      const finalText = await readText(outputPath, stdout.trim());
      resolveRun({ code, stdout, stderr, finalText: finalText.trim() });
    });
    child.on("error", (error) => {
      resolveRun({ code: 1, stdout, stderr: `${stderr}\n${String(error)}`, finalText: "" });
    });
    child.stdin.end(prompt);
  });
}

function formatAdvice(workItem, packet, answer, settings) {
  const answeredAt = new Date().toISOString();
  const sourceEventIds = packet.mainSessionEvents.map((event) => event.eventId).join(", ") || "none";
  const manualQuestion = workItem.question ? `${workItem.question.id} / ${workItem.question.question}` : "none";

  return `# Meta Monitor Advice

- Mode: ${workItem.monitorMode}
- Source event IDs: ${sourceEventIds}
- Manual question: ${manualQuestion}
- Input file: meta-monitor/monitor-input.latest.json
- Answered at: ${answeredAt}
- Provider: ${settings.provider || "openai"}
- Configured model: ${settings.model || "gpt-5-codex"}
- Runtime model: ${codexModelOverride || "codex-cli-default"}
- Write scope: meta-monitor/** only

## Monitor Output

${answer || "답변을 생성하지 못했습니다."}
`;
}

function workItemRef(workItem) {
  if (workItem.kind === "main-session-observation") {
    return workItem.sourceEventIds.join(",") || workItem.observationSignature;
  }
  return workItem.question?.id || "";
}

function workItemLabel(workItem) {
  if (workItem.kind === "main-session-observation") {
    return `main-session observation ${workItem.observationSignature}`;
  }
  return `manual question ${workItem.question.id}`;
}

async function markWorkItemFailed(workItem, state) {
  if (workItem.kind === "main-session-observation") {
    state.failedObservationSignatures = unique([...state.failedObservationSignatures, workItem.observationSignature]);
    state.lastObservationSignature = workItem.observationSignature;
    state.lastMainSessionEventId = workItem.sourceEventIds.at(-1) || "";
  } else {
    state.failedQuestionIds = unique([...state.failedQuestionIds, workItem.question.id]);
    state.lastQuestionId = workItem.question.id;
  }
  state.lastMonitorMode = workItem.monitorMode;
  await writeJson(statePath, state);
}

async function markWorkItemProcessed(workItem, state, settings, answeredAt) {
  if (workItem.kind === "main-session-observation") {
    state.processedObservationSignatures = unique([...state.processedObservationSignatures, workItem.observationSignature]);
    state.failedObservationSignatures = state.failedObservationSignatures.filter((signature) => signature !== workItem.observationSignature);
    state.lastObservationSignature = workItem.observationSignature;
    state.lastMainSessionEventId = workItem.sourceEventIds.at(-1) || "";
  } else {
    state.processedQuestionIds = unique([...state.processedQuestionIds, workItem.question.id]);
    state.failedQuestionIds = state.failedQuestionIds.filter((id) => id !== workItem.question.id);
    state.lastQuestionId = workItem.question.id;
  }
  state.lastMonitorMode = workItem.monitorMode;
  state.lastAnswerAt = answeredAt;
  state.worker = {
    provider: settings.provider || "openai",
    configuredModel: settings.model || "gpt-5-codex",
    runtimeModel: codexModelOverride || "codex-cli-default",
    mode: "codex-exec-read-only"
  };
  await writeJson(statePath, state);
}

async function processWorkItem(workItem, state, settings) {
  console.log(`[monitor-worker] processing ${workItemLabel(workItem)}`);
  const packet = await buildMonitorInput(workItem, settings);
  await writeJson(monitorInputPath, packet);

  const promptTemplate = await readText(monitorPromptPath, defaultPromptTemplate());
  const result = await runCodexAnswer(renderPrompt(promptTemplate, packet));

  if (result.code !== 0 || !result.finalText) {
    const failedAt = new Date().toISOString();
    await markWorkItemFailed(workItem, state);
    await writeFile(
      advicePath,
      formatAdvice(
        workItem,
        packet,
        `모니터 답변 생성에 실패했습니다.\n\n\`\`\`text\n${result.stderr || result.stdout || "unknown error"}\n\`\`\``,
        settings
      ),
      "utf8"
    );
    await appendSessionEvent({
      timestamp: failedAt,
      sessionRole: "monitor",
      eventType: "answer_failed",
      contextUsageRatio: 0,
      sourcesRead: ["meta-monitor/main-session-events.jsonl", "meta-monitor/questions.jsonl", "meta-monitor/settings.json", "meta-monitor/monitor-prompt.md", "git status --short", "git diff --stat"],
      artifactsWritten: ["meta-monitor/meta-advice.md", "meta-monitor/monitor-input.latest.json", "meta-monitor/monitor-state.json", "meta-monitor/session-data.jsonl"],
      questionRef: workItemRef(workItem),
      answerRef: "meta-monitor/meta-advice.md",
      valueSignals: ["monitor worker attempted to process schema-shaped input"],
      featureCandidates: ["monitor worker retry policy", "main-session event capture"]
    });
    return;
  }

  const answer = formatAdvice(workItem, packet, result.finalText, settings);
  const tmpAdvicePath = join(metaDir, ".meta-advice.tmp");
  await writeFile(tmpAdvicePath, answer, "utf8");
  await rename(tmpAdvicePath, advicePath);

  const answeredAt = new Date().toISOString();
  await markWorkItemProcessed(workItem, state, settings, answeredAt);
  await appendSessionEvent({
    timestamp: answeredAt,
    sessionRole: "monitor",
    eventType: workItem.kind === "main-session-observation" ? "observe" : "answer",
    contextUsageRatio: 0,
    sourcesRead: ["meta-monitor/main-session-events.jsonl", "meta-monitor/questions.jsonl", "meta-monitor/settings.json", "meta-monitor/monitor-prompt.md", "git status --short", "git diff --stat"],
    artifactsWritten: ["meta-monitor/meta-advice.md", "meta-monitor/monitor-input.latest.json", "meta-monitor/monitor-state.json", "meta-monitor/session-data.jsonl"],
    questionRef: workItemRef(workItem),
    answerRef: "meta-monitor/meta-advice.md",
    valueSignals: [workItem.kind === "main-session-observation" ? "main session event flow explained by read-only monitor worker" : "manual question answered by read-only monitor worker"],
    featureCandidates: ["schema-shaped monitor input", "main-session event observer"]
  });
  console.log(`[monitor-worker] wrote meta-monitor/meta-advice.md for ${workItemLabel(workItem)}`);
}

async function nextQuestion(state) {
  const questions = await readJsonl(questionsPath).catch(() => []);
  if (questions.length === 0) {
    return null;
  }

  if (!existsSync(statePath) && !processHistory && questions.length > 1) {
    const historical = questions.slice(0, -1).map((question) => question.id);
    state.skippedQuestionIds = unique([...state.skippedQuestionIds, ...historical]);
    await writeJson(statePath, state);
    console.log(`[monitor-worker] skipped ${historical.length} historical question(s); set MONITOR_WORKER_PROCESS_HISTORY=1 to process all`);
  }

  const handled = new Set([
    ...state.processedQuestionIds,
    ...state.skippedQuestionIds,
    ...state.failedQuestionIds
  ]);
  const question = questions.find((candidate) => !handled.has(candidate.id));
  if (!question) {
    return null;
  }
  return {
    kind: "manual-question",
    id: `question:${question.id}`,
    monitorMode: "answer-manual-question",
    question: normalizeManualQuestion(question),
    mainSessionEvents: []
  };
}

async function nextWorkItem(state) {
  const allMainEvents = (await readJsonl(mainSessionEventsPath).catch(() => []))
    .map((event, index) => normalizeMainSessionEvent(event, index));

  if (allMainEvents.length > 0) {
    const recentEvents = allMainEvents.slice(-12);
    const signature = observationSignature(recentEvents);
    const handled = new Set([
      ...state.processedObservationSignatures,
      ...state.failedObservationSignatures
    ]);
    if (!handled.has(signature)) {
      return {
        kind: "main-session-observation",
        id: `main-session:${signature}`,
        monitorMode: "observe-main-session",
        observationSignature: signature,
        sourceEventIds: recentEvents.map((event) => event.eventId),
        mainSessionEvents: recentEvents
      };
    }
  }

  return await nextQuestion(state);
}

async function main() {
  await mkdir(metaDir, { recursive: true });
  let state = normalizeState(await readJson(statePath, defaultState()).catch(() => defaultState()));
  console.log(`[monitor-worker] watching ${mainSessionEventsPath}`);
  console.log(`[monitor-worker] secondary question queue ${questionsPath}`);
  console.log(`[monitor-worker] writing latest advice to ${advicePath}`);

  while (true) {
    const settings = await readJson(settingsPath, {
      provider: "openai",
      model: "gpt-5-codex",
      language: { current: "ko", fallback: "en", source: "main-session-input" }
    });
    state = normalizeState(await readJson(statePath, state).catch(() => state));
    const workItem = await nextWorkItem(state);
    if (workItem) {
      await processWorkItem(workItem, state, settings);
    }
    await sleep(intervalMs);
  }
}

main().catch(async (error) => {
  console.error("[monitor-worker] fatal", error);
  await appendSessionEvent({
    timestamp: new Date().toISOString(),
    sessionRole: "monitor",
    eventType: "worker_fatal",
    contextUsageRatio: 0,
    sourcesRead: ["meta-monitor/main-session-events.jsonl", "meta-monitor/questions.jsonl", "meta-monitor/settings.json"],
    artifactsWritten: ["meta-monitor/session-data.jsonl"],
    questionRef: "",
    answerRef: "",
    valueSignals: [],
    featureCandidates: ["monitor worker error recovery"],
    error: String(error?.stack || error)
  });
  process.exit(1);
});
