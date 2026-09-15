import type { ChatRepository, StoredChatMessage } from "./repository";

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
    const recovered = snapshot.messages.map((message) =>
      message.status === "streaming" ? { ...message, status: "aborted" as const } : message,
    );
    this.state = {
      messages: recovered,
    };
    if (recovered.some((message, index) => message !== snapshot.messages[index])) {
      await this.enqueueSave();
    }
    return this.state;
  }

  get current(): SessionState { return this.state; }

  updateMessages(messages: StoredChatMessage[]): Promise<void> {
    this.state = { ...this.state, messages };
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
