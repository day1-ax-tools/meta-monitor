# Meta Guardian

Meta Guardian is a local companion for AI CLI sessions. It observes visible main-session events, builds a schema-shaped guardian input, and writes guardian-level advice for the user.

It is intentionally separate from onboarding. Onboarding teaches users how to install AI CLI tools, connect GitHub, define work, and build mission backlogs. Meta Guardian is the optional runtime layer that watches long-running work after the user explicitly enables it.

## What It Does

- Reads visible main-session events from `meta-guardian/main-session-events.jsonl`.
- Builds `meta-guardian/guardian-input.latest.json` using `meta-guardian/guardian-input.schema.json`.
- Uses `meta-guardian/guardian-prompt.md` to produce a guardian-level explanation.
- Writes the latest advice to `meta-guardian/guardian-advice.md`.
- Serves `meta-guardian/guardian-board.html` through a local bridge at `http://127.0.0.1:8787/`.
- Keeps guardian writes scoped to `meta-guardian/**`.

It does not read hidden model reasoning or private chain-of-thought.

## Install Into A Target Repo

From this repo:

```bash
cp -R meta-guardian /path/to/target-repo/
cd /path/to/target-repo
cp meta-guardian/settings.example.json meta-guardian/settings.json
```

In the target repo, append visible main-session events to:

```text
meta-guardian/main-session-events.jsonl
```

Then start the bridge and worker in separate terminals:

```bash
node meta-guardian/bridge-server.mjs
node meta-guardian/guardian-worker.mjs
```

Open:

```text
http://127.0.0.1:8787/
```

## Main Session Event

Each line in `meta-guardian/main-session-events.jsonl` is one JSON object. Use compact, visible, reference-heavy events.

```json
{
  "eventId": "main-001",
  "timestamp": "2026-06-02T00:00:00Z",
  "turnId": "turn-001",
  "role": "user",
  "eventType": "user-request",
  "visibility": "visible",
  "summary": "User asked to rename Meta Guardian and define guardian runtime boundary.",
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

- `meta-guardian/main-session-events.jsonl`
- `meta-guardian/guardian-advice.md`
- `meta-guardian/guardian-input.latest.json`
- `meta-guardian/guardian-state.json`
- `meta-guardian/questions.jsonl`
- `meta-guardian/session-data.jsonl`
- `meta-guardian/session-handoff.md`
- `meta-guardian/visualizations/`

## Repo Boundary

This repo owns the guardian runtime, schema, prompt, bridge, and guardian board. It does not own onboarding curriculum, Git/GitHub setup, work discovery interviews, or guardian backlog templates.
