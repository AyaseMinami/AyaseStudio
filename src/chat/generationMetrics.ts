import type { ChatEvent, ChatProtocol, TokenUsage } from "./types";
import type { StoredMessageStatus } from "./repository";
import { mergeTokenUsage } from "./usage";

/** One API invocation. A continued reply retains each invocation separately. */
export interface GenerationMetrics {
  version: 1;
  protocol: ChatProtocol;
  streaming: boolean;
  status: StoredMessageStatus;
  elapsedMs: number;
  firstTextMs?: number;
  firstThinkingMs?: number;
  usage?: TokenUsage;
  /** True only after a provider completion confirming the final output count. */
  usageComplete: boolean;
}

/** Uses a monotonic, injectable clock; excludes local preparation and Exa fetches. */
export class GenerationMeasurement {
  private firstTextMs?: number;
  private firstThinkingMs?: number;
  private usage?: TokenUsage;
  private usageComplete = false;
  private finishedAt?: number;
  private readonly startedAt: number;

  constructor(private readonly protocol: ChatProtocol, private readonly streaming: boolean,
    private readonly now: () => number = () => performance.now()) {
    this.startedAt = now();
  }

  observe(event: ChatEvent): void {
    const elapsed = this.elapsed();
    if (this.streaming && event.type === "text-delta" && event.text.trim()) this.firstTextMs ??= elapsed;
    if (this.streaming && event.type === "thinking-delta" && event.text.trim()) this.firstThinkingMs ??= elapsed;
    if (event.type === "usage-update" || event.type === "completed") {
      if (event.usage) this.usage = mergeTokenUsage(this.usage, event.usage);
      if (event.type === "completed") this.usageComplete = mergeTokenUsage(undefined, event.usage)?.outputTokens !== undefined;
    }
    if (["completed", "failed", "aborted"].includes(event.type)) this.finishedAt ??= this.now();
  }

  private elapsed(): number { return Math.max(0, (this.finishedAt ?? this.now()) - this.startedAt); }

  snapshot(status: StoredMessageStatus): GenerationMetrics {
    if (status !== "streaming") this.finishedAt ??= this.now();
    return { version: 1, protocol: this.protocol, streaming: this.streaming, status,
      elapsedMs: this.elapsed(), usageComplete: this.usageComplete,
      ...(this.firstTextMs !== undefined ? { firstTextMs: this.firstTextMs } : {}),
      ...(this.firstThinkingMs !== undefined ? { firstThinkingMs: this.firstThinkingMs } : {}),
      ...(this.usage ? { usage: { ...this.usage } } : {}) };
  }
}
