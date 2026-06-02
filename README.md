# Meta Monitor

Meta Monitor is a local companion for AI CLI sessions. It observes visible main-session events, builds a schema-shaped monitor input, and writes meta-level advice for the user.

It is intentionally separate from onboarding. Onboarding teaches users how to install AI CLI tools, connect GitHub, define work, and build mission backlogs. Meta Monitor is the optional runtime layer that watches long-running work after the user explicitly enables it.

## What It Does

- Reads visible main-session events from `meta-monitor/main-session-events.jsonl`.
- Builds `meta-monitor/monitor-input.latest.json` using `meta-monitor/monitor-input.schema.json`.
- Uses `meta-monitor/monitor-prompt.md` to produce a meta-level explanation.
- Writes the latest advice to `meta-monitor/meta-advice.md`.
- Serves `meta-monitor/briefing-board.html` through a local bridge at `http://127.0.0.1:8787/`.
- Keeps monitor writes scoped to `meta-monitor/**`.

It does not read hidden model reasoning or private chain-of-thought.

## Install Into A Target Repo

From this repo:

```bash
cp -R meta-monitor /path/to/target-repo/
cd /path/to/target-repo
cp meta-monitor/settings.example.json meta-monitor/settings.json
```

In the target repo, append visible main-session events to:

```text
meta-monitor/main-session-events.jsonl
```

Then start the bridge and worker in separate terminals:

```bash
node meta-monitor/bridge-server.mjs
node meta-monitor/monitor-worker.mjs
```

Open:

```text
http://127.0.0.1:8787/
```

## Main Session Event

Each line in `meta-monitor/main-session-events.jsonl` is one JSON object. Use compact, visible, reference-heavy events.

```json
{
  "eventId": "main-001",
  "timestamp": "2026-06-02T00:00:00Z",
  "turnId": "turn-001",
  "role": "user",
  "eventType": "user-request",
  "visibility": "visible",
  "summary": "User asked to split onboarding and meta monitor into separate repos.",
  "content": "The visible user request or concise transcript excerpt.",
  "evidenceRefs": ["README.md"],
  "artifactsRead": [],
  "artifactsWritten": [],
  "commands": [],
  "decisions": [],
  "risks": [],
  "nextActions": []
}
```

## Scripts

```bash
npm run check
npm run bridge
npm run worker
```

## Runtime Files

These files are generated inside the target repo and are ignored in this source repo:

- `meta-monitor/main-session-events.jsonl`
- `meta-monitor/meta-advice.md`
- `meta-monitor/monitor-input.latest.json`
- `meta-monitor/monitor-state.json`
- `meta-monitor/questions.jsonl`
- `meta-monitor/session-data.jsonl`
- `meta-monitor/session-handoff.md`
- `meta-monitor/visualizations/`

## Repo Boundary

This repo owns the monitor runtime, schema, prompt, bridge, and briefing board. It does not own onboarding curriculum, Git/GitHub setup, work discovery interviews, or mission backlog templates.
