import type { ResponseOutputItem, ResponseStreamEvent } from "openai/resources/responses/responses";
import type { ChatEvent } from "./types";

// Adapter-local reconciliation: deltas and several final snapshots describe the same parts.
// Read only explicit text fields. Summary and content indexes are separate namespaces.
// encrypted_content remains opaque and is never displayed or replayed.
export class ResponseThinking {
  private parts = new Map<string, { text: string; done: boolean }>();
  private sequences = new Set<number>();
  private lastPart: string | undefined;
  constructor(private readonly enabled: boolean) {}

  private *append(key: string, text: string, final: boolean): Iterable<ChatEvent> {
    if (!this.enabled) return;
    if (typeof text !== "string") throw new SyntaxError("Responses reasoning summary text is malformed");
    const previous = this.parts.get(key) ?? { text: "", done: false };
    if (previous.done) return;
    if (final && !text.startsWith(previous.text)) {
      throw new SyntaxError("Responses reasoning summary final text disagrees with its deltas");
    }
    const addition = final ? text.slice(previous.text.length) : text;
    this.parts.set(key, { text: final ? text : previous.text + text, done: final });
    if (addition) {
      yield { type: "thinking-delta", text: (this.lastPart !== undefined && this.lastPart !== key ? "\n\n" : "") + addition };
      this.lastPart = key;
    }
  }

  *output(items: ResponseOutputItem[] | undefined): Iterable<ChatEvent> {
    if (!this.enabled) return;
    for (const item of items ?? []) {
      if (item.type !== "reasoning") continue;
      const parts = [
        ...(item.summary ?? []).flatMap((part, index) => part.type === "summary_text" ? [{ key: `${item.id}:summary:${index}`, text: part.text }] : []),
        ...(item.content ?? []).flatMap((part, index) => part.type === "reasoning_text" ? [{ key: `${item.id}:content:${index}`, text: part.text }] : []),
      ];
      // Finish the current streamed part before adding a previously unseen summary/content.
      // Otherwise a final snapshot could insert a summary into the middle of reasoning text.
      const priority = (key: string) => key === this.lastPart ? -1 : this.parts.has(key) ? 0 : 1;
      parts.sort((a, b) => priority(a.key) - priority(b.key));
      for (const part of parts) yield* this.append(part.key, part.text, true);
    }
  }

  *event(event: ResponseStreamEvent): Iterable<ChatEvent> {
    if (!this.enabled) return;
    // Repeated delivery is identified by provider sequence numbers, not text equality:
    // two legitimate identical delta strings must both survive.
    if (typeof event.sequence_number === "number") {
      if (this.sequences.has(event.sequence_number)) return;
      this.sequences.add(event.sequence_number);
    }
    if (event.type === "response.reasoning_summary_text.delta") {
      yield* this.append(`${event.item_id}:summary:${event.summary_index}`, event.delta, false);
    } else if (event.type === "response.reasoning_summary_text.done") {
      yield* this.append(`${event.item_id}:summary:${event.summary_index}`, event.text, true);
    } else if (event.type === "response.reasoning_summary_part.done") {
      if (event.part.type === "summary_text") yield* this.append(`${event.item_id}:summary:${event.summary_index}`, event.part.text, true);
    } else if (event.type === "response.reasoning_text.delta") {
      yield* this.append(`${event.item_id}:content:${event.content_index}`, event.delta, false);
    } else if (event.type === "response.reasoning_text.done") {
      yield* this.append(`${event.item_id}:content:${event.content_index}`, event.text, true);
    } else if (event.type === "response.output_item.done") {
      yield* this.output([event.item]);
    } else if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
      yield* this.output(event.response.output);
    }
  }
}
