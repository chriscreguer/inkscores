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
  Serial.begin(115200);
  delay(100);
  Serial.println("\nInkScores waking up");

  initDisplay();

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
  const FetchStatus status = fetchDashboard(doc);
  shutdownWifi();

  uint32_t sleepSeconds;
  if (status == FetchStatus::Failed) {
    renderError("No data available");
    sleepSeconds = ERROR_SLEEP_SECONDS;
  } else {
    renderDashboard(doc, status);
    sleepSeconds = refreshSecondsFrom(doc);
  }

  deepSleepSeconds(sleepSeconds);
}

void loop() {
  // Never reached; the device deep-sleeps at the end of setup().
}
