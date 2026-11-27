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
  const pendingChunks: string[] = [];
  let pendingCr = false;
  let reachedEof = false;

  const flushLine = (segment: string): ServerSentEvent | undefined => {
    const line = pendingChunks.length > 0 ? pendingChunks.join("") + segment : segment;
    if (pendingChunks.length > 0) {
      pendingChunks.length = 0;
    }
    return consumeLine(line, pending);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      let chunk = decoder.decode(value, { stream: !done });
      if (pendingCr && chunk.length > 0) {
        pendingCr = false;
        if (chunk.startsWith("\n")) {
          chunk = chunk.slice(1);
        }
      }

      let lineStart = 0;
      for (let i = 0; i < chunk.length; i += 1) {
        const ch = chunk[i];
        if (ch === "\n") {
          const event = flushLine(chunk.slice(lineStart, i));
          if (event) {
            yield event;
          }
          lineStart = i + 1;
        } else if (ch === "\r") {
          const event = flushLine(chunk.slice(lineStart, i));
          if (event) {
            yield event;
          }
          if (i + 1 < chunk.length) {
            if (chunk[i + 1] === "\n") {
              i += 1;
            }
          } else {
            pendingCr = true;
          }
          lineStart = i + 1;
        }
      }
      if (lineStart < chunk.length) {
        pendingChunks.push(chunk.slice(lineStart));
      }

      if (done) {
        reachedEof = true;
        break;
      }
    }

    if (pendingChunks.length > 0) {
      const event = flushLine("");
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
