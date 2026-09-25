import "./config.ts";
import { randomUUID } from "node:crypto";
import { HttpAgent } from "@ag-ui/client";
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { Hono } from "hono";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { ConversationAgent } from "./engine/conversation.ts";
import type { AgentService } from "./engine/service.ts";

export function agentConfigured(config: Config) {
  return (
    config.agentBackend === "sample" ||
    (config.agentBackend === "agui"
      ? Boolean(config.agentUrl)
      : Boolean(
          config.model &&
            (process.env.OPENAI_API_KEY ||
              process.env.ANTHROPIC_API_KEY ||
              process.env.GOOGLE_API_KEY),
        ))
  );
}

export function makeRuntime(config: Config, service: AgentService, auth: Auth, db: Store) {
  const router = new Hono<{ Variables: { owner: string } }>();

  // Preflight CORS for patch/post/etc.
  router.options("*", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    c.header("Access-Control-Allow-Headers", "authorization, content-type");
    return c.body(null, 204);
  });

  // Info
  router.get("/info", (c) =>
    c.json({
      version: "openmuse-1.0.0",
      agents: [{ id: "default", name: "OpenMuse" }],
    }),
  );

  // Connect & Stop
  router.post("/agent/:agentId/connect", (c) =>
    c.json({ ok: true, agentId: c.req.param("agentId") }),
  );
  router.post("/agents/:agentId/connect", (c) =>
    c.json({ ok: true, agentId: c.req.param("agentId") }),
  );
  router.post("/agent/connect", (c) => c.json({ ok: true, agentId: "default" }));
  router.post("/agents/connect", (c) => c.json({ ok: true, agentId: "default" }));
  router.post("/agent/:agentId/stop", (c) => c.json({ ok: true }));
  router.post("/agents/:agentId/stop", (c) => c.json({ ok: true }));
  router.post("/agent/stop", (c) => c.json({ ok: true }));
  router.post("/agents/stop", (c) => c.json({ ok: true }));

  // Threads API
  router.get("/threads", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader) return c.json({ error: "Unauthorized" }, 401);
    const owner = await auth.owner(authHeader);
    const includeArchived = c.req.query("includeArchived") === "true";
    const limit = Number(c.req.query("limit") ?? "20");
    const cursor = c.req.query("cursor");

    const allThreads = await db.list<{
      id: string;
      name?: string;
      archived?: boolean;
      createdAt?: string;
    }>(owner, "threads");
    const filtered = includeArchived ? allThreads : allThreads.filter((t) => !t.archived);

    let startIndex = 0;
    if (cursor) {
      const idx = filtered.findIndex((t) => t.id === cursor);
      if (idx >= 0) startIndex = idx + 1;
    }
    const page = filtered.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + limit < filtered.length ? page.at(-1)?.id : undefined;

    return c.json({
      threads: page,
      nextCursor,
    });
  });

  router.patch("/threads/:id", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader) return c.json({ error: "Unauthorized" }, 401);
    const owner = await auth.owner(authHeader);
    const id = c.req.param("id");
    const body = await c.req.json();
    const existing = (await db.get<{ id: string; name?: string; archived?: boolean }>(
      owner,
      "threads",
      id,
    )) ?? { id };
    const updated = { ...existing, name: body.name ?? body.updates?.name ?? existing.name };
    await db.put(owner, "threads", updated);
    return c.json({ id: updated.id, name: updated.name });
  });

  router.post("/threads/:id/archive", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader) return c.json({ error: "Unauthorized" }, 401);
    const owner = await auth.owner(authHeader);
    const id = c.req.param("id");
    const existing = (await db.get<{ id: string; name?: string; archived?: boolean }>(
      owner,
      "threads",
      id,
    )) ?? { id };
    const updated = { ...existing, archived: true };
    await db.put(owner, "threads", updated);
    return c.json({ id: updated.id, archived: true });
  });

  router.get("/threads/:id/messages", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader) return c.json({ error: "Unauthorized" }, 401);
    const owner = await auth.owner(authHeader);
    const id = c.req.param("id");
    const stored = await db.get<{ id: string; messages: unknown[] }>(owner, "thread-messages", id);
    return c.json({ messages: stored?.messages ?? [] });
  });

  // Run agent handler
  const handleRun = async (c: any) => {
    const authHeader = c.req.header("authorization");
    const owner = await auth.owner(authHeader ?? undefined);
    const raw = await c.req.json();

    const threadId = raw.threadId ?? randomUUID();
    const runId = raw.runId ?? randomUUID();
    const input: RunAgentInput = {
      threadId,
      runId,
      messages: raw.messages ?? [],
      tools: raw.tools ?? [],
      context: raw.context ?? [],
      forwardedProps: raw.forwardedProps ?? {},
      state: raw.state ?? {},
    };

    const agent =
      config.agentBackend === "sample"
        ? new ConversationAgent(config, service, owner)
        : config.agentBackend === "agui"
          ? new HttpAgent({
              url: config.agentUrl ?? "http://127.0.0.1:1/unconfigured",
              headers: config.agentToken ? { Authorization: `Bearer ${config.agentToken}` } : {},
            })
          : new ConversationAgent(config, service, owner);

    const encoder = new TextEncoder();
    let assistantMessageId = "";
    let assistantContent = "";
    const stream = new ReadableStream({
      start(controller) {
        const subscription = agent.run(input).subscribe({
          next(event: BaseEvent) {
            if (event.type === EventType.TEXT_MESSAGE_START) {
              assistantMessageId = (event as any).messageId ?? randomUUID();
            } else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
              assistantContent += (event as any).delta ?? (event as any).content ?? "";
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          },
          error(err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: EventType.RUN_ERROR, message })}\n\n`),
            );
            controller.close();
          },
          complete() {
            void (async () => {
              try {
                if (threadId) {
                  const stored = (await db.get<{ id: string; messages: unknown[] }>(
                    owner,
                    "thread-messages",
                    threadId,
                  )) ?? { id: threadId, messages: [] };
                  const existingMessages = Array.isArray(stored.messages) ? stored.messages : [];
                  const existingIds = new Set(existingMessages.map((m: any) => m.id));
                  const newMessages = [...existingMessages];
                  for (const m of input.messages) {
                    if (
                      m &&
                      typeof m === "object" &&
                      "id" in m &&
                      !existingIds.has((m as any).id)
                    ) {
                      newMessages.push(m);
                      existingIds.add((m as any).id);
                    }
                  }
                  if (assistantContent) {
                    newMessages.push({
                      id: assistantMessageId || randomUUID(),
                      role: "assistant",
                      content: assistantContent,
                    });
                  }
                  await db.put(owner, "thread-messages", { id: threadId, messages: newMessages });
                }
              } catch {
                // best effort persistence
              } finally {
                controller.close();
              }
            })();
          },
        });

        c.req.raw.signal.addEventListener("abort", () => {
          subscription.unsubscribe();
          agent.abortRun?.();
          try {
            controller.close();
          } catch {}
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };

  router.post("/agent/:agentId/run", handleRun);
  router.post("/agents/:agentId/run", handleRun);
  router.post("/agent/:agentId", handleRun);
  router.post("/agents/:agentId", handleRun);
  router.post("/agent/run", handleRun);
  router.post("/agents/run", handleRun);
  router.post("/run", handleRun);
  router.post("/", handleRun);

  return router;
}
