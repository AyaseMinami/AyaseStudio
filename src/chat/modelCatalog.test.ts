import { describe, expect, it, vi } from "vitest";

import {
  ModelCatalogError,
  createModelCatalogClient,
} from "./modelCatalog";
import { groupDiscoveredModels } from "./modelGrouping";
import type { ChatProtocol, FetchLike } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("model catalog client", () => {
  it.each([
    "openai-chat",
    "openai-responses",
    "gemini-native",
    "anthropic-native",
  ] satisfies ChatProtocol[])(
    "%s rejects an invalid Base URL before fetching a catalog",
    async (protocol) => {
      const fetch = vi.fn<FetchLike>();
      await expect(
        createModelCatalogClient(protocol, { fetch }).list({
          baseUrl: "https://relay.example.com/#invalid",
          apiKey: "synthetic-key",
        }),
      ).rejects.toMatchObject({
        name: "ModelCatalogError",
        message: "Base URL 不能包含片段。",
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["openai-chat", "https://relay.example.com/v1/models"],
    ["openai-responses", "https://relay.example.com/v1/models"],
  ] satisfies [ChatProtocol, string][])(
    "lists and normalizes models for %s",
    async (protocol, expectedUrl) => {
      const fetch = vi.fn<FetchLike>().mockResolvedValue(
        jsonResponse({
          data: [
            { id: "gpt-5.3-chat-latest", owned_by: "openai" },
            { id: "gpt-5.2-chat-latest", owned_by: "openai" },
            {
              id: "gpt-5.3-chat-latest",
              display_name: "GPT 5.3 Chat",
            },
          ],
        }),
      );

      const models = await createModelCatalogClient(protocol, { fetch }).list({
        baseUrl: "https://relay.example.com/v1/",
        apiKey: "synthetic-key",
      });

      expect(fetch).toHaveBeenCalledWith(
        expectedUrl,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer synthetic-key",
          }),
        }),
      );
      expect(models).toEqual([
        {
          id: "gpt-5.2-chat-latest",
          ownedBy: "openai",
        },
        {
          id: "gpt-5.3-chat-latest",
          displayName: "GPT 5.3 Chat",
          ownedBy: "openai",
        },
      ]);
    },
  );

  it("uses the Gemini native list route and strips the models prefix", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
          },
        ],
      }),
    );

    const models = await createModelCatalogClient("gemini-native", {
      fetch,
    }).list({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "synthetic-gemini-key",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-goog-api-key": "synthetic-gemini-key",
        }),
      }),
    );
    expect(models).toEqual([
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
    ]);
  });

  it("follows Gemini page tokens and merges the complete catalog", async () => {
    const fetch = vi.fn<FetchLike>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      return url.searchParams.get("pageToken") === "next page"
        ? jsonResponse({ models: [{ name: "models/gemini-2.5-pro" }] })
        : jsonResponse({
            models: [{ name: "models/gemini-2.5-flash" }],
            nextPageToken: "next page",
          });
    });

    const models = await createModelCatalogClient("gemini-native", {
      fetch,
    }).list({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "synthetic-gemini-key",
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?pageToken=next+page",
    );
    expect(models.map((model) => model.id)).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ]);
  });

  it("uses the Anthropic native list route and headers", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "claude-sonnet-4-5",
            display_name: "Claude Sonnet 4.5",
          },
        ],
      }),
    );

    await createModelCatalogClient("anthropic-native", { fetch }).list({
      baseUrl: "https://api.anthropic.com/",
      apiKey: "synthetic-anthropic-key",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "anthropic-version": "2023-06-01",
          "x-api-key": "synthetic-anthropic-key",
        }),
      }),
    );
  });

  it("follows Anthropic cursors and merges the complete catalog", async () => {
    const fetch = vi.fn<FetchLike>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      return url.searchParams.get("after_id") === "model-first"
        ? jsonResponse({
            data: [{ id: "model-second" }],
            has_more: false,
            last_id: "model-second",
          })
        : jsonResponse({
            data: [{ id: "model-first" }],
            has_more: true,
            last_id: "model-first",
          });
    });

    const models = await createModelCatalogClient("anthropic-native", {
      fetch,
    }).list({
      baseUrl: "https://api.anthropic.com",
      apiKey: "synthetic-anthropic-key",
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      "https://api.anthropic.com/v1/models?after_id=model-first",
    );
    expect(models.map((model) => model.id)).toEqual([
      "model-first",
      "model-second",
    ]);
  });

  it("groups discovered models by metadata first and model family second", () => {
    expect(
      groupDiscoveredModels([
        { id: "unknown-one", family: "Vendor family" },
        { id: "gpt-5.3-chat-latest" },
        { id: "gpt-5.3-thinking" },
        { id: "unclassified" },
      ]),
    ).toEqual([
      {
        label: "gpt-5.3",
        models: [
          { id: "gpt-5.3-chat-latest" },
          { id: "gpt-5.3-thinking" },
        ],
      },
      {
        label: "Vendor family",
        models: [{ id: "unknown-one", family: "Vendor family" }],
      },
      {
        label: "其他",
        models: [{ id: "unclassified" }],
      },
    ]);
  });

  it("reports status and a safe upstream message without exposing credentials", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(
        { error: { message: "catalog secret-value unavailable" } },
        503,
      ),
    );

    const request = createModelCatalogClient("openai-chat", { fetch }).list({
      baseUrl: "https://relay.example.com/v1",
      apiKey: "secret-value",
    });

    await expect(request).rejects.toEqual(
      expect.objectContaining<ModelCatalogError>({
        name: "ModelCatalogError",
        status: 503,
        message: "catalog [已隐藏凭据] unavailable",
      }),
    );
    await expect(request).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining("secret-value"),
    );
  });
});
