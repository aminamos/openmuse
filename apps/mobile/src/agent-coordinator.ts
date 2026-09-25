export type RunError = { error: unknown; context?: { agentId?: string } };
export type Subscriber = {
  onError?: (event: RunError) => void;
  onEvent?: (event: any) => void;
};

export class AgentCoordinator {
  private agents: Map<string, any> = new Map();
  private subscribers: Set<Subscriber> = new Set();
  private agentSubscriptions: Map<any, { unsubscribe: () => void }> = new Map();

  constructor(options?: { agents__unsafe_dev_only?: Record<string, any> }) {
    if (options?.agents__unsafe_dev_only) {
      for (const [id, agent] of Object.entries(options.agents__unsafe_dev_only)) {
        this.registerAgent(id, agent);
      }
    }
  }

  getAgent(id: string): any | undefined {
    return this.agents.get(id);
  }

  registerAgent(id: string, agent: any) {
    this.agents.set(id, agent);
    if (!this.agentSubscriptions.has(agent)) {
      if (typeof agent.subscribe === "function") {
        const sub = agent.subscribe({
          onRunFailed: ({ error }: any) => {
            this.emitError(error, agent.agentId);
          },
        });
        this.agentSubscriptions.set(agent, sub);
      }
    }
  }

  subscribe(sub: Subscriber) {
    this.subscribers.add(sub);
    return {
      unsubscribe: () => {
        this.subscribers.delete(sub);
      },
    };
  }

  emitError(error: unknown, agentId?: string) {
    for (const sub of this.subscribers) {
      sub.onError?.({ error, context: { agentId } });
    }
  }

  async runAgent({ agent }: { agent: any }): Promise<any> {
    this.registerAgent(agent.agentId ?? "default", agent);
    try {
      return await agent.runAgent();
    } catch (err) {
      this.emitError(err, agent.agentId);
    }
  }

  async connectAgent({ agent }: { agent: any }): Promise<any> {
    this.registerAgent(agent.agentId ?? "default", agent);
    try {
      if (typeof agent.connectAgent === "function") {
        return await agent.connectAgent();
      }
      if (typeof agent.connect === "function") {
        return await agent.connect();
      }
    } catch (err) {
      this.emitError(err, agent.agentId);
      throw err;
    }
  }

  async stopAgent({ agent }: { agent: any }): Promise<any> {
    if (typeof agent.abortRun === "function") {
      agent.abortRun();
    }
  }
}
