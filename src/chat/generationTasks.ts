export interface GenerationTask {
  readonly conversationId: string;
  readonly controller: AbortController;
}

/** Owns request lifetimes, including preparation and final persistence. */
export class GenerationTasks {
  private readonly tasks = new Map<string, GenerationTask>();
  private readonly listeners = new Set<() => void>();
  private snapshot: ReadonlySet<string> = new Set();
  private accepting = true;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): ReadonlySet<string> => this.snapshot;
  has = (id: string): boolean => this.tasks.has(id);

  begin(conversationId: string): GenerationTask | undefined {
    if (!this.accepting || this.has(conversationId)) return;
    const task = { conversationId, controller: new AbortController() };
    this.tasks.set(conversationId, task);
    this.publish();
    return task;
  }

  finish(task: GenerationTask): void {
    if (this.tasks.get(task.conversationId) !== task) return;
    this.tasks.delete(task.conversationId);
    this.publish();
  }

  stop(id: string): void { this.tasks.get(id)?.controller.abort(); }
  activate(): void { this.accepting = true; }
  dispose(): void {
    this.accepting = false;
    for (const task of this.tasks.values()) task.controller.abort();
    // Keep ownership until each request has saved its terminal outcome.
  }

  private publish(): void {
    this.snapshot = new Set(this.tasks.keys());
    for (const listener of this.listeners) listener();
  }
}
