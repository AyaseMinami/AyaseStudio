import { describe, expect, it, vi } from "vitest";
import { parseServerSentEvents } from "./sse";

describe("parseServerSentEvents", () => {
  it("preserves a multibyte character split across byte chunks", async () => {
    const bytes = new TextEncoder().encode('data: {"text":"你好"}\n\n');
    const splitAt = bytes.indexOf(0xe5) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseServerSentEvents(body)) {
      events.push(event);
    }

    expect(events).toEqual([{ data: '{"text":"你好"}' }]);
  });

  it("cancels the source when the consumer stops before EOF", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      },
      cancel,
    });

    for await (const event of parseServerSentEvents(body)) {
      expect(event.data).toBe("first");
      break;
    }

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("handles standalone CR, CRLF, LF and cross-chunk CR+LF line endings per WHATWG SSE", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "event: delta\rdata: one\r\r",
      "data: two\r",
      "\n\r\n",
      "data: three\r",
      "data: four\r",
      "\r",
      "data: five\n\n",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    const events = [];
    for await (const event of parseServerSentEvents(body)) {
      events.push(event);
    }
    expect(events).toEqual([
      { event: "delta", data: "one" },
      { data: "two" },
      { data: "three\nfour" },
      { data: "five" },
    ]);
  });
});
