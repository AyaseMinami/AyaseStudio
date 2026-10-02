import type { ChatRepository, StoredChatMessage } from "./repository";
import { withReplyLinks } from "./messageOperations";
import { finishSearch } from "./nativeSearch";
import { readMessagesGenerationMetrics } from "./generationMetricsData";

export interface SessionState {
  messages: StoredChatMessage[];
}

export class SessionStore {
  private state: SessionState = { messages: [] };
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly repository: ChatRepository, readonly id: string) {}

  async hydrate(): Promise<SessionState> {
    const snapshot = await this.repository.load(this.id);
    if (!snapshot) return this.state;
    let changed = false;
    function recover(message: StoredChatMessage): StoredChatMessage {
      if (message.status === "streaming") {
        changed = true;
        message = { ...message, status: "aborted", search: finishSearch(message.search, "aborted"), continuation: undefined };
      }
      if (message.generationMetrics) message.generationMetrics = message.generationMetrics.map(metric => {
        if (metric.status !== "streaming") return metric;
        changed = true;
        return { ...metric, status: "aborted", usageComplete: false };
      });
      if (message.roundVersions) message.roundVersions = { ...message.roundVersions,
        pairs: message.roundVersions.pairs.map(pair => pair.map(recover) as typeof pair) };
      return message;
    }
    const recovered = readMessagesGenerationMetrics(snapshot.messages).map(recover);
    this.state = {
      messages: withReplyLinks(recovered),
    };
    if (changed) {
      await this.enqueueSave();
    }
    return this.state;
  }

  get current(): SessionState { return this.state; }

  async updateMessages(messages: StoredChatMessage[]): Promise<void> {
    this.state = { ...this.state, messages: readMessagesGenerationMetrics(messages) };
    return this.enqueueSave();
  }

  clearMessages(): Promise<void> {
    return this.updateMessages([]);
  }

  async flush(): Promise<void> {
    try { await this.writes; }
    catch { await this.enqueueSave(); }
  }

  private enqueueSave(): Promise<void> {
    const state = this.state;
    const next = this.writes.catch(() => undefined).then(() => this.repository.save({
      id: this.id,
      updatedAt: Date.now(),
      messages: state.messages,
    }));
    this.writes = next;
    return next;
  }
}
