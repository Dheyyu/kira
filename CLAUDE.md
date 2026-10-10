# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

KIRA is a live 3D dashboard of AI agents (Scout, Builder, Outreach). The agents work tasks at their desks, wander to watch each other when idle, and train in a Skills Lab. Each task is sent to the cheapest model that fits it: Ollama (local), Mistral, or Claude.

## Commands

```
npm start            # server + UI at http://127.0.0.1:3000 (PORT/HOST env to change)
npm run dev          # same, restarts on server file changes (node --watch)
npm test             # node:test suite in test/
node --test --test-name-pattern="override" test/   # single test by name
```

Provider config goes in `.env` (see `.env.example`), which is loaded by `server/env.js`. If no provider is reachable, tasks run in **simulation mode**: canned streamed text, labeled "simulated", with $0 cost.

The repo lives on the WSL filesystem. Run node/npm/git from inside WSL (`wsl -d Ubuntu -- bash -lc 'cd ~/kira-office && ...'`), not through the Windows UNC path.

## Architecture

The server is authoritative. The browser only renders what it receives.

- `server/office.js`: the `Office` class holds all state and runs a 10 Hz `tick()` state machine per agent: `idle → walking → working | observing | training`. Server-side positions move at `WALK_SPEED` and the client interpolates between them. A queued task interrupts observing or training: the agent walks back to its desk first, then `startTask` runs. The class emits `tick` (agent snapshots, every 200 ms) and `state` (full snapshot, debounced, sent on `changed()`). Every mutation must call `changed()`, which also schedules saving to `data/state.json` via `server/store.js`.
- `server/router.js`: pure functions. `scoreTask` produces a 0..1 difficulty score from keywords, length, code and step count, agent level, and thumbs-down history. `route` maps the score to a tier using `THRESHOLDS` and returns ordered `candidates`: the desired tier first, then stronger tiers, then weaker ones, keeping only available providers. `runTask` in office.js tries the candidates in order, so a failure falls through to the next one.
- `server/providers.js`: one streaming function per provider with the same signature (`{system, prompt, effort, onText, signal}` → `{text, usage}`). Ollama and Mistral use raw `fetch` (NDJSON / SSE). Claude uses `@anthropic-ai/sdk` `beta.messages.stream`, with server-side refusal fallbacks (`fallbacks: "default"`) and effort taken from the score. Pricing (`PROVIDERS[*].price`, $/1M tokens) feeds the spend and "saved vs all-Claude" totals.
- "Training" is prompt-level learning, not fine-tuning. Trainer notes and 👍-rated outputs get distilled, using the cheapest available model, into a per-agent `playbook` that `systemPrompt()` adds to every task. XP and level come from tasks, feedback, observing, and training, and a higher level slightly lowers routing scores.
- `server/index.js`: plain `node:http` with no framework. It serves the REST API under `/api/*`, SSE at `/api/events`, `public/`, and `node_modules/three` at `/vendor/three/`.
- `public/`: no build step. `index.html` has an import map that maps `three` and `three/addons/` to `/vendor/three/`, so the browser uses the npm copy of three. `main.js` builds the scene, animates agents toward server positions, and projects HTML overlays: a desk bubble showing the live output tail, and a name tag over each agent. `ui.js` re-renders the side panel (Tasks / Skills Lab / Models / Feed) from each `state` event.
- The agent roster and station layout are in `server/config.js`. To add an agent, add a desk station and an `AGENTS` entry. Its `keywords` drive auto-assignment.
