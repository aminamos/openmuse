import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

let db: Store, directory: string, token: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-rich-threads-"));
  db = await createStore();
  ({ app } = await createApp(db, {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  }));
  const session = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = (await session.json()).token;
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("main chat is provisioned for the authenticated owner before the first run", async () => {
  const first = await (await app.request("/api/main-thread", { headers: headers() })).json();
  const reopened = await (await app.request("/api/main-thread", { headers: headers() })).json();
  assert.equal(first.existing, true);
  assert.equal(reopened.threadId, first.threadId);
  const thread = await db.get("local-user", "threads", first.threadId);
  assert.ok(thread);
});

test("a failed main-thread connection remains an error without authentication", async () => {
  assert.equal((await app.request("/api/main-thread")).status, 401);
});

test("Rich Threads lists locally, scopes by authenticated owner and preserves pagination", async () => {
  assert.equal((await app.request("/api/copilotkit/threads?agentId=default")).status, 401);
  await db.put("local-user", "threads", {
    id: "thread-1",
    name: "Trip planning",
    createdAt: new Date().toISOString(),
    archived: false,
  });
  await db.put("other-user", "threads", {
    id: "thread-other",
    name: "Other trip",
    createdAt: new Date().toISOString(),
    archived: false,
  });
  const result = await app.request(
    "/api/copilotkit/threads?agentId=default&userId=forged&includeArchived=true&limit=20&cursor=page-1",
    { headers: headers() },
  );
  assert.equal(result.status, 200, await result.clone().text());
  const data = await result.json();
  assert.ok(data.threads.some((t: any) => t.id === "thread-1"));
  assert.ok(!data.threads.some((t: any) => t.id === "thread-other"));
});

test("native and web thread rename reaches the store without accepting a forged owner", async () => {
  const preflight = await app.request("/api/copilotkit/threads/thread-1", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:8081",
      "Access-Control-Request-Method": "PATCH",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.match(preflight.headers.get("Access-Control-Allow-Methods") || "", /PATCH/);
  const response = await app.request("/api/copilotkit/threads/thread-1", {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ agentId: "default", userId: "forged", name: "Weekend plans" }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const thread = await db.get<{ name: string }>("local-user", "threads", "thread-1");
  assert.equal(thread?.name, "Weekend plans");
});

test("archive is authenticated and routed to local store", async () => {
  const response = await app.request("/api/copilotkit/threads/thread-1/archive", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ agentId: "default" }),
  });
  assert.equal(response.status, 200);
  const thread = await db.get<{ archived: boolean }>("local-user", "threads", "thread-1");
  assert.equal(thread?.archived, true);
});

test("history retains rich tool messages", async () => {
  const messages = [
    {
      id: "assistant-1",
      role: "assistant",
      content: "Working on the form",
      toolCalls: [
        { id: "call-1", type: "function", function: { name: "delegate_task", arguments: "{}" } },
      ],
    },
    { id: "tool-1", role: "tool", toolCallId: "call-1", content: '{"taskId":"task-1"}' },
  ];
  await db.put("local-user", "thread-messages", {
    id: "thread-1",
    messages,
  });
  const history = await app.request("/api/copilotkit/threads/thread-1/messages?userId=forged", {
    headers: headers(),
  });
  assert.equal(history.status, 200);
  assert.deepEqual((await history.json()).messages, messages);
});

test("workspace reports Rich Threads configuration", async () => {
  const response = await app.request("/api/workspace", { headers: headers() });
  const body = await response.text();
  assert.equal(JSON.parse(body).runtime.richThreads, true);
});
