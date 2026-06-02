# Meta Guardian CLAUDE.md

@AGENTS.md

## Claude Code Notes

This folder is a guardian-only workspace boundary.

If running Claude Code as the guardian session:

- Read `meta-guardian/AGENTS.md` first.
- Treat `meta-guardian/guardian-input.schema.json` as the canonical input contract.
- Use `meta-guardian/guardian-prompt.md` to turn main-session events into guardian-level explanations.
- Write only under `meta-guardian/**` unless the user explicitly changes the boundary.
- Prefer `meta-guardian/main-session-events.jsonl` over direct user prompting.
- Do not read or infer hidden model reasoning. Use visible transcript/export, file artifacts, tool summaries, and Git signals only.
- Keep answers concise and Korean by default when the main session language is Korean.
