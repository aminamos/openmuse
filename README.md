<div align="center">

# OpenMuse

**A personal agent with a browser, terminal, files, and work that keeps going. Fully open, vendor-neutral, and compatible with any agent harness.**

Ask for an outcome. Follow the plan, review actions, and come back to the result.
Built with React Native and open AG-UI primitives for iOS, Android, and web.

[Quick start](#quick-start) · [Demo](#demo) · [Features](#features) · [Architecture](#architecture) · [Docs](docs/README.md) · [Contributing](CONTRIBUTING.md)

[![CI](https://github.com/aminamos/openmuse/actions/workflows/ci.yml/badge.svg)](https://github.com/aminamos/openmuse/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Clone this template and customize it however you want — runs 100% locally with zero vendor lock-in.

[![OpenMuse 🪁 — Ask it to browse. Watch the 38-second mobile demo.](assets/demos/2026-09-16/mobile.png)](assets/demos/2026-09-16/mobile.mp4)

**[Watch the mobile demo · 38 seconds](assets/demos/2026-09-16/mobile.mp4)**

[![OpenMuse 🪁 on the web — Watch the 42-second desktop demo.](assets/demos/2026-09-16/web.png)](assets/demos/2026-09-16/web.mp4)

**[Watch the web demo · 42 seconds](assets/demos/2026-09-16/web.mp4)**

</div>

> **Alpha, for self-hosting and building on.** 100% self-hosted with local database-backed conversation persistence. Open-ended reasoning and live Google accounts can be configured as needed. See [what is verified](docs/VERIFICATION.md) and the [roadmap](ROADMAP.md).

## Demo

On iPhone, ask OpenMuse to find interesting stories on Hacker News and summarize web articles. On desktop, ask it to check the school-trip email, open the message, and research exhibits at Monterey Bay Aquarium. The agent shows email and browser results inline. **Take control** opens that same browser session when you need it.

The 38-second iPhone and 42-second desktop web demos show the current interface, framed in 16:9. The send arrow becomes a stop square inside the input pill while the agent replies, then switches back. Stopping keeps your draft intact. See the [recording notes](docs/DEMO.md) for the model setup and reproduction steps.

[Mobile MP4](assets/demos/2026-09-16/mobile.mp4) · [Web MP4](assets/demos/2026-09-16/web.mp4) · [Recording details and reproduction](docs/DEMO.md)

## What it is

OpenMuse is a personal-agent application with an agent computer, visible work, and rich results. It runs its own server, task worker, and browser worker. You can inspect and change the source under the MIT license.

The computer combines **persistent Chromium and an optional Linux workspace**. The agent can browse public pages, run commands in its own container, work with files, and move PDFs between the computer and the app. You can open its browser or terminal and continue the work. Graphical desktops and autonomous checkout remain future work.

## Features
 
| Surface | What runs in this alpha |
| --- | --- |
| **Chat** | Open AG-UI chat with streamed events, mailbox search and reading, send/stop in one input pill, a visible follow-up queue, retained drafts, delegated tasks, and inline email, browser, PDF, plan, and finance cards. |
| **Agent computer** | Persistent browser profiles and takeover console; optional isolated Linux terminal, saved command receipts, editable workspace files, and PDF transfer. |
| **Activity** | Durable task plans, progress, input requests, pause/resume/cancel/retry, approvals, and saved receipts. SQL leases recover interrupted work. |
| **Ideas** | Suggestions with source evidence; edit, accept, or dismiss. Sent replies and completed matching work are excluded. |
| **Goals & Tracking** | Goals and milestones; recurring public-page checks for changes, text availability, or USD price thresholds, with deduplicated alerts and failure backoff. |
| **Documents** | Email attachment → PDF → requested form values → filled copy → reviewed reply → receipt. Native/web PDF viewing, paging, zoom, supported fields, and sharing. |
| **Finance** | Import transaction CSV to create a spending summary with categories, transactions, and a savings-goal action. |
| **Gmail & Calendar** | Google OAuth adapters, complete mail threads, drafts/attachments, calendar discovery, and reviewed event creation/update/deletion. Live credentials required. |
| **Personal context** | Editable name, tone, avatar, and memories. Background-update preferences and durable in-app notifications. |
| **Rich Threads** | Native local SQLite/PostgreSQL conversation persistence in every mode, with a stable main conversation, side chats, renaming, archiving, restoring, and replay. Completely vendor-neutral with no external keys required. |

The [feature inventory](docs/FEATURES.md) describes implemented capabilities and planned extensions. Health/bank/social connectors, device push, voice, generated executable tools, and automatic reservations/payments are on the [roadmap](ROADMAP.md).

## Quick start

**Requirements:** Node 24 LTS and pnpm 11.19.0. The local sample app runs 100% locally with no external model, Google account, or Docker needed.

```sh
git clone https://github.com/aminamos/openmuse.git openmuse
cd openmuse
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

In another terminal:

```sh
pnpm dev:web
```

Open [localhost:8081](http://localhost:8081). The API runs at [localhost:8787/api/health](http://localhost:8787/api/health).

### Try it

1. In Chat, send **“Complete the permission slip”**. Open the task, supply fictional form values, inspect the saved PDF, and review the prepared reply. This writes only to the local mailbox.
2. In **Goals → Track**, create a built-in availability watch, then change the built-in test page to trigger an alert.
3. In **Menu → Delegate task → Finance**, use **Try example transactions** to create an interactive spending tracker.
4. Start the [browser worker](#browser-worker) and configure a model, then ask **“Check out Hacker News for cool stuff”** or **“Summarize news.ycombinator.com”**. Follow the browser inline and use **Take control** to open its session. For a model-free version of this flow, follow the [AI Mock demo setup](docs/DEMO.md#run-the-agent-browser-demo).

For iOS or Android, use `pnpm --dir apps/mobile ios` or `pnpm --dir apps/mobile android`. Xcode or Android tooling is required. The PDF reader needs an Expo development build; use [native setup](apps/mobile/README.md).

## Configure the agent and Google

Copy the commented settings in [.env.example](.env.example) into your private `.env`:

1. Set `AGENT_BACKEND=model`, `MODEL=provider/model-id`, and the matching provider key. Supports standard OpenAI, Anthropic, or Google models, as well as local OpenAI-compatible endpoints (Ollama, vLLM, LMStudio, etc.). Fictional data can still be used with a real model. Provider keys stay on the server.
2. For personal mail/calendar, set `WORKSPACE_MODE=live`, a random `OPENMUSE_ACCESS_KEY` of at least 24 characters, and `TOKEN_ENCRYPTION_KEY` containing 32 random bytes encoded as base64. Restart the API.
3. Configure a Google OAuth web client with Gmail and Calendar APIs enabled. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; register `${PUBLIC_API_URL}/api/google/callback` as its redirect URI. Configure consent/test-user access in your Google project.
4. Open **Apps → Gmail** (or **Google Calendar**), connect read access, and grant write access when needed. Every send or calendar change still requires its own stored review. Changing/disconnecting the account invalidates pending connection-bound work.

Google credentials are encrypted at rest. File URLs and browser consoles use short-lived signatures. This deployment uses one owner protected by a shared access key; it is not a multi-tenant authentication system. Use HTTPS and restricted network access for a remote host. Keep the default local-data mode on loopback.

## Browser worker

Set `BROWSER_WORKER_URL=http://127.0.0.1:8790` and a random `WORKER_TOKEN` of at least 32 characters in `.env`.

```sh
pnpm --dir apps/worker exec playwright install chromium
pnpm dev:browser
```

Or use `docker compose --env-file .env -f infra/compose.yaml up --build -d`. The same token must reach the API and worker. Sessions have persistent Chromium profiles; the app can open a live screenshot console and import PDF downloads. Agent tools can read public pages and hand interactive work to the person. [Worker setup and boundaries](apps/worker/README.md).

## Persistence and operation

### Linux terminal and workspace

Build the computer image, enable it on the API, then open **Computer → Terminal → Start computer**:

```sh
docker build -t openmuse-computer:local apps/computer
COMPUTER_ENABLED=true pnpm dev
```

The API needs access to the Docker CLI and engine. Commands run in a nonroot container with no host-directory mounts or credentials. A named `/workspace` volume retains files when stopped. Terminal networking is disabled; public web access uses the browser worker. Commands have a 30-second limit and saved output/exit receipts. **Files** supports folders, text editing, and PDF transfer to/from Documents. This is a Linux container, not a full operating-system VM. [Setup, Colima option, and boundaries](docs/COMPUTER.md).

### Application storage

By default, embedded PGlite, documents and the signing key live in `.openmuse/`; browser profiles live in `.openmuse/browser-profiles/`. Keep that directory private and back it up. The API hosts the task worker. The host must remain running for background work.

For a separate task worker, configure the same `DATABASE_URL`, secrets and shared `DATA_DIR` for both processes, then set `TASK_WORKER_ENABLED=false` on the API and run `pnpm dev:worker`. PGlite cannot be opened by separate processes. Production commands are `pnpm build:server`, `pnpm start` and `pnpm start:worker`. Run one API instance; task workers coordinate through SQL leases.

No hidden retry occurs after an uncertain external write. Review its provider outcome before creating a replacement. Pausing/cancelling prevents subsequent task steps; an already approved in-flight provider request may finish.

## Architecture & Zero Vendor Lock-in

OpenMuse is engineered with an entirely open, vendor-neutral architecture:

```mermaid
flowchart TD
  subgraph Frontend["Frontend Client (apps/mobile)"]
    UI[Expo / React Native / React Native Web]
    AGUIClient[Open AG-UI Client & Hooks]
    UI --- AGUIClient
  end

  subgraph Backend["API Server (apps/server)"]
    Hono[Hono API Gateway]
    Runner[Native Agent Runner (Vercel AI SDK)]
    SSE[AG-UI Event Stream (RxJS / SSE)]
    Worker[Durable Task Worker]
    Reviews[Action Review & Approvals]
  end

  subgraph Persistence["Local Persistence"]
    DB[(PostgreSQL / PGLite)]
    Threads[(Threads & Messages Store)]
    Artifacts[(Files, Artifacts & Documents)]
  end

  subgraph Execution["Agent Execution Environment"]
    BrowserWorker[Playwright Chromium Browser Worker]
    Docker[Optional Rootless Linux Docker Container]
    Google[Gmail / Google Calendar Adapters]
  end

  AGUIClient -->|AG-UI SSE Events & REST API| Hono
  Hono --> Runner
  Runner --> SSE
  SSE --> AGUIClient
  Hono --> Threads
  Hono --> Worker
  Worker --> DB
  Threads --> DB
  Worker --> Reviews
  Reviews --> Google
  Runner --> Execution
  Worker --> BrowserWorker
  Worker --> Docker
  Worker --> Artifacts
```

### Core Architecture Highlights

1. **Vendor-Neutral Agent Engine (`apps/server/src/engine/agent-runner.ts`):**
   - Replaced proprietary agent runtimes with an open implementation powered by the **Vercel AI SDK** (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`).
   - Supports any standard model provider or local model server (Ollama, vLLM, LocalAI) via OpenAI-compatible endpoints without vendor lock-in.
   - Streams standard AG-UI events (`EventType.TEXT_MESSAGE_*`, `EventType.TOOL_CALL_*`) over Server-Sent Events (SSE).

2. **100% Local Thread & Conversation Persistence:**
   - Conversation threads and messages persist directly to the embedded PGlite (or external PostgreSQL) database.
   - Provides full support for side chats, renaming, archiving, restoring, and replaying without requiring any cloud intelligence platform or API keys (`CPK_INTELLIGENCE_API_KEY` removed).

3. **Open-Protocol Client Hooks (`apps/mobile/src/agent-client.tsx`):**
   - Standard React Native hooks built directly on `@ag-ui/client` and React Native primitives: `useAgent`, `useThreads`, `useRenderTool`, `useRenderToolCall`, and `useAgentContext`.
   - Renders interactive inline cards for web browsing, emails, PDFs, task delegation, goals, and system monitoring.

| Directory | Purpose |
| --- | --- |
| `apps/mobile` | Shared iOS, Android, and web UI built on native open-protocol AG-UI hooks. |
| `apps/server` | Hono API, native AI SDK agent runner, identity boundary, task engine, reviews, and DB persistence. |
| `apps/worker` | Token-protected Playwright browser service with persistent profiles. |
| `apps/computer` | Nonroot Linux image, bounded filesystem helper, and container verification. |
| `packages/domain` | Shared types, schemas, and request validation. |
| `packages/integrations` | Google and browser protocol adapters. |
| `packages/backends` | Optional OpenBot HTTP adapter and its identity boundary. |
| `tests` | Complete test suite covering workflows, agent runner, persistence, and authorization. |

### OpenBot compatibility

OpenMuse's native client and personal-agent workflows are independent of OpenBot. The disabled OpenBot adapter is pinned and contract-tested against upstream interfaces. Live user/session bridging, routine mapping, and computer backend wiring remain future work. [Integration contract](docs/OPENBOT-INTEGRATION.md).

## Development

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build:server
pnpm build:web
pnpm build:ios
pnpm build:android
pnpm --dir apps/worker typecheck
pnpm test:browser
pnpm test:computer
```

Platform build scripts export JavaScript/Hermes bundles; they do not produce signed app binaries. Browser checks require installed Chromium and public fixture access. CI also exercises the browser and Linux computer containers. See [contribution guidance](CONTRIBUTING.md) and [verification results](docs/VERIFICATION.md).

## Contributing and license

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), [ROADMAP.md](ROADMAP.md), and the [security policy](SECURITY.md).

MIT licensed. Website, email, and document content supplies evidence, not permission to act.
