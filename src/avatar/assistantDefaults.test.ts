// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { isAssistantDefaultAvatar, readAssistantDefaultAvatar, writeAssistantDefaultAvatar } from "./assistantDefaults";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it("validates and restores only supported built-in defaults", () => {
  expect(readAssistantDefaultAvatar()).toBe("system");
  expect(isAssistantDefaultAvatar("green")).toBe(true);
  expect(isAssistantDefaultAvatar("https://remote/avatar.png")).toBe(false);
  writeAssistantDefaultAvatar("violet");
  expect(readAssistantDefaultAvatar()).toBe("violet");
  writeAssistantDefaultAvatar("invalid");
  expect(readAssistantDefaultAvatar()).toBe("violet");
  localStorage.setItem("ayase-studio.assistant-default-avatar", "invalid");
  expect(readAssistantDefaultAvatar()).toBe("system");
});

it("reads safely but exposes write failures to the settings caller", () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("storage"); });
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(readAssistantDefaultAvatar()).toBe("system");
  expect(() => writeAssistantDefaultAvatar("blue")).toThrow("quota");
});
