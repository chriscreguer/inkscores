#pragma once

#include <ArduinoJson.h>

#include "fetch_dashboard.h"

// How a render finished. A Spectra 6 full refresh takes ~12.5 s of panel time;
// `truncated` means the BUSY wait hit its ceiling instead of the panel
// reporting done, so the waveform was cut off and the screen is left dark and
// half-drawn. Valid after any of the render calls below.
struct RenderOutcome {
  uint32_t durationMs;
  bool truncated;
};

RenderOutcome lastRenderOutcome();

// Initialise the ePaper panel. Call once in setup() before rendering.
void initDisplay();

// Render a parsed dashboard document to the panel and refresh it. `status`
// lets the renderer show a small "cached" note when serving stale data.
void renderDashboard(const JsonDocument& doc, FetchStatus status);

// Render a packed 4bpp preview image from `/api/dashboard.4bpp`.
void renderPreviewImage4bpp(const uint8_t* data, size_t length, int width, int height);

// Render a minimal error screen when no dashboard data is available at all.
void renderError(const char* reason);
