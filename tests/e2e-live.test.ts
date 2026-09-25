import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { createDemoModel, demoModel } from "../apps/server/src/demo/model.ts";

let db: Store,
  directory: string,
  token: string,
  mock: ReturnType<typeof createDemoModel>,
  app: Awaited<ReturnType<typeof createApp>>["app"];

const headers = () => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-e2e-live-"));
  mock = createDemoModel({ latency: 5, firstByteDelay: 10 });
  await mock.start();

  process.env.OPENAI_API_KEY = "mock-key";
  process.env.OPENAI_BASE_URL = `${mock.url}/v1`;

  db = await createStore({ dataDir: join(directory, "postgres") });
  token = "openmuse-test-session-token-2026";
  await db.put("system", "sessions", {
    id: createHash("sha256").update(token).digest("hex"),
    owner: "local-user",
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });

  ({ app } = await createApp(db, {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
    model: demoModel,
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  }));
});

after(async () => {
  await db.close();
  await mock.stop();
  await rm(directory, { recursive: true, force: true });
});

test("E2E: health and workspace reports active runtime without CopilotKit", async () => {
  const healthRes = await app.request("/api/health");
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.ok, true);
  assert.equal(health.agentConfigured, true);

  const wsRes = await app.request("/api/workspace", { headers: headers() });
  assert.equal(wsRes.status, 200);
  const ws = await wsRes.json();
  assert.equal(ws.runtime.provider, "model");
  assert.equal(ws.runtime.configured, true);
  assert.equal(ws.runtime.richThreads, true);
});

test("E2E: full agent run streams AG-UI SSE events and persists thread history", async () => {
  const mainThreadRes = await app.request("/api/main-thread", { headers: headers() });
  assert.equal(mainThreadRes.status, 200);
  const { threadId } = await mainThreadRes.json();
  assert.ok(threadId);

  const runRes = await app.request("/api/copilotkit/agents/default/run", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      threadId,
      messages: [{ id: "msg-user-1", role: "user", content: "What can you do?" }],
    }),
  });
  assert.equal(runRes.status, 200);

  const reader = runRes.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let sseBuffer = "";
  const events: any[] = [];
  let streamedText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          events.push(parsed);
          if (parsed.type === "TEXT_MESSAGE_CONTENT") {
            streamedText += parsed.delta ?? "";
          }
        }
      }
    }
  }

  const types = events.map((e) => e.type);
  assert.ok(types.includes("RUN_STARTED"));
  assert.ok(types.includes("TEXT_MESSAGE_START"));
  assert.ok(types.includes("TEXT_MESSAGE_CONTENT"));
  assert.ok(types.includes("TEXT_MESSAGE_END"));
  assert.ok(types.includes("RUN_FINISHED"));
  assert.match(streamedText, /Hacker News|aquarium/i);

  // Verify persistence
  const historyRes = await app.request(`/api/copilotkit/threads/${threadId}/messages`, {
    headers: headers(),
  });
  assert.equal(historyRes.status, 200);
  const { messages } = await historyRes.json();
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, streamedText);
});
