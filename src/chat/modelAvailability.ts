import type { ChatFailure, ChatRequest, ChatTransport } from "./types";
import { redactCredential } from "./redaction";

export type ModelAvailabilityResult =
  | { status: "success"; firstResponseMs: number; totalMs: number }
  | { status: "failed"; totalMs: number; error: ChatFailure }
  | { status: "cancelled"; totalMs: number }
  | { status: "timeout"; totalMs: number };

export interface ModelAvailabilityOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
}

type ModelAvailabilityRequest = Pick<
  ChatRequest,
  "baseUrl" | "apiKey" | "model"
>;

const probeMessage = "Reply with OK.";
const defaultTimeoutMs = 20_000;

export async function testModelAvailability(
  transport: ChatTransport,
  request: ModelAvailabilityRequest,
  options: ModelAvailabilityOptions = {},
): Promise<ModelAvailabilityResult> {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = options.signal?.aborted ?? false;
  let firstResponseAt: number | undefined;
  let resolveInterruption: (() => void) | undefined;
  const interruption = new Promise<void>((resolve) => {
    resolveInterruption = resolve;
  });

  const handleExternalAbort = () => {
    cancelled = true;
    controller.abort();
    resolveInterruption?.();
  };
  options.signal?.addEventListener("abort", handleExternalAbort, { once: true });
  if (cancelled) {
    controller.abort();
    resolveInterruption?.();
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    resolveInterruption?.();
  }, options.timeoutMs ?? defaultTimeoutMs);

  const totalMs = () => Math.max(0, Math.round(now() - startedAt));
  const interruptionResult = (): ModelAvailabilityResult => ({
    status: cancelled ? "cancelled" : "timeout",
    totalMs: totalMs(),
  });
  const iterator = transport.stream({
    ...request,
    messages: [{ role: "user", content: probeMessage }],
    maxOutputTokens: 8,
    signal: controller.signal,
  })[Symbol.asyncIterator]();

  function stopIterator(): void {
    const closing = iterator.return?.();
    void closing?.catch(() => undefined);
  }

  try {
    while (true) {
      const nextEvent = iterator.next().then(
        (step) => ({ type: "event" as const, step }),
        (error: unknown) => ({ type: "error" as const, error }),
      );
      const outcome = await Promise.race([
        nextEvent,
        interruption.then(() => ({ type: "interrupted" as const })),
      ]);
      if (
        outcome.type === "interrupted" ||
        cancelled ||
        timedOut ||
        controller.signal.aborted
      ) {
        stopIterator();
        return interruptionResult();
      }
      if (outcome.type === "error") throw outcome.error;
      if (outcome.step.done) break;
      const event = outcome.step.value;
      if (
        firstResponseAt === undefined &&
        (event.type === "text-delta" || event.type === "completed")
      ) {
        firstResponseAt = now();
      }
      if (event.type === "completed") {
        stopIterator();
        return {
          status: "success",
          firstResponseMs: Math.max(
            0,
            Math.round((firstResponseAt ?? startedAt) - startedAt),
          ),
          totalMs: totalMs(),
        };
      }
      if (event.type === "failed") {
        stopIterator();
        return {
          status: "failed",
          totalMs: totalMs(),
          error: {
            ...event.error,
            message: redactCredential(event.error.message, request.apiKey),
          },
        };
      }
      if (event.type === "aborted") {
        stopIterator();
        return interruptionResult();
      }
    }
    if (timedOut || cancelled || controller.signal.aborted) {
      return interruptionResult();
    }
    return {
      status: "failed",
      totalMs: totalMs(),
      error: {
        kind: "protocol",
        message: "模型测试在没有终态的情况下结束。",
        retryable: false,
      },
    };
  } catch (error) {
    if (timedOut || cancelled || controller.signal.aborted) {
      return interruptionResult();
    }
    return {
      status: "failed",
      totalMs: totalMs(),
      error: {
        kind: "network",
        message: redactCredential(
          error instanceof Error ? error.message : "模型测试请求失败。",
          request.apiKey,
        ),
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", handleExternalAbort);
  }
}
