import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "developer";
  content?: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  [key: string]: unknown;
};

export type ToolMessage = {
  id: string;
  role: "tool";
  toolCallId: string;
  content: string;
  [key: string]: unknown;
};

export type ToolCall = {
  id: string;
  type?: string;
  function: {
    name: string;
    arguments: string;
  };
};

export type RenderToolProps<T = any> = {
  name?: string;
  args?: T;
  result?: unknown;
  status: "complete" | "inProgress" | "executing";
};

export type ToolDefinition = {
  name: string;
  description?: string;
  parameters?: any;
  render?: (props: RenderToolProps) => React.ReactNode;
};

import {
  AgentCoordinator,
  CopilotKitCore,
  type RunError,
  type Subscriber,
} from "./agent-coordinator";

export { AgentCoordinator, CopilotKitCore, type RunError, type Subscriber };

interface CopilotKitContextValue {
  runtimeUrl: string;
  headers?: Record<string, string>;
  coordinator: AgentCoordinator;
  renderTools: Map<string, ToolDefinition>;
  agentContexts: Array<{ description?: string; value: any }>;
  registerRenderTool: (tool: ToolDefinition) => void;
  registerAgentContext: (ctx: { description?: string; value: any }) => void;
}

const CopilotKitContext = createContext<CopilotKitContextValue | null>(null);

export function AgentProvider({
  runtimeUrl,
  headers,
  children,
}: {
  runtimeUrl: string;
  headers?: Record<string, string>;
  children: React.ReactNode;
}) {
  const coordinator = useMemo(() => new AgentCoordinator(), []);
  const [renderTools] = useState(() => new Map<string, ToolDefinition>());
  const [agentContexts] = useState<Array<{ description?: string; value: any }>>([]);

  const registerRenderTool = useCallback(
    (tool: ToolDefinition) => {
      renderTools.set(tool.name, tool);
    },
    [renderTools],
  );

  const registerAgentContext = useCallback(
    (ctx: { description?: string; value: any }) => {
      agentContexts.push(ctx);
    },
    [agentContexts],
  );

  const value = useMemo(
    () => ({
      runtimeUrl,
      headers,
      coordinator,
      renderTools,
      agentContexts,
      registerRenderTool,
      registerAgentContext,
    }),
    [
      runtimeUrl,
      headers,
      coordinator,
      renderTools,
      agentContexts,
      registerRenderTool,
      registerAgentContext,
    ],
  );

  return <CopilotKitContext.Provider value={value}>{children}</CopilotKitContext.Provider>;
}

export const CopilotKitProvider = AgentProvider;

export function useCopilotKit() {
  const context = useContext(CopilotKitContext);
  if (!context) {
    throw new Error("useCopilotKit must be used within a CopilotKitProvider");
  }
  return { copilotkit: context.coordinator };
}

export function useAgent({
  agentId,
  runtimeAgentId = "default",
  threadId,
}: {
  agentId: string;
  runtimeAgentId?: string;
  threadId?: string;
}) {
  const context = useContext(CopilotKitContext);
  if (!context) {
    throw new Error("useAgent must be used within a CopilotKitProvider");
  }

  const { runtimeUrl, headers, coordinator } = context;

  const agent = useMemo(() => {
    let existing = coordinator.getAgent(agentId) as HttpAgent | undefined;
    if (!existing) {
      const url = `${runtimeUrl}/agents/${runtimeAgentId}`;
      existing = new HttpAgent({
        agentId,
        url,
        threadId,
        headers: headers ?? {},
      });
      coordinator.registerAgent(agentId, existing);
    } else {
      if (threadId && existing.threadId !== threadId) {
        existing.threadId = threadId;
      }
    }
    return existing;
  }, [agentId, runtimeAgentId, threadId, runtimeUrl, headers, coordinator]);

  return { agent, isReady: true };
}

export function useAgentContext(ctx: { description?: string; value: any }) {
  const context = useContext(CopilotKitContext);
  useEffect(() => {
    if (context) {
      context.registerAgentContext(ctx);
    }
  }, [context, ctx]);
}

export function useRenderTool(tool: ToolDefinition) {
  const context = useContext(CopilotKitContext);
  useEffect(() => {
    if (context) {
      context.registerRenderTool(tool);
    }
  }, [context, tool]);
}

export function useRenderToolCall() {
  const context = useContext(CopilotKitContext);

  return useCallback(
    ({ toolCall, toolMessage }: { toolCall: any; toolMessage?: any }) => {
      if (!context) return null;
      const name = toolCall?.function?.name ?? toolCall?.name;
      if (!name) return null;
      const tool = context.renderTools.get(name);
      if (!tool || !tool.render) return null;

      let args = toolCall?.function?.arguments ?? toolCall?.args;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {}
      }

      let result: any = toolMessage?.content;
      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch {}
      }

      const status = toolMessage ? "complete" : "inProgress";
      return tool.render({ name, args, result, status });
    },
    [context],
  );
}

export interface ThreadItem {
  id: string;
  name?: string;
  archived?: boolean;
  createdAt?: string;
}

export function useThreads({
  agentId = "default",
  enabled = true,
  includeArchived = true,
  limit = 20,
}: {
  agentId?: string;
  enabled?: boolean;
  includeArchived?: boolean;
  limit?: number;
} = {}) {
  const context = useContext(CopilotKitContext);
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [isFetchingMoreThreads, setIsFetchingMoreThreads] = useState(false);
  const [fetchMoreError, setFetchMoreError] = useState<Error | undefined>();

  const runtimeUrl = context?.runtimeUrl ?? "";
  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(context?.headers ?? {}),
    }),
    [context?.headers],
  );

  const fetchThreads = useCallback(async () => {
    if (!enabled || !runtimeUrl) return;
    setIsLoading(true);
    setError(undefined);
    try {
      const res = await fetch(
        `${runtimeUrl}/threads?agentId=${agentId}&includeArchived=${includeArchived}&limit=${limit}`,
        { headers },
      );
      if (!res.ok) {
        throw new Error(`Failed to list threads: ${res.statusText}`);
      }
      const data = await res.json();
      setThreads(data.threads ?? []);
      setNextCursor(data.nextCursor);
      setHasMoreThreads(!!data.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [enabled, runtimeUrl, agentId, includeArchived, limit, headers]);

  const fetchMoreThreads = useCallback(async () => {
    if (!nextCursor || isFetchingMoreThreads || !runtimeUrl) return;
    setIsFetchingMoreThreads(true);
    setFetchMoreError(undefined);
    try {
      const res = await fetch(
        `${runtimeUrl}/threads?agentId=${agentId}&includeArchived=${includeArchived}&limit=${limit}&cursor=${nextCursor}`,
        { headers },
      );
      if (!res.ok) throw new Error(`Failed to load more threads: ${res.statusText}`);
      const data = await res.json();
      setThreads((prev) => [...prev, ...(data.threads ?? [])]);
      setNextCursor(data.nextCursor);
      setHasMoreThreads(!!data.nextCursor);
    } catch (err) {
      setFetchMoreError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsFetchingMoreThreads(false);
    }
  }, [nextCursor, isFetchingMoreThreads, runtimeUrl, agentId, includeArchived, limit, headers]);

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

  const renameThread = useCallback(
    async (threadId: string, name: string) => {
      setIsMutating(true);
      try {
        const res = await fetch(`${runtimeUrl}/threads/${threadId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ agentId, name }),
        });
        if (!res.ok) throw new Error(`Failed to rename thread: ${res.statusText}`);
        setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, name } : t)));
      } finally {
        setIsMutating(false);
      }
    },
    [runtimeUrl, headers, agentId],
  );

  const archiveThread = useCallback(
    async (threadId: string) => {
      setIsMutating(true);
      try {
        const res = await fetch(`${runtimeUrl}/threads/${threadId}/archive`, {
          method: "POST",
          headers,
          body: JSON.stringify({ agentId }),
        });
        if (!res.ok) throw new Error(`Failed to archive thread: ${res.statusText}`);
        setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, archived: true } : t)));
      } finally {
        setIsMutating(false);
      }
    },
    [runtimeUrl, headers, agentId],
  );

  const unarchiveThread = useCallback(
    async (threadId: string) => {
      setIsMutating(true);
      try {
        const res = await fetch(`${runtimeUrl}/threads/${threadId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ agentId, archived: false }),
        });
        if (!res.ok) throw new Error(`Failed to unarchive thread: ${res.statusText}`);
        setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, archived: false } : t)));
      } finally {
        setIsMutating(false);
      }
    },
    [runtimeUrl, headers, agentId],
  );

  return {
    threads,
    isLoading,
    isMutating,
    error,
    refetchThreads: fetchThreads,
    renameThread,
    archiveThread,
    unarchiveThread,
    hasMoreThreads,
    isFetchingMoreThreads,
    fetchMoreError,
    fetchMoreThreads,
  };
}
