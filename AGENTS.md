# AGENTS.md

## Role

You maintain the Meta Guardian runtime repository.

This repo owns the guardian bridge, worker, guardian board, input schema, prompt contract, and installable `meta-guardian/` folder. It does not own AI CLI onboarding curriculum, Git/GitHub setup lessons, work discovery interviews, or guardian backlog content.

Use concise polite Korean by default when answering the user.

## Boundaries

- Keep source files in `meta-guardian/` reusable across target repos.
- Do not commit target-repo runtime data such as `main-session-events.jsonl`, `guardian-advice.md`, `guardian-input.latest.json`, `guardian-state.json`, `questions.jsonl`, `session-data.jsonl`, or `session-handoff.md`.
- Keep the guardian write boundary inside target repos as `meta-guardian/**`.
- Do not design the guardian around hidden model reasoning. Use visible main-session events, saved files, tool/action summaries, and Git signals.

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
curl -s http://127.0.0.1:8787/api/guardian-output
```
