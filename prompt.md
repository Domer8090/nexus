# Nexus — Master Build Prompt

> **Purpose:** Give this file to Claude Code, Cursor, Codex, Windsurf, Replit Agent, or another coding agent to build the Nexus MVP described in `PRD.md`.
>
> **Product:** Nexus — The Intelligence Layer for AI  
> **Tagline:** One prompt. Multiple models. Better results.

---

## 1. Your Role and Mission

You are a senior product engineer, UX designer, and full-stack architect. Build **Nexus**, a polished, working web application for vibe coders and developers who want to improve prompts, choose the right AI model, estimate usage and cost, run one prompt against multiple models, and compare the results.

Treat the accompanying `PRD.md` as the source of truth for product scope and acceptance criteria. This file provides the implementation direction and interaction details.

**Your mission is to build the product, not just describe it.** Inspect the existing repository, understand its conventions, and implement the application end to end. Do not stop after generating a plan, mockup, or static landing page. Make reasonable implementation decisions without asking the user questions. If a provider credential or external service is unavailable, implement a clearly labeled demo mode so the core experience remains usable.

### Product north star

A first-time user should be able to:

1. Enter an idea in plain English.
2. Improve it with Nexus Prompt Optimizer.
3. Understand which model Nexus recommends and why.
4. Select one or more models and see estimated tokens/cost.
5. Run the same prompt against multiple models.
6. Compare the answers side by side.
7. Save the prompt/session, and optionally share the prompt.

The complete journey should be demonstrable without requiring real API keys by using clearly labeled demo responses.

---

## 2. Working Rules

1. **Inspect before changing.** Read the repository, package scripts, framework, existing components, and current design system before modifying files.
2. **Preserve working code.** Extend the existing application rather than replacing a working project unnecessarily.
3. **Build in vertical slices.** Prioritize a complete, usable Playground flow before secondary features.
4. **Make the UI real.** Buttons, tabs, menus, forms, filters, and actions must work. Avoid decorative controls that do nothing.
5. **No fake claims.** Never display fabricated live model availability, benchmark scores, token counts, pricing, or API success as real data.
6. **Separate demo from live mode.** Every simulated response or estimate must be identified as demo/sample data. Never silently fall back from a failed live request to a fake success.
7. **Protect secrets.** Provider API keys must only be read and used on the server. Never expose secrets in browser bundles, URLs, logs, client state, or saved/shared prompts.
8. **Handle partial failure.** One provider failing must not erase successful results from other providers.
9. **Use accessible patterns.** Keyboard navigation, visible focus, semantic labels, suitable contrast, and responsive layouts are required.
10. **Verify the work.** Run the available lint, typecheck, and build/test commands. Fix errors introduced by the implementation.

If the repository already has a stack, follow it. If it is empty or has no meaningful stack, use the defaults in Section 3.

---

## 3. Recommended Technical Defaults

Use existing project choices where possible. For a new project, prefer:

- **Framework:** Next.js App Router with TypeScript.
- **Styling:** Tailwind CSS.
- **UI primitives:** shadcn/ui or accessible equivalents already in the repository.
- **Icons:** Lucide icons.
- **Validation:** Zod or an existing schema-validation library.
- **Client state:** React state for local UI state; use a small state store only if genuinely needed.
- **Persistence:** Start with local persistence for a no-setup demo. Add a database/auth integration only if the repository already has it or credentials/configuration are provided.
- **Server APIs:** Next.js route handlers or the existing server/API layer.
- **AI integrations:** Provider adapters for Anthropic, OpenAI, and Google Gemini, implemented server-side and only where credentials are configured.

Do not introduce a large dependency or complex infrastructure for a feature that can be implemented simply. Keep the architecture modular so additional providers can be added without rewriting the Playground.

### Environment configuration

Create `.env.example` with the variables actually used, for example:

```bash
# Optional. Without provider keys, the app runs in clearly labeled demo mode.
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=

# Optional database/auth configuration, only if implemented.
# DATABASE_URL=
# NEXT_PUBLIC_SUPABASE_URL=
# NEXT_PUBLIC_SUPABASE_ANON_KEY=
# SUPABASE_SERVICE_ROLE_KEY=
```

Do not require every key to be present for the application to start.

---

## 4. Product Experience and Visual Direction

Build a premium developer-focused workspace. The experience should feel focused, fast, intelligent, and approachable—not like a generic AI landing page.

### Design principles

- Use a restrained visual system: deep charcoal/ink surfaces or a polished neutral light theme, with one confident indigo/violet accent and restrained success/warning colors.
- Favor clear hierarchy, whitespace, fine borders, subtle elevation, and consistent spacing.
- Avoid excessive gradients, glassmorphism, glowing neon, oversized headings, and decorative AI imagery.
- Use readable typography, compact but comfortable controls, and clear empty/loading/error states.
- Make the Playground the visual center of the product.
- Use realistic sample content in demo mode rather than lorem ipsum.
- Keep the UI consistent across Playground, Library, History, and Connections.

### Global application shell

Create a persistent shell with:

**Left sidebar navigation**
- Nexus logo/wordmark.
- Playground (primary destination).
- Prompt Library.
- History.
- Connections.
- Settings.
- A compact user/profile area at the bottom, using a local demo profile if authentication is not implemented.

**Top bar**
- Current page title and optional breadcrumb.
- Connection/demo status indicator.
- New session action where appropriate.
- Responsive sidebar toggle on small screens.

### Required routes/pages

Implement at least:

- `/` — Playground (main product experience).
- `/library` — community prompt library.
- `/history` — previous sessions.
- `/connections` — provider connection status and setup guidance.
- `/settings` — preferences and privacy basics.

Use route conventions already present in the repository if they differ.

---

## 5. Playground — Primary Screen

The Playground is the most important screen. Design and implement it first.

### Desktop layout

Use a responsive workspace with:

1. **Prompt composer area** — prominent and easy to focus on.
2. **Recommendation/model selection area** — shows the best-fit suggestion and alternatives.
3. **Results comparison area** — shows one card/pane per selected model.

These can be arranged as a two-column workspace with a full-width results section, or a three-panel layout if it remains readable. Do not squeeze response text into narrow columns. On mobile, stack the sections or use clear tabs.

### 5.1 Prompt composer

Include:

- A clear title such as **What are you building today?**
- Large multiline editor with a useful placeholder: `Describe your idea, code problem, or task...`
- Task type selector: `Auto-detect`, `Build an app`, `Code`, `Debug`, `Explain`, `Write`, `Research`, `Other`.
- Optional context controls, which can be collapsed under **Add context**:
  - Preferred language/framework or technology stack.
  - Audience/skill level.
  - Constraints.
  - Desired output format.
  - Additional context.
- Main action: **Optimize prompt**.
- Secondary action: **Start from scratch / Clear** with confirmation if content would be lost.
- Character/input length feedback when useful.

Do not force users to fill in optional fields. The free-form prompt alone must work.

### 5.2 Prompt optimization experience

When the user clicks **Optimize prompt**:

1. Validate that the prompt is not empty.
2. Show an in-context loading state (for example, `Analyzing intent`, `Finding missing context`, `Improving structure`).
3. Analyze the request for intent, task type, missing context, ambiguity, constraints, and expected output.
4. Generate an improved prompt that preserves the user's intent.
5. Show the original and optimized prompts in a clear comparison or versioned editor.
6. Display a concise **What changed** summary.
7. Identify any assumptions or optional suggestions separately from required content.
8. Let the user edit the improved prompt, accept it, or restore the original.

The optimized prompt should use only relevant sections, such as:

- Context / role
- Goal
- Requirements
- Constraints
- Output format
- Success criteria

**Important:** Do not silently invent product requirements, technologies, data, or scope. Suggestions must be marked as suggestions or assumptions and remain editable.

If the optimizer API is not configured, use a deterministic local demo optimizer with a visible `Demo mode` label. It should still produce a useful structured version of the prompt and a change summary. Do not display a fake API provider name or imply that a live LLM produced it.

### 5.3 Model recommendation

After a prompt is accepted or updated, show a **Nexus recommendation** section.

Include:

- One primary recommended model.
- A concise explanation of why it fits this task.
- Two or more alternatives when available.
- Model/provider names and small provider icons or text labels.
- Capability indicators only when backed by configured metadata: coding, reasoning, speed, cost efficiency, context window.
- User priority selector:
  - `Best quality`
  - `Balanced`
  - `Lowest cost`
- Model selection controls so the user can select multiple models for comparison.
- Clear selected, recommended, disconnected, and unavailable states.

Do not state that a model is universally best. Use recommendation language such as `Best fit for this task based on your selected priority` and explain the basis.

For the hackathon MVP, implement a transparent rules-based recommender. Use a model registry with fields such as:

```ts
type ModelMetadata = {
  id: string;
  provider: "anthropic" | "openai" | "google" | "demo";
  displayName: string;
  description: string;
  capabilities: string[];
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  available: boolean;
  connectionRequired: boolean;
  pricingUpdatedAt?: string;
  demoOnly?: boolean;
};
```

Use real, maintained metadata only when supplied/configured. For static demo metadata, label the registry as sample data and do not represent it as current pricing or benchmark truth.

### 5.4 Token and cost estimates

Before execution, show:

- Selected model(s).
- Estimated input tokens (provider tokenizer if implemented; otherwise clearly labeled approximation).
- Estimated output tokens or output-length assumption.
- Estimated cost, only when the model's pricing metadata is available.
- A small note explaining that actual cost may differ.

Rules:

- Never invent a price.
- Never imply estimated output tokens are guaranteed.
- If pricing or tokenizer data is missing, show `Unavailable` or `Approximate estimate`, with a useful explanation.
- Keep the token/cost details compact; do not overwhelm beginners.

### 5.5 Run controls

- Primary action: **Run with selected models**.
- Disable execution when no model is selected or all selected models are unavailable.
- Show the number of selected models.
- Confirm that the same accepted prompt version will be sent to each selected model.
- If running in demo mode, label the action/results accordingly.

---

## 6. Multi-Model Results and Comparison

When a user runs the prompt, create an independent run for each selected model.

### Results layout

Each model result should appear in a distinct card or tab with:

- Provider and model name.
- Recommended/selected indicator where relevant.
- Run status: queued, running, completed, or failed.
- Response content, rendered safely (markdown support is useful).
- Elapsed time, when measured.
- Input/output token usage and actual cost only when returned by the provider or reliably calculated.
- Copy response action.
- Retry this model action.
- Save result action.
- Mark as preferred action.

### Comparison behavior

- Keep the same prompt/version visible or accessible for all runs.
- Allow side-by-side comparison on desktop and tab/stacked comparison on mobile.
- Preserve completed model outputs if another provider fails.
- Allow the user to retry only failed models.
- Make it easy to copy the preferred response.
- Do not truncate the response without an expand/view-full control.

### Basic response evaluator

Implement as a secondary feature if it does not delay the P0 flow. If included, evaluate responses against visible criteria:

- Instruction adherence.
- Completeness.
- Clarity.
- Relevance to task.

Explain that scores are AI-generated guidance and are not proof of correctness. Do not use fabricated scores in live mode. For demo mode, clearly label sample evaluations.

---

## 7. Provider Integration and Demo Mode

Build a clean provider abstraction. A provider adapter should accept a normalized request and return a normalized result.

Example conceptual interface:

```ts
type ModelRunRequest = {
  prompt: string;
  modelId: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
};

type ModelRunResult = {
  runId: string;
  provider: string;
  modelId: string;
  status: "completed" | "failed";
  text?: string;
  error?: { code: string; message: string };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  durationMs?: number;
};
```

Implement provider adapters for Anthropic, OpenAI, and Google Gemini only if the repository and available environment make it practical. Keep each provider call on the server. Use each provider's current supported SDK/API pattern and normalize errors and usage metadata.

### Demo mode requirements

Demo mode is essential for reliable hackathon judging:

- It must work without API credentials.
- Clearly label demo models and generated sample outputs as **Demo**.
- Use distinct, plausible sample responses that demonstrate differences in approach; do not pretend they are real provider responses.
- Simulate independent completion states so the comparison UI can be demonstrated.
- Use deterministic sample token/cost figures only if they are labeled illustrative/sample data.
- A live API error must be shown as an error; do not silently substitute demo output.

### Connections page

Show provider tiles for Anthropic, OpenAI, and Google:

- Provider name and logo/text mark.
- Connection status: Connected, Not configured, or Demo available.
- Brief instructions for configuring server-side environment variables.
- Never ask users to paste production secrets into a public page or persist keys in localStorage.
- If secure bring-your-own-key management is not implemented, explicitly say that this MVP uses server environment variables rather than implying account-level key vault support.

---

## 8. Prompt Library, History, and Settings

These are supporting features. Keep them useful and simple.

### Prompt Library (`/library`)

- Search prompt title, description, or tags.
- Filter by categories such as Coding, Debugging, Design, Writing, Research, and Learning.
- Display prompt cards with title, short description, tags, author/demo attribution, and use/remix action.
- Include a handful of clearly labeled sample prompts for demo mode.
- Prompt detail should show the full prompt, intended use, and tags.
- `Use prompt` or `Remix` should open the Playground with the prompt prefilled.
- If publishing is implemented, make private/public status clear and require explicit publish action.

### History (`/history`)

- Show saved sessions with prompt title or first line, date, task category, selected models, and run status.
- Search/filter history if feasible.
- Reopening a session should restore its prompt and saved outputs.
- Provide a delete action with confirmation.
- In local demo mode, use local persistence and make its scope clear.

### Settings (`/settings`)

- Basic preferences such as theme and default priority.
- Brief privacy explanation covering provider requests and prompt sharing.
- Explain that prompts are private by default.
- Include clear reset/clear-local-data action if local storage is used.

---

## 9. Data Model and State

Use types and schemas rather than loosely structured objects. Adapt the shape to the existing architecture.

Suggested entities:

```ts
type PromptVersion = {
  id: string;
  originalText: string;
  optimizedText?: string;
  activeText: string;
  taskType?: string;
  context?: Record<string, string>;
  changeSummary?: string[];
  assumptions?: string[];
  createdAt: string;
};

type PlaygroundSession = {
  id: string;
  title: string;
  promptVersions: PromptVersion[];
  selectedModelIds: string[];
  priority: "quality" | "balanced" | "cost";
  runs: ModelRunResult[];
  preferredRunId?: string;
  createdAt: string;
  updatedAt: string;
};

type LibraryPrompt = {
  id: string;
  title: string;
  description: string;
  promptText: string;
  category: string;
  tags: string[];
  authorLabel: string;
  visibility: "private" | "public";
  sourcePromptId?: string;
  createdAt: string;
};
```

Requirements:

- Preserve the original prompt and every accepted optimized version used for a run.
- Associate each model response with the exact prompt version and model ID.
- Do not store provider secrets in session or prompt records.
- In local demo mode, persist sessions in localStorage or IndexedDB with versioned keys and safe parsing. Handle corrupted data gracefully.
- If a database is used, enforce per-user access on the server and never rely on client-side filtering for authorization.

---

## 10. API and Service Boundaries

Keep business logic out of UI components. Create service modules for prompt optimization, model recommendation, pricing/token estimates, provider execution, and persistence.

Suggested endpoints (adapt to the repository):

- `POST /api/optimize` — accepts prompt and optional context; returns optimized prompt, task classification, change summary, and assumptions.
- `POST /api/recommend` — accepts prompt/task metadata, priority, and eligible models; returns ranked recommendation and rationale.
- `POST /api/run` — accepts prompt, selected model IDs, and run options; returns/streams independent results.
- `GET /api/models` — returns model registry and connection/availability status without exposing secrets.

Validate all inputs on the server. Set sensible input/output limits and request timeouts. Normalize provider errors into safe, user-readable messages. Do not return stack traces or secret values to the client.

If streaming is not practical for the first implementation, return independent results with loading/progress UI and leave the service boundary ready for streaming later.

---

## 11. Suggested Demo Scenario

Build the product so the following scenario works smoothly from start to finish:

**User prompt:**

> Build a website for my school science club.

**User context (optional):**

- Audience: High school students.
- Style: Modern, welcoming, easy to use.
- Desired output: Working responsive website.

**Expected Nexus behavior:**

1. Optimizer identifies this as a web app/build task.
2. It proposes an improved prompt with a clear goal, feature suggestions, responsive/accessibility constraints, and expected deliverables.
3. The change summary explains what was added and labels any inferred pages/features as suggestions.
4. Recommender identifies suitable models based on the configured registry and explains the trade-offs.
5. User selects two or more models.
6. Nexus displays the token/cost estimate or clearly explains why pricing is unavailable.
7. Both models run independently (or clearly labeled demo runs execute).
8. Results show meaningfully different implementation approaches.
9. User marks a preferred answer, copies it, and saves the session.
10. User can optionally save or publish the prompt in the library.

The demo should show the product's core value in a few minutes without relying on hidden setup steps.

---

## 12. Quality Bar and Acceptance Criteria

Do not consider the task complete until the following are true:

### Core flow
- [ ] App starts using the documented command.
- [ ] User can open the Playground and enter a natural-language prompt.
- [ ] Optimize action works and shows a useful, editable result.
- [ ] Original prompt is preserved and can be restored.
- [ ] Recommendation is shown with a human-readable rationale.
- [ ] User can select multiple eligible models.
- [ ] Token/cost area is transparent about estimates and missing data.
- [ ] Run action executes each selected model independently or invokes visibly labeled demo runs.
- [ ] Results are labeled with the correct model and prompt version.
- [ ] One model failure does not remove successful outputs.
- [ ] User can copy a response and mark a preferred response.
- [ ] User can save and reopen a session.

### Supporting experience
- [ ] Library displays useful sample prompts and search/filter works.
- [ ] A prompt can be loaded into the Playground.
- [ ] History displays saved sessions and supports reopening/deletion.
- [ ] Connections accurately show live/demo/not-configured states.
- [ ] Responsive navigation and layouts work on mobile and desktop.

### Engineering quality
- [ ] TypeScript and lint/build checks pass, or any pre-existing failures are documented.
- [ ] No API secrets are exposed to the client.
- [ ] Forms and server inputs are validated.
- [ ] Loading, empty, success, and error states are handled.
- [ ] No dead buttons, placeholder links, or misleading live-data claims remain.
- [ ] README explains setup, environment variables, demo mode, and how to run the app.

---

## 13. Implementation Sequence

Follow this order. Keep the app runnable after each major stage.

### Phase 1 — Inspect and scaffold
- Inspect the repository and existing stack.
- Identify entry points, styles, components, and scripts.
- Implement the application shell, navigation, theme, and route skeleton.

### Phase 2 — Playground UI
- Build the prompt composer and optional context fields.
- Implement optimize loading, result, edit, accept, and restore states.
- Add model recommendation, priority selector, model selection, and token/cost panel.

### Phase 3 — Runs and comparison
- Define normalized provider/model interfaces.
- Implement demo adapters first so the whole journey works without credentials.
- Add live provider adapters where configured.
- Implement independent run states, result cards, retry, copy, and preferred response.

### Phase 4 — Persistence and supporting pages
- Add session persistence.
- Build History, Library, Connections, and Settings.
- Add sample prompts and remix-to-Playground behavior.

### Phase 5 — Polish and verify
- Refine responsive behavior and accessibility.
- Add empty, loading, error, and partial failure states.
- Run lint, typecheck, tests, and production build.
- Fix issues and update README.

Do not spend time on P2 functionality until the core flow is complete and verified.

---

## 14. Final Instructions to the Coding Agent

Before finishing:

1. Summarize what you implemented and which requirements are complete.
2. List the exact commands to install, run, and verify the project.
3. List environment variables needed for live provider integrations.
4. Explain what works in demo mode and how it is labeled.
5. Disclose any incomplete feature or known limitation honestly.
6. Confirm that no provider secrets are exposed in client code.

**Start now:** inspect the repository, then implement the Nexus MVP. Do not respond with a plan only. Build the working application.
