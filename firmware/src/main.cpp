#include <Arduino.h>
#include <ArduinoJson.h>

#include "config.h"
#include "fetch_dashboard.h"
#include "render_dashboard.h"
#include "sleep.h"
#include "network.h"

// The reTerminal E1002 dashboard is a wake-render-sleep device: there is no
// meaningful loop(). Everything happens once per wake in setup().
void setup() {
  Serial0.begin(115200);
  delay(100);
  Serial0.println("\nInkScores waking up");

  Serial0.println("Initializing display");
  initDisplay();
  Serial0.println("Display initialized");

  if (!connectWifi()) {
    // No network: try to show the last cached dashboard, else an error screen.
    JsonDocument doc;
    if (fetchDashboard(doc) == FetchStatus::Cached) {
      renderDashboard(doc, FetchStatus::Cached);
    } else {
      renderError("Wi-Fi unavailable");
    }
    shutdownWifi();
    deepSleepSeconds(ERROR_SLEEP_SECONDS);
    return;  // unreachable; deep sleep restarts the chip
  }

  // ArduinoJson 7 elastic document; backend keeps the payload under ~16 KB.
  JsonDocument doc;
  Serial0.println("Fetching dashboard");
  const FetchStatus status = fetchDashboard(doc);
  Serial0.printf("Fetch status: %d\n", (int)status);
  shutdownWifi();

  uint32_t sleepSeconds;
  if (status == FetchStatus::Failed) {
    Serial0.println("Rendering error");
    renderError("No data available");
    sleepSeconds = ERROR_SLEEP_SECONDS;
  } else {
    Serial0.println("Rendering dashboard");
    renderDashboard(doc, status);
    Serial0.println("Render complete");
    sleepSeconds = refreshSecondsFrom(doc);
  }

  deepSleepSeconds(sleepSeconds);
}

void loop() {
  // Never reached; the device deep-sleeps at the end of setup().
}
