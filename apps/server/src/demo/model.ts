import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface ChatMessage {
  role: string;
  content?: string | Array<{ type: string; text?: string }> | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: "function";
    function: { name: string; parameters?: unknown };
  }>;
  stream?: boolean;
}

export interface FixtureResponse {
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}

export function getTextContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof (part as { text: string }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return undefined;
}

export const demoModel = "openai/openmuse-browser-demo";

const pageSchema = z.object({
  sessionId: z.string().min(1),
  url: z.url(),
  title: z.string(),
  text: z.string(),
  truncated: z.boolean(),
});

function targetUrl(prompt: string): string | undefined {
  if (/monterey|aquarium/i.test(prompt))
    return "https://www.montereybayaquarium.org/visit/exhibits";
  if (/copilotkit\.ai/i.test(prompt)) return "https://copilotkit.ai";
  if (/hacker\s*news|news\.ycombinator\.com|cool stuff/i.test(prompt))
    return "https://news.ycombinator.com";
  return undefined;
}

function summarizePage(message: ChatMessage): FixtureResponse {
  let value: unknown;
  try {
    value = JSON.parse(getTextContent(message.content) ?? "");
  } catch {
    return { content: "The browser did not return readable page data. Check the browser result." };
  }
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success)
    return { content: "The browser could not read that page. Check the browser result and retry." };
  const page = parsed.data;
  const lines = page.text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  let excerpts: string[];
  let introduction: string;
  if (new URL(page.url).hostname === "news.ycombinator.com") {
    excerpts = lines
      .map(
        (line, index) =>
          /^\d+\.\s+(.+)$/.exec(line)?.[1] ?? (/^\d+\.$/.test(line) ? lines[index + 1] : undefined),
      )
      .filter((line): line is string => Boolean(line))
      .slice(0, 3);
    introduction = "From the current Hacker News front page:";
  } else if (new URL(page.url).hostname.endsWith("montereybayaquarium.org")) {
    excerpts = lines
      .flatMap((line, index) => {
        if (lines[index - 1] !== "EXHIBIT" || !/^(Kelp Forest|Open Sea|Sea Otters)$/i.test(line))
          return [];
        const description = lines[index + 1];
        return [
          description && description !== "Explore exhibit" ? `${line}: ${description}` : line,
        ];
      })
      .slice(0, 3);
    introduction = "Exhibits from the aquarium’s own guide:";
  } else {
    excerpts = lines
      .filter((line) => line.length >= 45 && /agent|copilotkit|ag.ui|framework/i.test(line))
      .slice(0, 3);
    introduction = "From CopilotKit’s current page:";
  }
  if (!excerpts.length) {
    excerpts = lines.filter((line) => line.length >= 30).slice(0, 3);
    introduction = "Here are excerpts from the page I just opened:";
  }
  if (!excerpts.length)
    return { content: "The page opened, but it did not expose enough readable text to summarize." };
  const bullets = excerpts.map(
    (line) => `• ${line.length > 110 ? `${line.slice(0, 110).replace(/\s+\S*$/, "")}…` : line}`,
  );
  return {
    content: `${introduction}\n\n${bullets.join("\n")}\n\nSource: ${page.url}${page.truncated ? "\nThe browser returned a shortened page extract." : ""}`,
  };
}

function turnResult(turn: ChatMessage[], name: string, prefix: string) {
  const ids = new Set(
    turn.flatMap((message) =>
      (message.tool_calls ?? [])
        .filter((call) => call.function.name === name)
        .map((call) => call.id),
    ),
  );
  return turn.findLast(
    (message) =>
      message.role === "tool" &&
      message.tool_call_id &&
      (ids.has(message.tool_call_id) || message.tool_call_id.startsWith(prefix)),
  );
}

function parseResult(message: ChatMessage): unknown {
  try {
    return JSON.parse(getTextContent(message.content) ?? "");
  } catch {
    return undefined;
  }
}

function demoMailResponse(request: ChatCompletionRequest, turn: ChatMessage[]): FixtureResponse {
  const read = turnResult(turn, "read_mail_thread", "call_openmuse_demo_mail_read_");
  if (read) {
    const parsed = z
      .object({
        messages: z.array(z.object({ sender: z.string(), subject: z.string(), body: z.string() })),
      })
      .safeParse(parseResult(read));
    const message = parsed.success ? parsed.data.messages.at(-1) : undefined;
    if (!message)
      return {
        content: "I couldn’t read the school-trip email. Check the mail result and try again.",
      };
    const paragraphs = message.body
      .split(/\n\s*\n/)
      .map((text) => text.trim())
      .filter((text) => text.length > 40 && !/local workspace/i.test(text))
      .slice(0, 2);
    if (!paragraphs.length)
      return { content: "The email was found, but it did not include readable trip details." };
    return {
      content: `From ${message.sender}:\n“${message.subject}”\n\n${paragraphs.join("\n\n")}\n\nI can look up the aquarium next.`,
    };
  }
  const search = turnResult(turn, "search_mail", "call_openmuse_demo_mail_search_");
  if (search) {
    const parsed = z
      .object({ matches: z.array(z.object({ threadId: z.string(), subject: z.string() })) })
      .safeParse(parseResult(search));
    if (!parsed.success)
      return { content: "I couldn’t check your inbox. Check the mail connection and try again." };
    const match = parsed.data.matches[0];
    if (!match) return { content: "I didn’t find a school-trip email in the connected mailbox." };
    if (!request.tools?.some((tool) => tool.function.name === "read_mail_thread"))
      return {
        content: "The email reader is unavailable. Open Mail to read the matching message.",
      };
    return {
      content: "I found the school’s reminder. I’ll read the details.",
      toolCalls: [
        {
          id: `call_openmuse_demo_mail_read_${randomUUID()}`,
          name: "read_mail_thread",
          arguments: JSON.stringify({ threadId: match.threadId }),
        },
      ],
    };
  }
  if (!request.tools?.some((tool) => tool.function.name === "search_mail"))
    return { content: "Mail search is unavailable. Connect the mailbox before checking email." };
  return {
    content: "I’ll check your inbox for the school trip.",
    toolCalls: [
      {
        id: `call_openmuse_demo_mail_search_${randomUUID()}`,
        name: "search_mail",
        arguments: JSON.stringify({ query: "aquarium" }),
      },
    ],
  };
}

/** Script only the model: the app executes real mailbox reads and browser tools. */
export function demoResponse(request: ChatCompletionRequest): FixtureResponse {
  const userIndex = request.messages.findLastIndex((message) => message.role === "user");
  const user = request.messages[userIndex];
  const prompt = user ? (getTextContent(user.content) ?? "") : "";
  const turn = request.messages.slice(userIndex + 1);
  if (/email|inbox/i.test(prompt)) return demoMailResponse(request, turn);
  const url = targetUrl(prompt);
  if (!url)
    return {
      content:
        "Try “Find cool stuff on Hacker News”, “Summarize copilotkit.ai”, “Check my emails for the school trip”, or “Research Monterey Bay Aquarium”.",
    };

  // Only the latest turn can satisfy this request; older browser reads cannot suppress a new visit.
  const calls = new Set(
    turn.flatMap((message) =>
      (message.tool_calls ?? [])
        .filter((call) => call.function.name === "browse_web")
        .map((call) => call.id),
    ),
  );
  const result = turn.findLast(
    (message) =>
      message.role === "tool" &&
      message.tool_call_id &&
      (calls.has(message.tool_call_id) ||
        message.tool_call_id.startsWith("call_openmuse_demo_browse_")),
  );
  if (result) return summarizePage(result);
  if (!request.tools?.some((tool) => tool.function.name === "browse_web"))
    return { content: "The browse_web tool is not available. Start the API with browser support." };
  return {
    content: url.includes("ycombinator")
      ? "I’ll open Hacker News and read the front page."
      : url.includes("montereybayaquarium")
        ? "I’ll research the exhibits on the aquarium’s own website."
        : "I’ll open CopilotKit and read the page.",
    toolCalls: [
      {
        id: `call_openmuse_demo_browse_${randomUUID()}`,
        name: "browse_web",
        arguments: JSON.stringify({ url }),
      },
    ],
  };
}

export function createDemoModel(
  options: { port?: number; latency?: number; firstByteDelay?: number } = {},
) {
  const latency = options.latency ?? 80;
  const firstByteDelay = options.firstByteDelay ?? options.latency ?? 1500;
  if (![latency, firstByteDelay].every((value) => Number.isFinite(value) && value >= 0))
    throw new Error("Demo model delays must be finite nonnegative milliseconds");

  let server: import("node:http").Server | undefined;
  let port = options.port ?? 0;
  let serverUrl = "";

  const requests: ChatCompletionRequest[] = [];
  return {
    get url() {
      return serverUrl;
    },
    getRequests() {
      return requests;
    },
    async start() {
      const http = await import("node:http");
      server = http.createServer(async (req, res) => {
        if (req.method === "POST" && (req.url === "/v1/chat/completions" || req.url === "/chat/completions")) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const bodyStr = Buffer.concat(chunks).toString("utf8");
          const request = JSON.parse(bodyStr) as ChatCompletionRequest;
          requests.push(request);
          const fixture = demoResponse(request);

          if (request.stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            if (firstByteDelay > 0) {
              await new Promise((r) => setTimeout(r, firstByteDelay));
            }
            const id = "chatcmpl-" + randomUUID();
            if (fixture.toolCalls && fixture.toolCalls.length > 0) {
              for (let i = 0; i < fixture.toolCalls.length; i++) {
                const tc = fixture.toolCalls[i];
                const chunk = {
                  id,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: request.model,
                  choices: [{
                    index: 0,
                    delta: {
                      role: "assistant",
                      tool_calls: [{
                        index: i,
                        id: tc.id,
                        type: "function",
                        function: {
                          name: tc.name,
                          arguments: tc.arguments,
                        },
                      }],
                    },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
              const finalChunk = {
                id,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: request.model,
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
              };
              res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            } else if (fixture.content) {
              const chunkSize = 14;
              const content = fixture.content;
              for (let i = 0; i < content.length; i += chunkSize) {
                const slice = content.slice(i, i + chunkSize);
                const chunk = {
                  id,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: request.model,
                  choices: [{
                    index: 0,
                    delta: { content: slice },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                if (latency > 0) {
                  await new Promise((r) => setTimeout(r, latency));
                }
              }
              const finalChunk = {
                id,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: request.model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              };
              res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            }
            res.write("data: [DONE]\n\n");
            res.end();
          } else {
            const id = "chatcmpl-" + randomUUID();
            const message: any = { role: "assistant" };
            if (fixture.content) message.content = fixture.content;
            if (fixture.toolCalls && fixture.toolCalls.length > 0) {
              message.tool_calls = fixture.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: tc.arguments },
              }));
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              id,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: request.model,
              choices: [{
                index: 0,
                message,
                finish_reason: fixture.toolCalls ? "tool_calls" : "stop",
              }],
            }));
          }
        } else {
          res.writeHead(404).end("Not found");
        }
      });
      await new Promise<void>((resolve) => {
        server!.listen(port, "127.0.0.1", () => {
          const addr = server!.address() as import("node:net").AddressInfo;
          port = addr.port;
          serverUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    },
    async stop() {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = undefined;
      }
    },
  };
}
