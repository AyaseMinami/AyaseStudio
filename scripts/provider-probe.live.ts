import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createChatTransport } from "../src/chat/transport";
import type {
  ChatEvent,
  ChatProtocol,
  ChatRequest,
  FetchLike,
} from "../src/chat/types";

function loadProbeEnvironment(): Record<string, string> {
  const source = readFileSync(resolve(".env.probe.local"), "utf8");
  const values: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

const environment = loadProbeEnvironment();
const sharedApiKey = environment.AYASE_RELAY_API_KEY;

interface ProbeProfile {
  protocol: ChatProtocol;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const profiles: ProbeProfile[] = [
  {
    protocol: "openai-chat",
    label: "OpenAI Chat",
    baseUrl: environment.AYASE_OPENAI_CHAT_BASE_URL,
    apiKey: environment.AYASE_OPENAI_CHAT_API_KEY || sharedApiKey,
    model: environment.AYASE_OPENAI_CHAT_MODEL,
  },
  {
    protocol: "openai-responses",
    label: "OpenAI Responses",
    baseUrl: environment.AYASE_OPENAI_RESPONSES_BASE_URL,
    apiKey: environment.AYASE_OPENAI_RESPONSES_API_KEY || sharedApiKey,
    model: environment.AYASE_OPENAI_RESPONSES_MODEL,
  },
  {
    protocol: "gemini-native",
    label: "Gemini Native",
    baseUrl: environment.AYASE_GEMINI_BASE_URL,
    apiKey: environment.AYASE_GEMINI_API_KEY || sharedApiKey,
    model: environment.AYASE_GEMINI_MODEL,
  },
  {
    protocol: "anthropic-native",
    label: "Anthropic Native",
    baseUrl: environment.AYASE_ANTHROPIC_BASE_URL,
    apiKey: environment.AYASE_ANTHROPIC_API_KEY || sharedApiKey,
    model: environment.AYASE_ANTHROPIC_MODEL,
  },
];

function validateProfile(profile: ProbeProfile): void {
  for (const [name, value] of Object.entries({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
  })) {
    if (!value) throw new Error(`${profile.label} ${name} is not configured`);
  }
}

function redact(message: string, profile: ProbeProfile): string {
  const redacted = profile.apiKey
    ? message.split(profile.apiKey).join("[redacted]")
    : message;
  return redacted.replace(/\s+/g, " ").slice(0, 400);
}

async function runProbe(profile: ProbeProfile): Promise<{
  text: string;
  events: ChatEvent[];
  elapsedMs: number;
  firstDeltaMs?: number;
}> {
  validateProfile(profile);
  const transport = createChatTransport(profile.protocol, {
    fetch: globalThis.fetch as FetchLike,
  });
  const startedAt = performance.now();
  let firstDeltaMs: number | undefined;
  let text = "";
  const events: ChatEvent[] = [];
  const request: ChatRequest = {
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    maxOutputTokens: 48,
    messages: [
      {
        role: "user",
        content: "Reply with exactly AYASE_LIVE_OK and nothing else.",
      },
    ],
  };

  for await (const event of transport.stream(request)) {
    events.push(event);
    if (event.type === "text-delta") {
      firstDeltaMs ??= performance.now() - startedAt;
      text += event.text;
    }
  }

  return {
    text,
    events,
    elapsedMs: performance.now() - startedAt,
    firstDeltaMs,
  };
}

async function runAbortProbe(profile: ProbeProfile): Promise<ChatEvent[]> {
  validateProfile(profile);
  const controller = new AbortController();
  const transport = createChatTransport(profile.protocol, {
    fetch: globalThis.fetch as FetchLike,
  });
  const events: ChatEvent[] = [];

  for await (const event of transport.stream({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    maxOutputTokens: 256,
    signal: controller.signal,
    messages: [
      {
        role: "user",
        content:
          "Write a long numbered list with at least 100 short items. Start immediately.",
      },
    ],
  })) {
    events.push(event);
    if (event.type === "text-delta") controller.abort();
  }

  return events;
}

describe("live provider compatibility", () => {
  for (const profile of profiles) {
    it(`${profile.label} returns a complete streamed response`, async () => {
      const result = await runProbe(profile);
      const failed = result.events.find((event) => event.type === "failed");
      if (failed?.type === "failed") {
        throw new Error(
          redact(
            `${profile.label}: ${failed.error.kind} ${failed.error.status ?? ""} ${failed.error.message}`,
            profile,
          ),
        );
      }

      expect(result.events.filter((event) => event.type === "completed")).toHaveLength(1);
      expect(result.events.filter((event) => event.type === "aborted")).toHaveLength(0);
      expect(result.firstDeltaMs).toBeTypeOf("number");
      expect(result.text.trim().length).toBeGreaterThan(0);

      console.info(
        JSON.stringify({
          protocol: profile.protocol,
          host: new URL(profile.baseUrl).host,
          model: profile.model,
          text: result.text.trim().slice(0, 80),
          firstDeltaMs: Math.round(result.firstDeltaMs ?? 0),
          elapsedMs: Math.round(result.elapsedMs),
        }),
      );
    });
  }

  for (const protocol of ["openai-responses", "gemini-native"] as const) {
    const profile = profiles.find((candidate) => candidate.protocol === protocol)!;
    it(`${profile.label} aborts after its first text delta`, async () => {
      const events = await runAbortProbe(profile);
      const failed = events.find((event) => event.type === "failed");
      if (failed?.type === "failed") {
        throw new Error(
          redact(
            `${profile.label}: ${failed.error.kind} ${failed.error.status ?? ""} ${failed.error.message}`,
            profile,
          ),
        );
      }

      expect(events.some((event) => event.type === "text-delta")).toBe(true);
      expect(events.filter((event) => event.type === "aborted")).toHaveLength(1);
      expect(events.filter((event) => event.type === "completed")).toHaveLength(0);
    });
  }
});
