import type { ChatProtocol } from "./types";

export interface ProviderProfile {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type ProviderProfiles = Record<ChatProtocol, ProviderProfile>;

const STORAGE_KEY = "ayase-studio.provider-profiles.v1";

export const emptyProviderProfiles: ProviderProfiles = {
  "openai-chat": { baseUrl: "", apiKey: "", model: "" },
  "openai-responses": { baseUrl: "", apiKey: "", model: "" },
  "gemini-native": { baseUrl: "", apiKey: "", model: "" },
  "anthropic-native": { baseUrl: "", apiKey: "", model: "" },
};

function isProfile(value: unknown): value is ProviderProfile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const profile = value as Partial<ProviderProfile>;
  return (
    typeof profile.baseUrl === "string" &&
    typeof profile.apiKey === "string" &&
    typeof profile.model === "string"
  );
}

export function loadProviderProfiles(): ProviderProfiles {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<Record<ChatProtocol, unknown>>
      | null;
    if (!stored) {
      return emptyProviderProfiles;
    }

    return Object.fromEntries(
      Object.entries(emptyProviderProfiles).map(([protocol, fallback]) => {
        const candidate = stored[protocol as ChatProtocol];
        return [protocol, isProfile(candidate) ? candidate : fallback];
      }),
    ) as ProviderProfiles;
  } catch {
    return emptyProviderProfiles;
  }
}

export function saveProviderProfiles(profiles: ProviderProfiles): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}
