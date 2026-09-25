import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { TestContext } from "node:test";

type ModelCall = { name: string; arguments: object };

// Serve the provider protocol, leaving tool execution and AG-UI event emission to the real SDK.
export async function modelFixture(
  t: TestContext,
  reply: (index: number) => ModelCall | undefined | Promise<ModelCall | undefined>,
) {
  const requests: { path: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const index = requests.length;
    requests.push({ path: request.url ?? "", body });
    const call = await reply(index);
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    const id = `chatcmpl-${index}`;
    if (call) {
      const chunk = {
        id,
        object: "chat.completion.chunk",
        created: 1000,
        model: "fixture",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call-${index}`,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      const finalChunk = {
        id,
        object: "chat.completion.chunk",
        created: 1000,
        model: "fixture",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      };
      response.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    } else {
      const finalChunk = {
        id,
        object: "chat.completion.chunk",
        created: 1000,
        model: "fixture",
        choices: [{ index: 0, delta: { content: "Done" }, finish_reason: "stop" }],
      };
      response.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const previousBase = process.env.OPENAI_BASE_URL;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENAI_API_KEY = "local-test-fixture";
  t.after(async () => {
    if (previousBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { requests };
}
