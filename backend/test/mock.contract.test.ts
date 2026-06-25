import { describe, it, expect } from "vitest";
import mlb from "../src/mock/dashboard.mlb.json" with { type: "json" };
import type { Dashboard } from "../src/types.js";

const dash = mlb as unknown as Dashboard;

describe("mock MLB dashboard - Phase 1 acceptance criteria", () => {
  it("has required top-level fields", () => {
    expect(dash.version).toBeDefined();
    expect(dash.updatedAt).toBeDefined();
    expect(typeof dash.refreshAfterSeconds).toBe("number");
    expect(Array.isArray(dash.sections)).toBe(true);
  });

  it("contains a Tigers card and a Cubs card", () => {
    const titles = dash.sections
      .filter((s) => s.type === "teamCard")
      .map((s) => (s as { title: string }).title);
    expect(titles).toContain("Tigers");
    expect(titles).toContain("Cubs");
  });

  it("contains AL Central and NL Central standings", () => {
    const titles = dash.sections
      .filter((s) => s.type === "standings")
      .map((s) => (s as { title: string }).title);
    expect(titles).toContain("AL Central");
    expect(titles).toContain("NL Central");
  });
});
