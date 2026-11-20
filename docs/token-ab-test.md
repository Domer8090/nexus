# Token test: the same task with and without Nexus

Run on 2026-11-19 with `scripts/token-ab.mjs`.

**Task:** "Add a footer to index.html with the text "Made by the Science Club". Match the page's existing style."

**Setup:**
- Project: the science-club demo (one HTML page), starting from the same commit for every run.
- Model: Claude Code with `--model sonnet` (claude-sonnet-5-5).
- Permission mode: `acceptEdits`.
- Without Nexus: `claude -p` in a fresh clone, from a clean login shell, like typing it in Terminal.
- With Nexus: one Solo step through the Nexus API, in its own worktree, with default settings.

Tokens are Claude Code's own numbers from its result event:
- input
- cache read
- cache write
- output

Total is the sum of the four. Every run made the change.

| Run | Total tokens | Cache read | Cache write | Output |
|---|---|---|---|---|
| Plain `claude -p` #1 | 129,670 | 93,884 | 35,275 | 505 |
| Plain `claude -p` #2 | 129,715 | 94,917 | 34,335 | 457 |
| Nexus, normal #1 | 130,807 | 95,677 | 34,692 | 432 |
| Nexus, normal #2 | 130,837 | 97,458 | 32,932 | 441 |
| Nexus, concise | 131,005 | 95,804 | 34,765 | 430 |

## Result

On this small task, Nexus used about 1,100 more tokens per run than plain `claude -p`, about 0.9% more.

The extra comes from two things:
- Reading the project map file.
- The short Nexus instruction appended to the system prompt.

The concise setting made no difference here, because the answer was already short (about 450 output tokens).

Nexus doesn't save tokens on a one-file edit. It also doesn't add a meaningful number. Nexus is useful for the work around the edit: the worktree, review, file-by-file apply, notes, and limit handoff. Saving tokens isn't one of its benefits.

## A mistake caught during the test

The first plain runs were started from inside a Claude Code desktop session. They inherited that session's environment, which loaded 383 tools and 33 MCP servers. That made them about 170,000 tokens each, so Nexus looked 23% cheaper.

That comparison wasn't fair. The Nexus server runs with a clean environment. The plain runs above were repeated from a clean login shell, and only those are in the table.

Tool definitions (MCP servers, plugins, skills) are the biggest cost on a small task. With all those tools loaded, each model call carried about 54,000 tokens of context. In the clean Nexus run, it was about 43,000. Almost none of that is the project itself.
