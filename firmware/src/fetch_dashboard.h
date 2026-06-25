#pragma once

#include <ArduinoJson.h>

enum class FetchStatus {
  Fresh,   // freshly downloaded from the backend
  Cached,  // download failed but a previously saved dashboard was loaded
  Failed,  // no data available at all
};

// Fetch the dashboard JSON into `doc`. On a successful download the payload is
// also cached to flash. On failure, the last cached payload is loaded instead.
FetchStatus fetchDashboard(JsonDocument& doc);

// Read refreshAfterSeconds from a parsed dashboard, falling back to
// DEFAULT_SLEEP_SECONDS when the field is missing or invalid.
uint32_t refreshSecondsFrom(const JsonDocument& doc);
