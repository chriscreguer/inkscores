import { GlobalFonts } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import featured from "../src/mock/dashboard.featured.json" with { type: "json" };
import {
  PREVIEW_IMAGE_PACKED_BYTES,
  renderPreviewImage4bpp,
} from "../src/previewImage.js";
import type { Dashboard } from "../src/types.js";

describe("preview image renderer", () => {
  it("renders the 800x480 preview as packed 4bpp palette data", async () => {
    const image = await renderPreviewImage4bpp(featured as unknown as Dashboard);

    expect(image.length).toBe(PREVIEW_IMAGE_PACKED_BYTES);
    expect(image.some((byte) => byte !== 0x11)).toBe(true);
  });

  it("renders the 480x800 portrait preview as packed 4bpp palette data", async () => {
    const image = await renderPreviewImage4bpp(featured as unknown as Dashboard, "e1002p");

    expect(image.length).toBe(PREVIEW_IMAGE_PACKED_BYTES);
    expect(image.some((byte) => byte !== 0x11)).toBe(true);
  });

  // Regression guard: without the bundled SF Pro Text faces, @napi-rs/canvas
  // falls back to a serif font and the device image stops matching the "Real"
  // tab prototype. Importing previewImage must register the family.
  it("registers the SF Pro Text family the preview stack relies on", () => {
    expect(GlobalFonts.has("SF Pro Text")).toBe(true);
  });
});
