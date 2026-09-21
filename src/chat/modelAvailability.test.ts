import { afterEach, describe, expect, it, vi } from "vitest";

import { testModelAvailability } from "./modelAvailability";
import type { ChatTransport } from "./types";

describe("model availability test", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports first response and total latency through ChatTransport", async () => {
    const transport: ChatTransport = {
      async *stream(request) {
        expect(request).toMatchObject({
          baseUrl: "https://relay.example.com/v1",
          apiKey: "synthetic-key",
          model: "test-model",
          maxOutputTokens: 8,
          messages: [{ role: "user", content: "Reply with OK." }],
        });
        yield { type: "text-delta", text: "OK" };
        yield { type: "completed" };
      },
    };
    const times = [1_000, 1_120, 1_260];

    await expect(
      testModelAvailability(
        transport,
        {
          baseUrl: "https://relay.example.com/v1",
          apiKey: "synthetic-key",
          model: "test-model",
        },
        { now: () => times.shift() ?? 1_260 },
      ),
    ).resolves.toEqual({
      status: "success",
      firstResponseMs: 120,
      totalMs: 260,
    });
  });

  it("returns normalized transport failures", async () => {
    const transport: ChatTransport = {
      async *stream() {
        yield {
          type: "failed",
          error: {
            kind: "rate-limit",
            message: "Too many requests for key",
            status: 429,
            retryable: true,
          },
        };
      },
    };

    const result = await testModelAvailability(
      transport,
      { baseUrl: "https://relay.example.com/v1", apiKey: "key", model: "m" },
      { now: () => 1_000 },
    );

    expect(result).toEqual({
      status: "failed",
      totalMs: 0,
      error: {
        kind: "rate-limit",
        message: "Too many requests for [已隐藏凭据]",
        status: 429,
        retryable: true,
      },
    });
  });

  it("distinguishes user cancellation from timeout", async () => {
    vi.useFakeTimers();
    const transport: ChatTransport = {
      async *stream(request) {
        await new Promise<void>((resolve) => {
          request.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        yield { type: "aborted" };
      },
    };

    const controller = new AbortController();
    const cancelled = testModelAvailability(
      transport,
      { baseUrl: "https://relay.example.com/v1", apiKey: "key", model: "m" },
      { signal: controller.signal, now: () => 1_000 },
    );
    controller.abort();
    await expect(cancelled).resolves.toEqual({
      status: "cancelled",
      totalMs: 0,
    });

    const timedOut = testModelAvailability(
      transport,
      { baseUrl: "https://relay.example.com/v1", apiKey: "key", model: "m" },
      { timeoutMs: 5_000, now: () => 2_000 },
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(timedOut).resolves.toEqual({
      status: "timeout",
      totalMs: 0,
    });
  });

  it("keeps user cancellation authoritative when a transport stops late", async () => {
    vi.useFakeTimers();
    const transport: ChatTransport = {
      async *stream() {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        yield { type: "completed" };
      },
    };
    const controller = new AbortController();
    const result = testModelAvailability(
      transport,
      { baseUrl: "https://relay.example.com/v1", apiKey: "key", model: "m" },
      { signal: controller.signal, timeoutMs: 5_000, now: () => 1_000 },
    );

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    await expect(result).resolves.toEqual({
      status: "cancelled",
      totalMs: 0,
    });
  });

  it("returns at the timeout deadline even if the transport ignores abort", async () => {
    vi.useFakeTimers();
    const transport: ChatTransport = {
      async *stream() {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        yield { type: "completed" };
      },
    };
    const result = testModelAvailability(
      transport,
      { baseUrl: "https://relay.example.com/v1", apiKey: "key", model: "m" },
      { timeoutMs: 5_000, now: () => 1_000 },
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toEqual({ status: "timeout", totalMs: 0 });
  });
});
