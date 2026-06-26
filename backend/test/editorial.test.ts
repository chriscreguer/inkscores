import { describe, it, expect, vi } from "vitest";
import {
  extractResponseText,
  cleanSummary,
  shortenPlayerName,
  createEditorialClient,
} from "../src/llm/editorial.js";

/** A minimal OpenAI Responses-API payload carrying one text output. */
function responsePayload(text: string) {
  return {
    output: [
      { type: "web_search_call", id: "ws_1" },
      { type: "message", content: [{ type: "output_text", text }] },
    ],
  };
}

describe("extractResponseText", () => {
  it("reads text from the message item, ignoring tool-call items", () => {
    expect(extractResponseText(responsePayload("Tigers won 5-3."))).toBe("Tigers won 5-3.");
  });
  it("falls back to output_text convenience field", () => {
    expect(extractResponseText({ output_text: "  hi  " })).toBe("hi");
  });
  it("returns empty string when nothing is present", () => {
    expect(extractResponseText({})).toBe("");
  });
});

describe("cleanSummary", () => {
  it("collapses whitespace and strips wrapping quotes", () => {
    expect(cleanSummary('"Blew  an early\nlead."')).toBe("Blew an early lead.");
  });
  it("returns undefined for empty text", () => {
    expect(cleanSummary("   ")).toBeUndefined();
  });
  it("hard-caps at 112 characters", () => {
    const long = "a ".repeat(120).trim(); // ~239 chars
    const out = cleanSummary(long)!;
    expect(out.length).toBeLessThanOrEqual(112);
  });
});

describe("shortenPlayerName", () => {
  it("maps Pete Crow-Armstrong to PCA (special exception)", () => {
    expect(shortenPlayerName("Crow-Armstrong")).toBe("PCA");
    expect(shortenPlayerName("Pete Crow-Armstrong")).toBe("PCA");
  });
  it("caps long names at the max length (11)", () => {
    expect(shortenPlayerName("Featherston")).toBe("Featherston"); // exactly 11, kept
    expect(shortenPlayerName("Featherstone")).toBe("Featherston"); // 12 -> first 11
  });
  it("leaves short names untouched", () => {
    expect(shortenPlayerName("Greene")).toBe("Greene");
  });
});

describe("createEditorialClient", () => {
  it("returns {} and makes no call when no API key is configured", async () => {
    const fetchImpl = vi.fn();
    const client = createEditorialClient({ fetchImpl: fetchImpl as any });
    expect(await client.generate("tigers", { teamName: "Detroit Tigers" })).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("generates a recap from a single grounded call", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => responsePayload("Bats stayed hot in a tight loss to the Yankees."),
    } as any));
    const client = createEditorialClient({ apiKey: "sk-test", fetchImpl: fetchImpl as any });
    const ed = await client.generate("tigers", {
      teamName: "Detroit Tigers",
      lastGameLine: "L 3-2 vs NYY",
      lastFinalKey: "2026-06-24",
    });
    expect(ed.summary).toBe("Bats stayed hot in a tight loss to the Yankees.");
    expect(ed).not.toHaveProperty("hot");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // the recap prompt is grounded in the real final
    const recapBody = JSON.parse((fetchImpl.mock.calls[0] as any)[1].body);
    expect(recapBody.input).toContain("L 3-2 vs NYY");
    expect(recapBody.tools[0].type).toBe("web_search_preview");
  });

  it("caches by last-final key so a repeat needs no new calls", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => responsePayload("Bullpen usage is the main story."),
    } as any));
    const client = createEditorialClient({ apiKey: "sk-test", fetchImpl: fetchImpl as any });
    const ctx = { teamName: "Detroit Tigers", lastFinalKey: "2026-06-24" };
    await client.generate("tigers", ctx);
    await client.generate("tigers", ctx);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // second generate is cached
  });

  it("forces a fresh call, bypassing the cache, when asked", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => responsePayload("Fresh recap."),
    } as any));
    const client = createEditorialClient({ apiKey: "sk-test", fetchImpl: fetchImpl as any });
    const ctx = { teamName: "Detroit Tigers", lastFinalKey: "2026-06-24" };
    await client.generate("tigers", ctx);
    await client.generate("tigers", ctx, { force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches empty error results so refreshes do not retry the same game", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 } as any));
    const client = createEditorialClient({ apiKey: "sk-test", fetchImpl: fetchImpl as any });
    const ctx = { teamName: "Detroit Tigers", lastFinalKey: "2026-06-24" };
    expect(await client.generate("tigers", ctx)).toEqual({});
    expect(await client.generate("tigers", ctx)).toEqual({});
    expect(fetchImpl).toHaveBeenCalledTimes(1); // recap attempted once, empty cached
  });

  it("dedupes concurrent requests for the same game", async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, json: async () => responsePayload("Bullpen usage is the main story.") } as any;
    });
    const client = createEditorialClient({ apiKey: "sk-test", fetchImpl: fetchImpl as any });
    const ctx = { teamName: "Detroit Tigers", lastFinalKey: "2026-06-24" };
    const [a, b] = await Promise.all([
      client.generate("tigers", ctx),
      client.generate("tigers", ctx),
    ]);
    expect(a).toEqual(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
