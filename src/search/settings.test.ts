import { describe, expect, it, vi } from "vitest";
import { defaultSearchConfiguration, defaultSearchSettings, loadSearchConfiguration, loadSearchSettings, saveSearchConfiguration, saveSearchSettings, SEARCH_SETTINGS_KEY, validateSearchConfiguration, validateSearchQuery, validateSearchSettings } from "./settings";

describe("independent search settings", () => {
  it("migrates legacy settings into MCP without copying its Key to API or writing", () => {
    const legacy = { ...defaultSearchSettings(), apiKey: "legacy-mcp-key", numResults: 7 };
    let encoded = JSON.stringify(legacy);
    const storage = { getItem: () => encoded, setItem: (_key: string, value: string) => { encoded = value; } };
    const loaded = loadSearchConfiguration(storage);
    expect(loaded).toEqual(validateSearchConfiguration({ ...defaultSearchConfiguration(), exaMcp: legacy }));
    expect(JSON.parse(encoded)).toEqual(legacy);
    saveSearchConfiguration({ ...loaded, exaApi: { ...loaded.exaApi, apiKey: "api-only-key", numResults: 2 } }, storage);
    saveSearchSettings({ ...legacy, numResults: 3 }, storage);
    expect(loadSearchSettings(storage, "exa-api").apiKey).toBe("api-only-key");
    expect(loadSearchConfiguration(storage).exaMcp.numResults).toBe(3);
    expect(loadSearchConfiguration(storage).exaApi.numResults).toBe(2);
  });
  it("validates both profiles and rejects unsupported global data", () => {
    const config = defaultSearchConfiguration();
    expect(() => validateSearchConfiguration({ ...config, exaApi: { ...config.exaApi, baseUrl: "http://invalid.test" } })).toThrow();
    expect(() => validateSearchConfiguration({ ...config, exaMcp: undefined })).toThrow();
    expect(() => validateSearchConfiguration({ ...config, arbitraryService: config.exaApi })).toThrow();
    expect(() => validateSearchConfiguration({ ...config, version: 5 })).toThrow();
  });
  it("uses anonymous defaults without writing and round trips explicit saves", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadSearchSettings(storage)).toEqual(defaultSearchSettings());
    expect(values.size).toBe(0);
    const saved = saveSearchSettings({ ...defaultSearchSettings(), apiKey: "  synthetic-key  ", numResults: 10 }, storage);
    expect(saved.apiKey).toBe("synthetic-key");
    expect(loadSearchSettings(storage)).toEqual(saved);
    expect([...values.keys()]).toEqual([SEARCH_SETTINGS_KEY]);
  });

  it.each([
    "http://example.test/mcp", "https://user:synthetic-key@example.test/mcp", "https://example.test/mcp#fragment",
    "https://example.test/mcp?exaApiKey=synthetic-key", "https://example.test/mcp?access_token=synthetic-key",
    "https://example.test/mcp?API-KEY=synthetic-key", "https://example.test/mcp?password=synthetic-key",
    "https://example.test/mcp?custom=synthetic-key",
  ])("rejects unsafe endpoint %s without echoing its key", (baseUrl) => {
    let message = "";
    try { validateSearchSettings({ ...defaultSearchSettings(), baseUrl, apiKey: "synthetic-key" }); }
    catch (error) { message = (error as Error).message; }
    expect(message).not.toBe("");
    expect(message).not.toContain("synthetic-key");
    expect(message).not.toContain("example.test");
  });

  it.each([null, [], {}, { ...defaultSearchSettings(), version: 2 },
    { ...defaultSearchSettings(), numResults: 0 }, { ...defaultSearchSettings(), numResults: 11 },
    { ...defaultSearchSettings(), numResults: 1.5 }, { ...defaultSearchSettings(), apiKey: "synthetic-key\n" },
  ])("rejects corrupt settings rather than silently resetting", (value) => {
    expect(() => validateSearchSettings(value)).toThrow();
    expect(() => loadSearchSettings({ getItem: () => JSON.stringify(value), setItem: () => {} })).toThrow();
  });

  it("does not expose raw storage errors or corrupt JSON", () => {
    expect(() => loadSearchSettings({ getItem: () => "synthetic-key not-json", setItem: () => {} })).toThrow("已损坏");
    const storage = { getItem: () => { throw new Error("synthetic-key"); }, setItem: () => { throw new Error("synthetic-key"); } };
    expect(() => loadSearchSettings(storage)).toThrow("无法读取");
    expect(() => saveSearchSettings(defaultSearchSettings(), storage)).toThrow("无法保存");
  });

  it("counts Unicode codepoints, trims, and never silently truncates the query", () => {
    expect(validateSearchQuery(`  ${"😀".repeat(2000)}  `)).toBe("😀".repeat(2000));
    expect(validateSearchQuery("\u0085\uFEFFhello\uFEFF\u0085")).toBe("hello");
    expect(() => validateSearchQuery("😀".repeat(2001))).toThrow("2000");
    expect(() => validateSearchQuery(" \n ")).toThrow("请输入");
    expect(() => validateSearchQuery("\u0085\uFEFF\u0085")).toThrow("请输入");
    const start = performance.now();
    expect(() => validateSearchQuery(`x${" ".repeat(100_000)}x`)).toThrow("2000");
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("additional provider configuration migration", () => {
  it.each([1, 2, 3])("migrates v%s without writing or enabling new services and reads repeatedly", version => {
    const legacy = { ...defaultSearchSettings(), apiKey: "synthetic-old" };
    const defaults = defaultSearchConfiguration();
    const raw = version === 1 ? legacy
      : version === 2 ? { version: 2, exaMcp: legacy, exaApi: defaultSearchSettings("exa-api") }
      : { version: 3, exaMcp: legacy, exaApi: defaultSearchSettings("exa-api"),
          tavily: { ...defaults.tavily, enabled: true, apiKey: "synthetic-tavily" },
          zhipu: { ...defaults.zhipu, enabled: true, apiKey: "synthetic-zhipu" } };
    const encoded = JSON.stringify(raw); const setItem = vi.fn();
    const storage = { getItem: () => encoded, setItem };
    const loaded = loadSearchConfiguration(storage);
    expect(loaded.version).toBe(4);
    expect(loaded.tavily.enabled).toBe(version === 3); expect(loaded.zhipu.enabled).toBe(version === 3);
    expect(loaded.deepseek.enabled).toBe(false); expect(loaded.deepseek.apiKey).toBe("");
    expect(loaded.deepseek.baseUrl).toBe("https://api.deepseek.com/");
    expect(loaded.tavily.apiKey).toBe(version === 3 ? "synthetic-tavily" : "");
    expect(loaded.zhipu.apiKey).toBe(version === 3 ? "synthetic-zhipu" : "");
    expect(loadSearchConfiguration(storage)).toEqual(loaded); expect(validateSearchConfiguration(loaded)).toEqual(loaded);
    expect(setItem).not.toHaveBeenCalled(); expect(JSON.stringify(raw)).toBe(encoded);
  });
  it.each(["future", "unknown legacy v2", "unknown legacy v3", "unknown profile", "unknown deepseek field", "missing", "missing deepseek", "wrong toggle", "wrong deepseek toggle", "wrong engine"])("preserves %s data on rejected saves", scenario => {
    const config = defaultSearchConfiguration(); let raw: unknown = config;
    if (scenario === "future") raw = { ...config, version: 5 };
    if (scenario === "unknown legacy v2") raw = { version: 2, exaMcp: config.exaMcp, exaApi: config.exaApi, security: { key: "synthetic" } };
    if (scenario === "unknown legacy v3") raw = { version: 3, exaMcp: config.exaMcp, exaApi: config.exaApi, tavily: config.tavily, zhipu: config.zhipu, deepseek: config.deepseek };
    if (scenario === "unknown profile") raw = { ...config, tavily: { ...config.tavily, token: "synthetic" } };
    if (scenario === "unknown deepseek field") raw = { ...config, deepseek: { ...config.deepseek, needContent: true } };
    if (scenario === "missing") raw = { ...config, zhipu: undefined };
    if (scenario === "missing deepseek") raw = { ...config, deepseek: undefined };
    if (scenario === "wrong toggle") raw = { ...config, tavily: { ...config.tavily, enabled: "false" } };
    if (scenario === "wrong deepseek toggle") raw = { ...config, deepseek: { ...config.deepseek, enabled: "true" } };
    if (scenario === "wrong engine") raw = { ...config, zhipu: { ...config.zhipu, searchEngine: "future" } };
    const encoded = JSON.stringify(raw); const setItem = vi.fn(); const storage = { getItem: () => encoded, setItem };
    expect(() => loadSearchConfiguration(storage)).toThrow();
    expect(() => saveSearchConfiguration(raw as typeof config, storage)).toThrow(); expect(setItem).not.toHaveBeenCalled();
  });
});
