# CSC Winter Sparkathon submission draft

Parts marked **YOU** must be in the team's own words; judges may ask about them. Submit by November 29: Devpost shows November 30, 12:00 AM PST, while the rules page says 12:00 PM.

## Project name

Nexus

## Problem

Students can now build with AI agents alone. They get code they can't explain, an agent that may say "done" when it isn't, and nobody to ask, because a friend would need the same tools, accounts and project to help.

## Who it is for

Students and beginners building with coding agents, and the friends, clubmates and teachers who want to help them.

## What it does

Nexus runs the coding agents on your computer and puts people back in the loop. It checks the agent's claims, explains the change at your level, and asks if you could explain it. Then Ask a friend makes one file anyone can open, even on a phone. They write notes and praise, and send a reply. You decide which parts the agent acts on.

## How it meets the criteria

| Criterion | Where to look |
|---|---|
| Learning | Understand step: plain explanation, terms, three questions. **YOU:** what you learned |
| Design | One flow: Understand, Ask, Replies. The friend needs no account or install |
| Creativity | AI review usually adds another bot. Nexus makes it easy to bring in a person |
| Functionality | Working app, automated tests, and `docs/sample-help-file.html` |
| Impact | Help can come from anyone with a browser. **YOU:** have two people try it and describe what happened |

## Tools and credits

Next.js, React, Tailwind CSS, Zod, lucide-react, react-markdown, Vitest, SQLite; Claude Code, Codex CLI and Ollama (llama3.2:3b) as agents and models; Skills CLI and skills.sh; public npm and GitHub APIs; the Backboard API (optional; list it as used only after a live run). Home sky adapted from mosaic-prompt-template by Kedhareswer Naidu (MIT).

## AI-use disclosure

Claude Code wrote much of the code, tests and documentation, including this draft, under the team's direction. Inside the app, Claude Code and Codex edit code, and Ollama or Backboard writes explanations. **YOU:** say which decisions were yours and any other AI you used.

## Work from before the hackathon

The first commit in this repository is inside the hackathon period (October 29 to November 29). **YOU:** confirm, and list anything older.

## Team

**YOU:** names.

## Links

Code: https://github.com/Domer8090/nexus. **YOU:** add the 1 to 2 minute video.

## Video outline (90 seconds)

1. 0:00 The agent says "all tests pass". Proof checks show whether Nexus saw a test run.
2. 0:20 Explain the change for someone new to code. Answer one question.
3. 0:40 Save the help file. A friend opens it on a phone and writes a note.
4. 1:05 Paste the reply, edit it, send it to the agent.
5. 1:20 Who it is for, and what you learned.
