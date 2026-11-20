# Token test: the same task with and without Nexus

Two tests: a one-page project, then this repository (166 files, about 25,000 lines). The second one found a way to cut tokens by about two thirds, now on by default as **Lean context** in Settings.

## Test 1: a one-page project

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

### Result

On this small task, Nexus used about 1,100 more tokens per run than plain `claude -p`, about 0.9% more.

The extra comes from two things:
- Reading the project map file.
- The short Nexus instruction appended to the system prompt.

The concise setting made no difference here, because the answer was already short (about 450 output tokens).

Nexus doesn't save tokens on a one-file edit. It also doesn't add a meaningful number. Nexus is useful for the work around the edit: the worktree, review, file-by-file apply, notes, and limit handoff. Saving tokens isn't one of its benefits.

### A mistake caught during the test

The first plain runs were started from inside a Claude Code desktop session. They inherited that session's environment, which loaded 383 tools and 33 MCP servers. That made them about 170,000 tokens each, so Nexus looked 23% cheaper.

That comparison wasn't fair. The Nexus server runs with a clean environment. The plain runs above were repeated from a clean login shell, and only those are in the table.

Tool definitions (MCP servers, plugins, skills) are the biggest cost on a small task. With all those tools loaded, each model call carried about 54,000 tokens of context. In the clean Nexus run, it was about 43,000. Almost none of that is the project itself.

## Test 2: a bigger project, and where the tokens go

Run on 2026-11-19 with `scripts/token-arms.mjs` on a fresh clone of this repository for every run.

**Task:** "The usage-limit warning fires when an agent has used 80% of a window. Change that threshold to 85% everywhere it is defined or documented, and update any test that checks it."

The agent has to search for this, because the repository has many unrelated `0.8` values (CSS, animation timing). Every counted run made the same three-file change: `src/runtime/limits.ts`, `README.md` and the test.

**Setup:** Claude Code with `--model sonnet`, `acceptEdits`, from a clean login shell.

### Where the tokens go

Claude Code sends the whole conversation on every model call: the system prompt, every tool definition, and everything read so far. The total is roughly:

> (fixed context + what the agent has read) × number of calls

The fixed context depends on what Claude Code loads at start. On this machine it loads:
- 198 tools, from 7 connected MCP servers (Gmail, Drive, Canva, Zapier and others) and plugins.
- 208 skills.
- Plugin hooks that add text at session start.

A coding step uses none of these. Together they made the first call about 35,000 tokens, before the agent read any project file.

### Results

| Arm | What it changes | Runs (total tokens) | Average |
|---|---|---|---|
| Plain `claude -p` | nothing | 393,299 / 333,153 | 363,226 |
| Nexus before this change | project map, Nexus prompt line | 393,032 / 267,630 | 330,331 |
| Map inlined in the prompt | map text instead of a file | 437,220 | worse |
| No MCP | `--strict-mcp-config` | 197,343 | -46% |
| No MCP, no skills | `+ --disable-slash-commands` | 136,814 / 169,855 | -58% |
| **Lean context** | `+ --setting-sources project,local` | 95,621 / 94,342 / 94,317 | **-74%** |
| Lean context through the real Nexus app | the shipped setting, end to end | 122,699 / 93,922 | **-70%** |
| Lean context without the project map | lean, map off | 84,872 / 74,407 | -78% |

One plain run (130,652 tokens) is left out: Claude Code blocked its `git grep` and the run stopped, asking for approval, without making the change.

Percentages compare each average with the plain average.

### What changed in Nexus

**Lean context**, in Settings and on by default, starts Claude Code steps with:
- `--strict-mcp-config`: no MCP servers except the project's own `.mcp.json`, which is passed with `--mcp-config` when it exists.
- `--disable-slash-commands`: no skill and command listings.
- `--setting-sources project,local`: no user-level plugins and their hooks. Project settings still apply.

When a step picked skills, Nexus keeps user settings and skills on, and only drops MCP servers. Each run says in its log what lean context left out.

The flags are documented Claude Code options. Sign-in is untouched: Claude Code still uses its own credential store.

Not used:
- `--bare`: it needs an API key and ignores the user's sign-in, which Nexus never asks for.
- `--safe-mode`: it also drops the project's own CLAUDE.md.

### What didn't help

- **Inlining the project map in the prompt** cost more: the 17 KB map rides along on every call.
- **The project map file** didn't save tokens on this task either. With lean context, runs without the map used about 16% less (79,640 against 94,760 on average). The agent found the code with one search, and the map it read stayed in the context for every later call. The map may still help on broad tasks ("explain this codebase"), but these tests didn't show that. It stays on for now; turning it off is one switch in Settings.

### Limits of this test

- Two or three runs per arm. The number of calls changes from run to run (4 to 8), so single runs vary by about 20%.
- One machine. A setup with fewer plugins and MCP servers saves less from lean context.
- One kind of task: a targeted change. A step that needs an MCP server (for example Figma) needs lean context off, or the server in the project's `.mcp.json`.
