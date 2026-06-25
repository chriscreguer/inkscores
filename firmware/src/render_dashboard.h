#pragma once

#include <ArduinoJson.h>

#include "fetch_dashboard.h"

// Initialise the ePaper panel. Call once in setup() before rendering.
void initDisplay();

// Render a parsed dashboard document to the panel and refresh it. `status`
// lets the renderer show a small "cached" note when serving stale data.
void renderDashboard(const JsonDocument& doc, FetchStatus status);

// Render a minimal error screen when no dashboard data is available at all.
void renderError(const char* reason);
