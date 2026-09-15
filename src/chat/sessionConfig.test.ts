import { describe, expect, it } from "vitest";
import { changeNumericSetting, defaultSessionConfig, restoreSessionConfig, validateSessionConfig } from "./sessionConfig";

describe("SessionConfig", () => {
  it("upgrades a legacy missing config without changing the old messages", () => {
    expect(restoreSessionConfig(undefined)).toEqual(defaultSessionConfig());
  });

  it("keeps invalid saved values visible and blocks sending", () => {
    const saved = {
      ...defaultSessionConfig(),
      temperature: { mode: "custom" as const, value: "oops" },
      customJson: { ...defaultSessionConfig().customJson, "openai-chat": "[]" },
    };
    const restored = restoreSessionConfig(saved);
    expect(restored.temperature).toEqual(saved.temperature);
    expect(validateSessionConfig(restored, "openai-chat")).toMatchObject({
      temperature: expect.any(String), customJson: expect.any(String),
    });
  });

  it("requires an explicit fresh confirmation after either sampling field changes", () => {
    const both = {
      ...defaultSessionConfig(),
      temperature: { mode: "custom" as const, value: "0.5" },
      topP: { mode: "custom" as const, value: "0.9" },
      dualSamplingConfirmed: true,
    };
    expect(validateSessionConfig(both, "gemini-native").dualSampling).toBeUndefined();
    expect(changeNumericSetting(both, "temperature", { mode: "custom", value: "0.6" }).dualSamplingConfirmed).toBe(false);
  });

  it("marks structurally corrupt stored records without silently accepting them", () => {
    const restored = restoreSessionConfig({ version: 1, stream: true });
    expect(validateSessionConfig(restored, "openai-chat").stored).toBeTruthy();
  });
});
