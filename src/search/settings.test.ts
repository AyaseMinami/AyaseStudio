import { describe, expect, it } from "vitest";
import { defaultSearchConfiguration, defaultSearchSettings, loadSearchConfiguration, loadSearchSettings, saveSearchConfiguration, saveSearchSettings, SEARCH_SETTINGS_KEY, validateSearchConfiguration, validateSearchQuery, validateSearchSettings } from "./settings";

describe("independent search settings", () => {
  it("migrates legacy settings into MCP without copying its Key to API or writing", () => {
    const legacy = { ...defaultSearchSettings(), apiKey: "legacy-mcp-key", numResults: 7 };
    let encoded = JSON.stringify(legacy);
    const storage = { getItem: () => encoded, setItem: (_key: string, value: string) => { encoded = value; } };
    const loaded = loadSearchConfiguration(storage);
    expect(loaded).toEqual({ version: 2, exaMcp: legacy, exaApi: defaultSearchSettings("exa-api") });
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
    expect(() => validateSearchConfiguration({ ...config, version: 3 })).toThrow();
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
    expect(() => validateSearchQuery("😀".repeat(2001))).toThrow("2000");
    expect(() => validateSearchQuery(" \n ")).toThrow("请输入");
  });
});
