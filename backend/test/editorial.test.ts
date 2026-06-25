import { describe, it, expect, vi } from "vitest";
import {
  extractResponseText,
  cleanSummary,
  parseHotCold,
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
  it("hard-caps at 116 characters", () => {
    const long = "a ".repeat(120).trim(); // ~239 chars
    const out = cleanSummary(long)!;
    expect(out.length).toBeLessThanOrEqual(116);
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

describe("parseHotCold", () => {
  it("parses clean JSON with last names, capped at 3 each", () => {
    expect(parseHotCold('{"hot":["Greene","Dingler","Keith","Extra"],"cold":["Baez"]}')).toEqual({
      hot: ["Greene", "Dingler", "Keith"],
      cold: ["Baez"],
    });
  });

  it("applies the PCA exception and length cap to parsed names", () => {
    expect(parseHotCold('{"hot":["Crow-Armstrong"],"cold":["Featherston"]}')).toEqual({
      hot: ["PCA"],
      cold: ["Featherston"],
    });
  });
  it("tolerates code fences / surrounding prose", () => {
    const text = "Sure!\n```json\n{\"hot\":[\"Mize\"],\"cold\":[]}\n```";
    expect(parseHotCold(text)).toEqual({ hot: ["Mize"] });
  });
  it("returns {} for unparseable output", () => {
    expect(parseHotCold("no json here")).toEqual({});
  });
});

describe("createEditorialClient", () => {
  it("returns {} and makes no call when no API key is configured", async () => {
    const fetchImpl = vi.fn();
    const client = createEditorialClient({ fetchImpl: fetchImpl as any });
    expect(await client.generate("tigers", { teamName: "Detroit Tigers" })).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("generates recap + hot/cold from two parallel calls", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      const isHotCold = body.input.includes("hot and which players are cold");
      const text = isHotCold
        ? '{"hot":["Dingler","Greene"],"cold":["Baez"]}'
        : "Bats stayed hot in a tight loss to the Yankees.";
      return { ok: true, json: async () => responsePayload(text) } as any;
    });
    const client = createEditorialClient({ apiKey: "sk-test", fetchImpl: fetchImpl as any });
    const ed = await client.generate("tigers", {
      teamName: "Detroit Tigers",
      lastGameLine: "L 3-2 vs NYY",
      lastFinalKey: "2026-06-24",
    });
    expect(ed.summary).toBe("Bats stayed hot in a tight loss to the Yankees.");
    expect(ed.hot).toEqual(["Dingler", "Greene"]);
    expect(ed.cold).toEqual(["Baez"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // the recap prompt is grounded in the real final
    const recapBody = JSON.parse(
      (fetchImpl.mock.calls.find((c: any) => !JSON.parse(c[1].body).input.includes("cold"))![1] as any).body,
    );
    expect(recapBody.input).toContain("L 3-2 vs NYY");
    expect(recapBody.tools[0].type).toBe("web_search_preview");
  });

  it("caches by last-final key so a repeat needs no new calls", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => responsePayload('{"hot":["X"],"cold":[]}'),
    } as any));
    const client = createEditorialClient({ apiKey: "sk-test", fetchImpl: fetchImpl as any });
    const ctx = { teamName: "Detroit Tigers", lastFinalKey: "2026-06-24" };
    await client.generate("tigers", ctx);
    await client.generate("tigers", ctx);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 2 prompts, once — second generate is cached
  });

  it("degrades to {} when the API errors", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 } as any));
    const client = createEditorialClient({ apiKey: "sk-test", fetchImpl: fetchImpl as any });
    expect(await client.generate("tigers", { teamName: "Detroit Tigers" })).toEqual({});
  });
});
