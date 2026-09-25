# OpenBot integration boundary

Inspected September 15, 2026: upstream `OpenBot` `main`. This is a source inspection, not a running integration. OpenBot is an alpha template whose workspaces are private; OpenMuse depends on standard AG-UI protocols and an HTTP adapter, not external package imports.

## Recommended OpenMuse configuration

These are proposed **OpenMuse** settings, not upstream environment variables:

```dotenv
OPENBOT_ENABLED=false
OPENBOT_BASE_URL=http://127.0.0.1:3001
OPENBOT_RUNTIME_PATH=/api/agent
OPENBOT_AGENT_ID=
```

Choose the agent ID from authenticated `GET /api/agents` when connecting. Resolve the URL on OpenMuse's server; phone loopback is not the server. Disabled or unreachable must report unavailable, never simulate a successful action. An eventual authenticated transport must preserve each person's OpenBot identity; a shared administrator session is unsuitable.

## Verified runtime and authentication

The upstream web provider uses `runtimeUrl="/api/agent"`, `credentials="include"`, and no `publicApiKey`. Better Auth session cookies identify users; API routes also check roles and Bot access. `/api/agent/info` can expose diagnostics/public agents anonymously, but runs and history resolve an authorized user. `OPENBOT_SINGLE_USER=true` bypasses sign-in as one administrator and is intended for local use. Native cookie storage, OAuth return links and cross-origin behavior still require integration work. Keep managed-agent tokens and computer tokens server-side.

OpenBot runtime routes provide AG-UI agent communication:

| Operation | Exact route |
| --- | --- |
| Runtime discovery | `GET /api/agent/info` |
| Run | `POST /api/agent/:agentId/run` with AG-UI `RunAgentInput` |
| Reconnect | `POST /api/agent/:agentId/connect` with `RunAgentInput` |
| Stop | `POST /api/agent/:agentId/stop/:threadId` |
| History | `GET /api/threads/:threadId/messages?agentId=:agentId` |

**Runtime run responses stream standard AG-UI events.** Use a compatible AG-UI client for transport. Separately, the supplied Bot service accepts `POST http://localhost:4200/ag-ui` with `RunAgentInput`, streams AG-UI SSE, and requires `x-openbot-agent-token: <MANAGED_AGENT_TOKEN>`. The LangGraph service uses port 4201. Connecting directly to that Bot omits OpenBot's runtime orchestration.

## Product API mapping

All paths below are relative to `OPENBOT_BASE_URL`; encode path IDs.

| OpenMuse capability | OpenBot request |
| --- | --- |
| Start conversation | `POST /api/channels` `{agentIds:[id]}` → `{channel:{id,agentIds,threadId,...}}` |
| Browser status/read/preview | `GET /api/computers/:botId/status`, `/read`, `/screenshot` |
| Live screen | WebSocket `/api/computers/:botId/stream`, session and Bot-access checked |
| Navigate | `POST /api/computers/:botId/navigate` `{url,toolCallId?}` |
| Inspect controls | `POST /api/computers/:botId/snapshot` → `{snapshotId,elements,...}` |
| Click/type | `POST .../click` `{ref,snapshotId}`; `POST .../type` adds `{text,submit?}` |
| Key/scroll | `POST .../key` `{key,ref?,snapshotId?}`; `POST .../scroll` `{deltaY?}` |
| Workspace files | `POST .../files/list` `{path?}`; `/files/read` `{path}`; `/files/write` `{path,contents,append?}` |
| Shell | `POST .../exec` `{command,timeoutMs?}`; timeout 1,000–600,000 ms |
| Human handover | `POST .../control/request` `{reason}`; `/control/take`; `/control/release` |
| Conversation upload | `POST /api/channels/:channelId/attachments`, multipart `file`, `uploadGroup` → `{id,name,mimeType,sizeBytes}` |
| Attachment download | `GET /api/attachments/:id` |

Here `...` means `/api/computers/:botId`.

## Adapter and action boundaries

An OpenMuse-owned [OpenBotAdapter](../packages/backends/src/openbot.ts) now exposes capability discovery, conversation creation, browser status/snapshots/navigation and control handover through an injected authenticated transport. It is disabled by default and has 13 contract tests; it is not connected to a deployment. Keep channel ID, thread ID, agent ID, Bot ID and action/proposal ID distinct. Computers belong to Bots, not individual chat sessions.

Implemented transport seam (the host supplies authenticated requests):

```ts
interface OpenBotTransport {
  runtimeUrl: string;
  request(path: string, init?: RequestInit): Promise<Response>;
}
```

The adapter's `runtime()` returns a descriptor for an AG-UI compatible client; it is not a raw SSE URL. `probe`, `createConversation`, `computerStatus`, `snapshot`, `navigate` and control methods validate responses and surface refusals. Cancellation is passed through AbortSignal; ambiguous mutations are marked as uncertain and are not retried. Workspace text-file operations and full browser interaction mapping remain extensions.

Navigation, browser actions, file operations and shell commands must use the server gateway, which checks policy and records decisions before acting. Never call computer port 4100 or supervisor endpoints from mobile. Snapshot refs are opaque and require their original `snapshotId`. Human control refuses Bot actions. OpenMuse's durable approval record remains necessary for its reviewed external writes; OpenBot policy decisions do not implement that approval lifecycle.

For a later custom AG-UI agent, preserve opaque `forwardedProps.openbotRun` and distinguish `openbotDeploymentTools` from frontend tools. Server-side granted tools call `POST /api/agent-tools/call` with `{name,args,run}` and `x-openbot-agent-token`; OpenBot verifies token and signed run together. These are agent credentials, not mobile login credentials.

## Remaining work

No deployment, session bridge, native transport or live round trip is connected. Next, test sign-in, run/reconnect/stop, browser policy refusal and handover against a pinned deployment. The [roadmap](../ROADMAP.md) also requires mapping scheduled routines and durable task execution before extending the computer infrastructure. Keep Gmail/Calendar integrations in OpenMuse: upstream's catalogue currently ships Drive and Notion. Keep PDF processing in OpenMuse: channel uploads accept selected images and text formats, and reject `application/pdf` with 415. Upstream workspace files and desktop host-folder grants are separate capabilities; neither supplies a native PDF workflow.
