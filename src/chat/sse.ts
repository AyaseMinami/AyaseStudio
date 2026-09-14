export interface ServerSentEvent {
  event?: string;
  data: string;
}

interface PendingEvent {
  event?: string;
  data: string[];
}

function consumeLine(
  rawLine: string,
  pending: PendingEvent,
): ServerSentEvent | undefined {
  const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

  if (line === "") {
    if (pending.data.length === 0) {
      pending.event = undefined;
      return undefined;
    }

    const parsed = {
      ...(pending.event ? { event: pending.event } : {}),
      data: pending.data.join("\n"),
    };
    pending.event = undefined;
    pending.data = [];
    return parsed;
  }

  if (line.startsWith(":")) {
    return undefined;
  }

  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? "" : line.slice(colon + 1);
  if (value.startsWith(" ")) {
    value = value.slice(1);
  }

  if (field === "event") {
    pending.event = value;
  } else if (field === "data") {
    pending.data.push(value);
  }

  return undefined;
}

export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<ServerSentEvent> {
  if (!body) {
    throw new Error("Streaming response has no body");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const pending: PendingEvent = { data: [] };
  let buffer = "";
  let reachedEof = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = consumeLine(line, pending);
        if (event) {
          yield event;
        }
      }

      if (done) {
        reachedEof = true;
        break;
      }
    }

    if (buffer !== "") {
      const event = consumeLine(buffer, pending);
      if (event) {
        yield event;
      }
    }
    const finalEvent = consumeLine("", pending);
    if (finalEvent) {
      yield finalEvent;
    }
  } finally {
    if (!reachedEof) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the original stream result/error if transport cleanup fails.
      }
    }
    reader.releaseLock();
  }
}
