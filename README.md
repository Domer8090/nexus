# Nexus

**One workspace. Every coding agent. Every great skill.**

Nexus is a local-first control center for the AI coding tools already on your machine. Pick a project folder and describe a goal. Nexus asks a few clarifying questions, turns your answers into an optimized prompt, assembles a team of the agents on your machine (each on the job it does best), shows the exact commands, and runs the work while a live dashboard shows progress and a preview of the result. Each session edits its own git worktree, streams its activity, and waits for you to review the diff before anything touches your project.

Nexus does not use provider API keys. Agents run with their own sign-in (for example, your Claude account through Claude Code). Local models run through Ollama.

## Run it

Requires macOS or Linux, Node.js 22.13 or newer, and git.

```bash
npm install
```

```bash
npm run dev
```

Open http://127.0.0.1:3000. The server binds to 127.0.0.1 only.

Production mode:

```bash
npm run build
```

```bash
npm start
```

## Verify

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

## What is real, what is not

### Agents

| Agent | Status in Nexus | Sign-in | What Nexus does |
|---|---|---|---|
| **Claude Code** | Supported, tested | Your Claude account via `claude auth login` (Pro, Max, Ultra, Team, Enterprise or Console, per Anthropic's docs) | Detects version and sign-in (`claude auth status`), opens the official login in Terminal, runs headless sessions with `claude -p --output-format stream-json`, streams tool and file events, stops sessions, resumes them for revisions (`--resume`), reports tokens and subscription windows from the CLI's own events |
| **Ollama** | Supported, tested | None, local | Lists pulled models, refines task briefs locally, runs read-only planner and reviewer roles over `127.0.0.1:11434` |
| Jcode | Detection only | `jcode login --provider claude` (subscription OAuth, per jcode.sh/docs) | Evaluated: its docs show `jcode run` but no JSON or streaming output mode, so Nexus can't capture events reliably yet |
| **Codex CLI** | Supported, tested (0.169) | Your ChatGPT account via `codex login` | Detects sign-in (`codex login status`, refuses API-key sign-in), runs `codex exec --json` with `--sandbox workspace-write` or `read-only`, streams messages and commands, generates images with its built-in image tool, resumes for revisions, reports tokens. Codex's shell always runs inside its own sandbox; Nexus cannot switch it off |
| Gemini CLI | Detection only | Run `gemini`, choose Sign in with Google | Its README says personal and Google AI Pro / Ultra access moved to Antigravity CLI on 2026-06-18 |
| OpenCode | Detection only | `/connect` in its TUI | Launch not implemented |
| LM Studio | Detection only | None, local | Detects `lms` |
| Aider | Out of scope | Its install docs show API keys | Not launched, because Nexus does not use API keys |

"Detection only" means Nexus shows whether the CLI is installed, its version, and the official install and sign-in commands. It never claims these agents are connected or running. Sign-in state for them shows as Unknown, because Nexus does not read their credential stores.

Nexus refuses a Codex sign-in that uses an API key, and removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY` and `GOOGLE_API_KEY` from the environment of every agent it starts, so agents use their account sign-in instead of quietly falling back to a key.

### Skills

- **Discovery**: the official Skills CLI (`skills` 1.9.0, pinned) with `skills find`, which searches skills.sh. Install counts come from skills.sh and show their retrieval time.
- **Inspection**: the skill's `SKILL.md`, file list, source path, commit, license and last change are read from the public GitHub API and raw files, unauthenticated. Unreadable fields show as Unavailable.
- **Security review**: a best-effort static scan (pipe-to-shell, hidden or encoded code, credential and keychain reads, environment exfiltration, destructive deletes, network calls, process spawning, package installs, hooks, missing license). Outcomes are Reviewed, Review required or Blocked. Every review lists what was checked and what was not. It is pattern matching, not a guarantee.
- **Install**: `skills add <owner/repo> --skill <name> --agent <agent> [-g] -y --json`, run only after you approve the exact command and destination. Review-required skills need a second confirmation. Blocked skills can't be installed. Each install records source URL, commit, license, review outcome and installed path.
- **Manage**: `skills list --json`, `skills update`, `skills remove`. The Skills CLI has no disable command, so Nexus doesn't offer one. The CLI keeps its own `skills-lock.json` in the project.
- **Collections**: five curated starting sets (each skill confirmed on skills.sh on 2026-11-17). They are discovery candidates, not endorsements.
- **Skill stacks**: per-project skills by stage (plan, build, test, review, ship) with project instructions, exportable as a JSON manifest with the matching `npx skills add` commands. Nexus names only the selected skills to the agent; it doesn't paste every skill into the prompt.

### Workflows

- **Presets**: Solo build, Plan, build, review, Parallel build, Debug and test, Frontend polish. Presets use only installed, signed-in agents.
- **Isolation**: each editing session runs in its own git worktree under `~/.nexus/worktrees`, on a `nexus/<session>` branch from your current HEAD. Uncommitted changes in your project are not included. If the project isn't a git repo, the session edits the folder directly and diff review is off.
- **Review**: per-session diff, files touched, optional project check script (`npm run test|lint|typecheck|build`, after approval), Apply (copies the changes into your project as uncommitted edits, refusing on conflict), Discard (removes the worktree and branch), Ask for changes (resumes the agent's session).
- **Scope guard** (`src/runtime/review.ts`): before you apply, every changed file is checked against the diff itself: deleted files, dependency files (`package.json`, lockfiles, `requirements.txt`…), project settings (`.env`, CI, `tsconfig`, config files), edits of 300 lines or more, and edits that mostly remove code. When the task names files or folders, files outside them are flagged and start unchecked. A task that names no files gets no outside check, because Nexus would only be guessing.
- **Apply file by file**: tick the files to keep and Apply only those (`git diff <base> -- <files>`, then `git apply`). Unticked files stay in the worktree, so you can apply them later or discard the rest. The run shows "Applied 3 of 5 files".
- **Change summary**: when Ollama runs, the light local model writes one sentence per file saying what changed (`/api/sessions/<id>/review?ai=1`, about 20 seconds with `llama3.2:3b`). It also says when a file may be off-task. That is shown as the model's opinion and never unchecks a file, because a 3B model gets it wrong often: in testing it called the only file of a "improve the app" task unrelated. Without Ollama the checks above still run and the drawer says there are no summaries.
- **Project notes** (Notes in the Advanced toolbar): rules and decisions you write once ("use Tailwind", "don't touch checkout") go to every new step in that project, as the first part of the agent's context. Stored in Nexus's database (`kv` table), not in the project, so they reach worktrees and never end up in a commit. Up to 8,000 characters, redacted like everything else. Revisions don't get them again, since they continue a session that already has them.
- **Orchestration**: a concurrency limit (default 2), step dependencies (the reviewer receives the builder's diff; the builder receives the planner's output), overlapping-file warnings, stop, retry. A failed or stopped session never cancels unrelated ones; dependent steps are skipped and say why.
- **Usage**: tokens, context window and subscription windows (5-hour and 7-day utilization) only when the agent reports them. No dollar costs for subscription sessions.
- **Limit warnings** (`src/runtime/limits.ts`, `/api/limits`): Claude Code's windows come from its `rate_limit_event` in the newest Nexus run. Codex doesn't print its limits in `exec --json`, but it writes them to its own session log, so Nexus reads the newest `rate_limits` block from `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (used percent, window, reset time; nothing else in the file is read). At 80% of any window the Advanced toolbar and the step's pane warn, and a waiting step offers **Move to** another signed-in agent. When an agent has reported a full window, a new step goes to another agent before it starts, and Ask the agents skips that agent; if no other agent can take it, the step waits and starts by itself when the full window resets (at the reset time the agent reported), with **Run now** to start it anyway. If the agent gave no reset time, the step runs and the agent's own limit message decides. Windows whose reset time has passed are ignored, so the warning clears at the reset. Nothing is estimated.

### Studio flow and team builds

1. **Your idea**: the goal and project folder. Home's Continue button starts the flow.
2. **A few questions**: an on-device naive Bayes classifier (about 65 built-in examples, `src/lib/intake.ts`) guesses what kind of thing you want (website, web app, API, game, and so on), detects what you already said, and asks only about the gaps. If Ollama has a model, the light local model (`llama3.2:3b` preferred) adds up to 3 questions specific to your idea. If Ollama has no model, Nexus offers a one-click download of `llama3.2:1b` or `llama3.2:3b` after you confirm.
3. **Optimized prompt**: rebuilt instantly from your answers by the template engine, then the light local model adds an optional "Suggested scope" list (a few seconds). The model never rewrites your goal or decisions.
4. **Your team** (Team build): Nexus assigns each job to the best ready agent and says why. With Claude Code, Codex and Ollama ready: Codex generates images into `assets/images/`, Ollama plans and writes copy (in parallel, locally), Claude Code builds in the same worktree using all of that as context, and Codex reviews the diff read-only. Image, plan and copy steps are optional: if one fails, the build continues. If no agent can generate images, Nexus says so and the builder draws SVG instead.
5. **Dashboard**: the run page shows the step graph, each agent's live output, and a live preview. Static pages are served by a separate loopback preview server (`127.0.0.1:4317`, its own origin so previewed scripts can't call the Nexus API; dotfiles and paths outside the folder are refused) and reload when files change. Projects that need a dev server show the command instead. Open in browser and Show in Finder are one click.
6. **When a step fails**: a status line at the top of the run says where it stopped and links to the step. The step explains the failure in plain words (sign-in expired, usage limit, agent missing, or another error) and offers the sign-in command to copy, Retry, and Run with another ready agent that can do that kind of step. If a step fails because of sign-in, a usage limit or a missing agent, Nexus hands it to the next ready agent by itself and shows a note saying so. It does not do this for ordinary build errors. Before launching, Nexus checks that the agent is still signed in (for Claude Code it also reads `loginExpiresAt` from `claude auth status`), so it doesn't start an agent it knows will fail. Steps skipped because of a failure go back in the queue automatically when the failed step runs again.

### Saving agent tokens: the project map

Before each session Nexus writes `NEXUS_MAP.md` into the session's folder: every file with its line count, its leading doc comment and the names it exports (TypeScript/JavaScript, Python, Go, Rust, CSS variables, Markdown headings), plus `package.json` scripts and dependencies. The agent is told to read it first and open only the files it needs instead of listing folders. It is built from the files themselves, with no model, and capped at 48 KB (this repository maps to about 12.5 KB). The file is added to `.git/info/exclude`, so it never appears in a diff or gets applied. Local models get an 8 KB excerpt inline because they can't open files. Turn it off in Settings. For your own Claude Code or Codex sessions, Projects → Project map previews it, writes it, and gives the one line to add to `CLAUDE.md` / `AGENTS.md`. Nexus reports the measured token counts of each run; it does not claim a fixed saving. In a measured test on a one-page project, a Nexus step used about 0.9% more tokens than plain `claude -p` for the same edit, because reading the map costs a little on a project that small ([docs/token-ab-test.md](docs/token-ab-test.md), `scripts/token-ab.mjs`).

### Saving agent tokens: lean context

Claude Code sends every installed MCP server, plugin and skill to the model on every call, as tool definitions and listings. On the test machine that was 198 tools and 208 skills, about 35,000 tokens before the agent read a project file. **Lean context** (Settings, on by default) starts Claude Code steps with `--strict-mcp-config` (only the project's own `.mcp.json`), `--disable-slash-commands` and `--setting-sources project,local`. Steps that picked skills keep user settings and skills. Sign-in is untouched. On a 166-file repository, the same change took about 108,000 tokens through Nexus against about 363,000 with plain `claude -p`, about 70% less, with the same result ([docs/token-ab-test.md](docs/token-ab-test.md), `scripts/token-arms.mjs`). In the same test the project map didn't save tokens on a targeted change. Turn lean context off when a step needs one of your MCP servers.

### Advanced mode

For people who want to see exactly what each agent is doing. Turn it on with the **Advanced** switch in the header; an **Advanced** page appears in the menu (`src/app/advanced`). It is laid out like a terminal multiplexer built for agents:

- **Vertical tabs** for every session: status, agent, elapsed time, branch or folder. A ring marks a session that needs you (it failed, or finished since you last looked), and the tab title counts them. `Cmd`/`Ctrl` + `1`–`9` opens a tab in the focused pane; `Cmd`/`Ctrl` + `[` and `]` move focus.
- **Split panes**: one, two or four terminals side by side. Each pane shows the session's steps (tool calls with their exact shell commands, file edits, stderr, errors) or the **raw output** of the agent process, line by line as it arrives.
- **What is running**: the exact command Nexus started (redacted), the folder and branch, the agent's pid, and the live process tree under it from `ps` (pid, CPU, memory, arguments), so you see the `npm test` or `git` an agent spawned.
- **Take over**: stop or rerun a session, open macOS Terminal in its worktree, or copy the resume command (`claude --resume <id>`, `codex resume <id>`) to continue the same agent session in your own terminal.
- **Desktop notifications** when a session finishes or fails, if you allow them.
- **Ask the agents** (button under the session list, or `Cmd`/`Ctrl` + `K`): type what you want added and paste, drop or pick up to six screenshots. The light local model reads the request and picks which signed-in agent does it and how big the job is (Claude Code gets Opus for large jobs and Sonnet for small ones; Codex gets its first model). Without Ollama, plain rules pick and the result says so. Images are shrunk in the browser, saved under `~/.nexus/attachments/` (never in the project), and passed with each agent's own flag: `--add-dir` for Claude Code, `--image` for Codex. Ollama gets no images, so image requests go to an account agent.
- **Command box** under each pane: tell that agent what to change next. It continues the same agent session (`--resume`) as a new step in the pane.
- **App preview** beside the terminal, the way coding agents show what they build: static pages render live with Desktop, iPad and iPhone frames; apps with their own dev server show the command, with Copy and Open Terminal. It opens by itself with one or two panes; the window button in each pane toggles it.
- **Usage limit resets**: when Claude Code or Codex stops on a usage limit and no other agent can take the step, Nexus reads the reset time from the agent's own message (`resets 11:40pm (America/Los_Angeles)`, `try again in 2 hours 13 minutes`) and runs the step again a minute after it. The pane shows the time with a **Don't wait** button; a limit message without a time gets **Run when it resets** only if the time can be read. Nexus never guesses a reset time.
- **Hide the sidebar** with the panel button left of the page title, for a full-width workspace. Nexus remembers the choice.
- **Project map** (Map button in the Advanced toolbar): the project as a map. Folders are districts, files are tiles sized by line count, faint lines are relative imports (bright for the file under the pointer). Each agent is a marker on the file it read or edited last; it glides to the next file as events arrive, trails its recent path, and files it edited glow in its colour. New files an agent created in its worktree show as new. Built from the files on disk and the recorded events (`/api/advanced/map`), first 300 files.
- **Send animation**: a request sent with Ask the agents folds into a sheet, becomes a paper plane labelled with the agent that got it and flies to that agent's pane. Skipped when the system asks for reduced motion.

### Speed

All live views in a browser tab share one server-sent event stream (`src/lib/live.ts`). Before, every step box on a run page held its own stream; a five-step run used all six connections a browser allows per site, so clicks, page loads and API calls waited behind them. Panes re-render only when their own session or output changes, and show the last 500 lines with a button for earlier ones.

`npm run dev` compiles each page on first visit and after every code change, which can take seconds. For daily use run the production build:

```bash
npm run app
```

Measured in headless Chrome on this machine: first load to a ready page 173 ms (production) and 287 ms (dev); most page switches 10 to 90 ms.

### Token use

`node scripts/token-report.mjs` reads the token counts each agent reported for your finished steps and compares like with like (same agent, model and role): project map on and off, output styles, and whole runs by how many cloud agents took part. It estimates nothing. Team runs use more tokens than one agent alone, because every extra cloud step (images, review) reads the project too; Ollama steps use no account quota. Whether the project map or a shorter output style saves tokens depends on the task, and the script says how many runs each comparison rests on.

All panes share one server-sent event stream (`/api/advanced/stream`), so four panes don't use up the browser's six connections. Raw output is kept in memory only (the last 4000 lines per session, secrets redacted) and is gone after Nexus restarts; the steps are stored in SQLite as before. Ollama runs as a local server, so it has steps but no process output.

### Long runs on a laptop

- **Keep awake** (Settings, on by default; `src/runtime/power.ts`): while any step runs or waits, Nexus holds macOS's own `caffeinate -i -m -s -w <nexus pid>`, the same tool apps like Amphetamine use, and lets go when the run ends or Nexus exits. A closed lid still sleeps a Mac unless an external display is attached or macOS sleep is turned off with `sudo pmset -a disablesleep 1`. Nexus never changes that itself; Settings shows which state the Mac is in.
- **Backup Wi-Fi** (for example an iPhone hotspot): while work is pending Nexus checks DNS every 10 seconds. After two failed checks it runs `networksetup -setairportnetwork <wifi> <name>`, at most once a minute. The password comes from your keychain, so join the network once by hand first. Nexus never stores it. Not tested against Instant Hotspot discovery; macOS's own setting System Settings → Wi-Fi → "Ask to join hotspots: Automatic" also helps.
- **Network drops**: a step that fails with a network error (`ENOTFOUND`, `fetch failed`, `stream disconnected` and similar) is marked as waiting and runs again by itself when DNS answers again.

### Models and skills

- **Model for each job** (`src/lib/model-pick.ts`): the team starts with a model picked per job by plain rules, not a model call. Local jobs (plan, copy, review) get the pulled Ollama model with the most parameters up to 16B, and a "coder" model for code jobs if you have one; the light model stays for questions and prompt polish, where speed matters. Claude Code gets Opus for the build and Sonnet otherwise; Codex gets the first model in its own list. A default set in Settings wins, and you can change any pick in the Team step.
- **Codex model**: Nexus lists the models Codex itself publishes for your ChatGPT account (`~/.codex/models_cache.json`, entries Codex marks visible) and passes the choice with `-m`. Pick per step in the team, or set a default in Settings.
- **Skills picked on this machine**: Nexus reads every installed skill (`SKILL.md` in `~/.claude/skills`, `~/.agents/skills` and the project's own skill folders), ranks them by keyword overlap with your task, drops video, 3D and audio skills unless the task is about that medium, and the light local model chooses up to 3 from that shortlist with a reason. Chosen skills start checked; uncheck any. If none fit, Nexus says so.

### Prompt intelligence

- A deterministic template engine writes the brief: it keeps your words, adds context (detected stack), constraints, deliverables and a done-when list, and marks inferred scope as optional. A line diff shows your words against the brief.
- Optional refinement with a local Ollama model. No hidden call to any provider.
- Output style: Normal, Concise, Aggressive compression, passed to Claude Code as an appended system prompt that keeps code, commands, paths, errors and warnings exact. Savings depend on the agent and task; Nexus shows measured token counts per run and claims no fixed percentage.

### MCP

Nexus reads MCP servers with `claude mcp list` and adds or removes project-scoped servers with `claude mcp add|remove --scope project`, after approval. The catalog lists the reference servers from github.com/modelcontextprotocol/servers and Microsoft's Playwright MCP, with their permissions.

## Design

Monochrome: black canvas, white ink in opacity steps, white as the only action colour, Geist and Geist Mono, near-square corners. The Home hero uses a pixel typeface and a WebGL "mosaic of light" sky adapted from *mosaic-prompt-template* by Kedhareswer Naidu (MIT); entrance motion is CSS, the sky pauses off screen and draws once under reduced motion, and a painted fallback covers browsers without WebGL. Every other page opens with the same band as a still CSS mosaic (no WebGL, since Nexus keeps visited pages mounted) and a pixel word that enters once a visit. Buttons step 1px on hover and sink on press, linked cards lift 2px, and controls are 44px tall on phones. Page copy passes the taste skill's copy-lint.

## Security

- Binds to 127.0.0.1. A proxy rejects non-loopback `Host` headers (DNS rebinding) and state-changing requests that don't come from the Nexus page itself.
- Runs only allowlisted executables (`claude`, `codex`, `ollama`, `git`, `node`, `npm`, `osascript`, `open` and the detected agent CLIs) with argument arrays, never a shell.
- Never stores API keys or OAuth tokens. Credentials stay in each agent's own store. Account details from `claude auth status` are reduced to sign-in method and plan; email and organization IDs are dropped.
- Agent sessions run with `--permission-prompts none`, plan mode for read-only roles, `acceptEdits` for builders, and the shell and web tools blocked unless you allow them. Nexus never uses `--dangerously-skip-permissions`.
- Logs, events, command previews and the audit trail redact keys, tokens, bearer headers and email addresses.
- Installs, MCP changes, applying or discarding changes, check scripts and data reset each need explicit approval in the UI.

## Data

Everything lives in `~/.nexus` (override with `NEXUS_HOME`, see `.env.example`):

- `nexus.db`: SQLite (Node's built-in `node:sqlite`) with projects, workflows, sessions, events, skill install history, stacks, settings, cache and the audit log.
- `worktrees/`: one folder per isolated session.

Settings has Export and Reset. Reset deletes Nexus metadata only: not your projects, worktrees, installed skills or agent configuration.

## Architecture

```
src/
  proxy.ts              loopback + same-origin guard
  runtime/              Nexus Local Runtime (server only)
    agents/             adapter contract, Claude Code, Ollama, detection-only adapters, registry
    proc.ts             allowlisted process manager, env stripping, process-group kill
    sessions.ts         session store, queue, dependencies, cancel, retry, revise, event bus
    workspace.ts        projects, git status, worktrees, diff, apply
    skills/             Skills CLI wrapper, GitHub inspector, security review, collections
    mcp.ts              claude mcp list/add/remove
    brief.ts            stack detection, local-model refinement
    recommend.ts        explainable agent and skill recommender
    db.ts, redact.ts, audit.ts, settings.ts, stacks.ts
  app/api/              route handlers over the runtime
  app/                  Home, Playground, Agents, Skills, Projects, Runs, Integrations, Settings
tests/                  unit tests (Vitest)
```

The UI talks only to `/api/*`; vendor commands live in adapters. A new agent needs an adapter that implements `detect()` and, once tested, `launch()`.

## Tested on this build

On macOS 27 with Claude Code 2.1.318 (signed in with a Claude account) and Ollama 0.40.13:

- Detection of installed and missing agents, sign-in state, local models.
- A Solo build on a demo repo: brief, local refinement with llama3.2:3b, recommendation, approval, a real Claude Code session in a worktree that edited `index.html`, live streaming, blocked shell tool, diff review, Apply.
- Plan (Ollama) → Build (Claude Code) → Review (Ollama with the build diff).
- Two parallel Claude Code sessions in separate worktrees; one stopped, the other finished unaffected; no leftover processes.
- Skill inspection of real repositories, install of `vercel-labs/skills@find-skills` into a project after approval, listing, removal.
- Host and Origin guard, secret scans of client bundles and the database, layouts at 375 px width.
- A Team build of a sleep-tip page: Codex (ChatGPT sign-in) generated three PNGs, Ollama planned and wrote copy, Claude Code (Haiku) built the page in the shared worktree, Codex reviewed; the dashboard previewed the result; the 7.6 MB binary patch applied cleanly to a clean clone.
- 34 unit tests, typecheck, lint, production build.

## Known limitations

- Claude Code, Codex CLI and Ollama are launched. Other agents are detection only until their adapters are written and tested.
- Codex model choice is left to Codex's default: model names available to ChatGPT accounts change, and Nexus doesn't guess them.
- The team planner is rule-based. The local model contributes plans, copy, questions and scope, but does not choose the agents.
- "Sign in" opens Terminal through AppleScript on macOS. On Linux, copy the command shown.
- Sessions are not resumed after Nexus restarts; they are marked failed with an explanation.
- Pause is not available: Claude Code's headless mode documents no pause.
- Worktrees start from HEAD, so uncommitted project changes are not visible to agents.
- Skill review is static pattern matching on up to 40 files per skill.
- GitHub's unauthenticated API allows about 60 requests an hour; inspections are cached for 6 hours.
- Single local user. No accounts, sharing or cloud sync.

## Sources checked

Claude Code docs (code.claude.com/docs/en/getting-started and authentication), `claude --help` 2.1.318, jcode.sh/docs, github.com/openai/codex, github.com/google-gemini/gemini-cli, opencode.ai/docs, aider.chat/docs/install.html, github.com/ollama/ollama, lmstudio.ai/docs/cli, `skills --help` 1.9.0 and skills.sh, github.com/modelcontextprotocol/servers, github.com/microsoft/playwright-mcp, github.com/JuliusBrussee/caveman.
