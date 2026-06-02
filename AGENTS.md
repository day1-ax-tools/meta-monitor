# AGENTS.md

## Role

You maintain the Meta Monitor runtime repository.

This repo owns the monitor bridge, worker, briefing board, input schema, prompt contract, and installable `meta-monitor/` folder. It does not own AI CLI onboarding curriculum, Git/GitHub setup lessons, work discovery interviews, or mission backlog content.

Use concise polite Korean by default when answering the user.

## Boundaries

- Keep source files in `meta-monitor/` reusable across target repos.
- Do not commit target-repo runtime data such as `main-session-events.jsonl`, `meta-advice.md`, `monitor-input.latest.json`, `monitor-state.json`, `questions.jsonl`, `session-data.jsonl`, or `session-handoff.md`.
- Keep the monitor write boundary inside target repos as `meta-monitor/**`.
- Do not design the monitor around hidden model reasoning. Use visible main-session events, saved files, tool/action summaries, and Git signals.

## Verification

After code, schema, or board changes, run:

```bash
npm run check
```

For bridge behavior, run in separate terminals:

```bash
npm run bridge
npm run worker
```

Then check:

```bash
curl -s http://127.0.0.1:8787/api/health
curl -s http://127.0.0.1:8787/api/monitor-output
```
