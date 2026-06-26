import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, Image } from "@napi-rs/canvas";
import logos from "./logos.json" with { type: "json" };
import { PREVIEW_HTML } from "./preview.js";
import type { Dashboard } from "./types.js";

// The browser preview renders with the macOS system font (SF Pro). @napi-rs/canvas
// does NOT resolve the CSS aliases in that stack (-apple-system, system-ui), so
// without registering a real font file it silently falls back to a serif face and
// the device image looks nothing like the "Real" tab. Register the bundled SF Pro
// Text faces under the exact family name the preview stack names ("SF Pro Text")
// so the server-rendered 4bpp matches the prototype on Linux (Railway) too.
const fontDir = fileURLToPath(new URL("./fonts/", import.meta.url));
const SF_PRO_TEXT_FACES = [
  "SF-Pro-Text-Regular.otf",
  "SF-Pro-Text-Semibold.otf",
  "SF-Pro-Text-Bold.otf",
  "SF-Pro-Text-Heavy.otf",
];
for (const face of SF_PRO_TEXT_FACES) {
  const facePath = path.join(fontDir, face);
  if (fs.existsSync(facePath)) {
    // All weights share the family name; @napi-rs/canvas picks the right face
    // from each font's own weight metadata when the preview sets ctx.font.
    GlobalFonts.registerFromPath(facePath, "SF Pro Text");
  } else {
    console.warn(`[previewImage] missing bundled font ${face}; preview text will fall back`);
  }
}

export const PREVIEW_IMAGE_WIDTH = 800;
export const PREVIEW_IMAGE_HEIGHT = 480;
export const PREVIEW_IMAGE_PACKED_BYTES =
  (PREVIEW_IMAGE_WIDTH * PREVIEW_IMAGE_HEIGHT) / 2;

const PALETTE = [
  [43, 43, 43],
  [232, 231, 225],
  [168, 56, 50],
  [61, 122, 82],
  [47, 74, 130],
  [204, 169, 58],
] as const;

const logoDir = fileURLToPath(new URL("./mock/logos/", import.meta.url));
const logoPathPrefix = logoDir.endsWith(path.sep) ? logoDir : `${logoDir}${path.sep}`;

const previewScript = (() => {
  const match = PREVIEW_HTML.match(/<script>([\s\S]*)<\/script>/);
  if (!match?.[1]) throw new Error("Preview script not found");
  return match[1]
    .replaceAll("/preview/team-logos/", logoPathPrefix)
    .replace(/load\(\);\s*$/, "globalThis.__loadPromise = load();");
})();

function nearestPaletteIndex(r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < PALETTE.length; i++) {
    const p = PALETTE[i];
    if (!p) continue;
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}

export async function renderPreviewImage4bpp(dashboard: Dashboard): Promise<Buffer> {
  const canvas = createCanvas(PREVIEW_IMAGE_WIDTH, PREVIEW_IMAGE_HEIGHT) as any;
  canvas.style = {};

  const elements: Record<string, any> = {
    screen: canvas,
    bar: { innerHTML: "" },
    meta: { textContent: "" },
  };

  const context: Record<string, any> = {
    console,
    URLSearchParams,
    location: { search: "" },
    localStorage: {
      getItem: (key: string) => {
        if (key === "inkDevice") return "e1002";
        if (key === "inkFont") return "SF Pro";
        return null;
      },
      setItem: () => {},
    },
    document: {
      getElementById: (id: string) => elements[id],
      createElement: (tag: string) => {
        if (tag !== "canvas") throw new Error(`Unsupported element: ${tag}`);
        const child = createCanvas(1, 1) as any;
        child.style = {};
        return child;
      },
      fonts: { load: async () => [] },
    },
    Image,
    fetch: async (url: string) => ({
      json: async () =>
        String(url).startsWith("/preview/logos.json") ? logos : dashboard,
    }),
  };

  vm.createContext(context);
  vm.runInContext(previewScript, context);
  await context.__loadPromise;

  const ctx = canvas.getContext("2d");
  const pixels = ctx.getImageData(0, 0, PREVIEW_IMAGE_WIDTH, PREVIEW_IMAGE_HEIGHT).data;
  const packed = Buffer.alloc(PREVIEW_IMAGE_PACKED_BYTES);

  for (let i = 0, j = 0; i < pixels.length; i += 8, j++) {
    const left = nearestPaletteIndex(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0);
    const right = nearestPaletteIndex(
      pixels[i + 4] ?? 0,
      pixels[i + 5] ?? 0,
      pixels[i + 6] ?? 0,
    );
    packed[j] = (left << 4) | right;
  }

  return packed;
}
