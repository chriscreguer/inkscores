import { describe, it, expect } from "vitest";
import { ordinal, formatStandingLine } from "../src/formatters/records.js";

describe("ordinal", () => {
  it("handles 1st, 2nd, 3rd", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
  });

  it("handles 4th and the 11-13 special cases", () => {
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
  });
});

describe("formatStandingLine", () => {
  it("builds 'AL Central: 2nd, 2.5 GB' when behind", () => {
    expect(formatStandingLine("AL Central", 2, "2.5")).toBe(
      "AL Central: 2nd, 2.5 GB",
    );
  });

  it("omits GB when leading (gamesBack '-')", () => {
    expect(formatStandingLine("AL Central", 1, "-")).toBe("AL Central: 1st");
  });

  it("omits GB when gamesBack is missing", () => {
    expect(formatStandingLine("Big Ten", 4, undefined)).toBe("Big Ten: 4th");
  });
});
