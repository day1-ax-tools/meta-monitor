# Meta Monitor CLAUDE.md

@AGENTS.md

## Claude Code Notes

This folder is a monitor-only workspace boundary.

If running Claude Code as the monitor session:

- Read `meta-monitor/AGENTS.md` first.
- Treat `meta-monitor/monitor-input.schema.json` as the canonical input contract.
- Use `meta-monitor/monitor-prompt.md` to turn main-session events into meta-level explanations.
- Write only under `meta-monitor/**` unless the user explicitly changes the boundary.
- Prefer `meta-monitor/main-session-events.jsonl` over direct user prompting.
- Do not read or infer hidden model reasoning. Use visible transcript/export, file artifacts, tool summaries, and Git signals only.
- Keep answers concise and Korean by default when the main session language is Korean.
