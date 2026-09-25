import { randomUUID } from "node:crypto";
import { AbstractAgent } from "@ag-ui/client";
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { tool as createAiTool, stepCountIs, streamText } from "ai";
import { Observable } from "rxjs";
import type { z } from "zod";

export interface ToolDefinition<T extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: T;
  execute: (args: z.output<T>) => Promise<unknown>;
}

export function defineTool<T extends z.ZodType>(config: {
  name: string;
  description: string;
  parameters: T;
  execute: (args: z.output<T>) => Promise<unknown>;
}): ToolDefinition<T> {
  return config;
}

export function resolveModel(spec: string, apiKey?: string): any {
  if (typeof spec !== "string") return spec as any;
  const parts = spec.replace("/", ":").trim().split(":");
  const rawProvider = parts[0]?.toLowerCase();
  const modelId = parts.slice(1).join(":").trim();
  if (!rawProvider || !modelId) {
    throw new Error(
      `Invalid model string "${spec}". Expected format like "openai/gpt-4o", "anthropic/claude-3-5-sonnet", or "google/gemini-2.5-flash".`,
    );
  }

  switch (rawProvider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY || "no-key",
        baseURL: process.env.OPENAI_BASE_URL,
      });
      return openai.chat(modelId);
    }
    case "anthropic":
      return createAnthropic({
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY || "no-key",
        baseURL: process.env.ANTHROPIC_BASE_URL,
      })(modelId);
    case "google":
    case "gemini":
    case "google-gemini":
      return createGoogleGenerativeAI({
        apiKey: apiKey || process.env.GOOGLE_API_KEY || "no-key",
        baseURL: process.env.GOOGLE_GENERATIVE_AI_BASE_URL,
      })(modelId);
    default: {
      const openai = createOpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY || "no-key",
        baseURL: process.env.OPENAI_BASE_URL,
      });
      return openai.chat(modelId);
    }
  }
}

export interface BuiltInAgentConfig {
  model: string;
  maxSteps?: number;
  maxRetries?: number;
  tools?: ToolDefinition[];
  prompt?: string;
  apiKey?: string;
}

export class BuiltInAgent extends AbstractAgent {
  private abortController?: AbortController;

  constructor(private readonly config: BuiltInAgentConfig) {
    super({ agentId: "default" });
  }

  abortRun(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });

      (async () => {
        try {
          const model = resolveModel(this.config.model, this.config.apiKey);

          // Build system prompt
          let system = this.config.prompt;
          if (input.context && input.context.length > 0) {
            const ctxText = input.context
              .map((c) => `${c.description}:\n${JSON.stringify(c.value)}`)
              .join("\n\n");
            system = system ? `${system}\n\n## Context\n${ctxText}` : ctxText;
          }

          // Convert input.messages to Vercel AI SDK format
          const modelMessages: Array<
            | { role: "system"; content: string }
            | { role: "user"; content: string }
            | {
                role: "assistant";
                content:
                  | string
                  | Array<
                      | { type: "text"; text: string }
                      | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
                    >;
              }
            | {
                role: "tool";
                content: Array<{
                  type: "tool-result";
                  toolCallId: string;
                  toolName: string;
                  result: unknown;
                }>;
              }
          > = [];

          for (const m of input.messages) {
            if (m.role === "system") {
              modelMessages.push({
                role: "system",
                content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
              });
            } else if (m.role === "user") {
              modelMessages.push({
                role: "user",
                content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
              });
            } else if (m.role === "assistant") {
              const toolCalls = "toolCalls" in m && Array.isArray(m.toolCalls) ? m.toolCalls : [];
              if (toolCalls.length > 0) {
                const parts: Array<
                  | { type: "text"; text: string }
                  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
                > = [];
                if (m.content && typeof m.content === "string") {
                  parts.push({ type: "text", text: m.content });
                }
                for (const tc of toolCalls) {
                  let args: unknown = {};
                  try {
                    args =
                      typeof tc.function?.arguments === "string"
                        ? JSON.parse(tc.function.arguments)
                        : (tc.function?.arguments ?? {});
                  } catch {
                    args = tc.function?.arguments;
                  }
                  parts.push({
                    type: "tool-call",
                    toolCallId: tc.id,
                    toolName: tc.function?.name ?? "unknown",
                    input: args ?? {},
                  } as any);
                }
                modelMessages.push({ role: "assistant", content: parts });
              } else {
                modelMessages.push({
                  role: "assistant",
                  content: typeof m.content === "string" ? m.content : "",
                });
              }
            } else if (m.role === "tool") {
              let toolName = "unknown";
              for (const prev of input.messages) {
                if (
                  prev.role === "assistant" &&
                  "toolCalls" in prev &&
                  Array.isArray(prev.toolCalls)
                ) {
                  const match = prev.toolCalls.find(
                    (c) => c.id === (m as { toolCallId?: string }).toolCallId,
                  );
                  if (match?.function?.name) {
                    toolName = match.function.name;
                    break;
                  }
                }
              }
              const textValue =
                typeof m.content === "string" ? m.content : JSON.stringify(m.content);
              modelMessages.push({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: (m as { toolCallId?: string }).toolCallId ?? "",
                    toolName,
                    output: {
                      type: "text",
                      value: textValue,
                    },
                  } as any,
                ],
              });
            }
          }

          // Build tools map for AI SDK
          const allTools: Record<string, any> = {};
          const toolList = this.config.tools || [];
          for (const t of toolList) {
            allTools[t.name] = (createAiTool as any)({
              description: t.description,
              parameters: t.parameters,
              execute: async (args: any) => {
                if (signal.aborted) throw new Error("Aborted");
                return t.execute(args);
              },
            });
          }

          // Stream with maxSteps
          const result = streamText({
            model,
            system,
            messages: modelMessages as any,
            tools: allTools,
            stopWhen: stepCountIs(this.config.maxSteps ?? 8),
            abortSignal: signal,
          });

          let currentMessageId = randomUUID();
          let messageStarted = false;
          let hasError = false;

          for await (const part of result.fullStream) {
            if (signal.aborted) break;

            if (part.type === "text-delta") {
              const text = (part as any).textDelta ?? (part as any).text ?? "";
              if (!text) continue;
              if (!messageStarted) {
                subscriber.next({
                  type: EventType.TEXT_MESSAGE_START,
                  messageId: currentMessageId,
                  role: "assistant",
                });
                messageStarted = true;
              }
              subscriber.next({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: currentMessageId,
                delta: text,
              });
            } else if (part.type === "tool-call") {
              if (messageStarted) {
                subscriber.next({
                  type: EventType.TEXT_MESSAGE_END,
                  messageId: currentMessageId,
                });
                messageStarted = false;
                currentMessageId = randomUUID();
              }
              const tc = part as any;
              const argsObj = tc.input ?? tc.args ?? {};
              const deltaStr = typeof argsObj === "string" ? argsObj : JSON.stringify(argsObj);
              subscriber.next({
                type: EventType.TOOL_CALL_START,
                toolCallId: tc.toolCallId,
                toolCallName: tc.toolName,
                parentMessageId: currentMessageId,
              });
              subscriber.next({
                type: EventType.TOOL_CALL_ARGS,
                toolCallId: tc.toolCallId,
                delta: deltaStr,
              });
              subscriber.next({
                type: EventType.TOOL_CALL_END,
                toolCallId: tc.toolCallId,
              });
            } else if (part.type === "tool-result") {
              const tr = part as any;
              const toolResult = "output" in tr ? tr.output : "result" in tr ? tr.result : null;
              let contentString = "";
              try {
                contentString =
                  typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult ?? "");
              } catch {
                contentString = String(toolResult);
              }
              subscriber.next({
                type: EventType.TOOL_CALL_RESULT,
                toolCallId: tr.toolCallId,
                messageId: randomUUID(),
                role: "tool",
                content: contentString,
              });
            } else if (part.type === "finish") {
              if (messageStarted) {
                subscriber.next({
                  type: EventType.TEXT_MESSAGE_END,
                  messageId: currentMessageId,
                });
                messageStarted = false;
              }
            } else if (part.type === "error") {
              hasError = true;
              const err = (part as any).error;
              subscriber.next({
                type: EventType.RUN_ERROR,
                message: err instanceof Error ? err.message : String(err),
              });
              subscriber.complete();
              return;
            }
          }

          if (messageStarted) {
            subscriber.next({
              type: EventType.TEXT_MESSAGE_END,
              messageId: currentMessageId,
            });
          }

          if (!hasError) {
            subscriber.next({
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            });
            subscriber.complete();
          }
        } catch (error) {
          if (!signal.aborted) {
            subscriber.next({
              type: EventType.RUN_ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            subscriber.complete();
          }
        }
      })();

      return () => {
        this.abortRun();
      };
    });
  }
}
