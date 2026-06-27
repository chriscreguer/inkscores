#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_sleep.h>

#include "config.h"
#include "fetch_dashboard.h"
#include "fetch_preview_image.h"
#include "render_dashboard.h"
#include "sleep.h"
#include "network.h"

// Three front buttons (Seeed reTerminal E1002, all active-low):
//   GPIO3 green       -> refresh the current view (no mode change)
//   GPIO5 left white  -> force landscape (view 1)
//   GPIO4 right white -> force portrait  (view 2)
#ifndef REFRESH_BUTTON_PIN
#define REFRESH_BUTTON_PIN 3
#endif
#ifndef LANDSCAPE_BUTTON_PIN
#define LANDSCAPE_BUTTON_PIN 5
#endif
#ifndef PORTRAIT_BUTTON_PIN
#define PORTRAIT_BUTTON_PIN 4
#endif

RTC_DATA_ATTR bool portraitMode = false;

void initButtons() {
  // Every wake re-fetches and re-renders; the buttons only pick the view. EXT1
  // wakes on any of the three pins, and the status bitmask says which one.
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT1) {
    const uint64_t status = esp_sleep_get_ext1_wakeup_status();
    if (status & (1ULL << PORTRAIT_BUTTON_PIN)) {
      portraitMode = true;
      Serial0.println("Portrait button: view 2 (portrait)");
    } else if (status & (1ULL << LANDSCAPE_BUTTON_PIN)) {
      portraitMode = false;
      Serial0.println("Landscape button: view 1 (landscape)");
    } else if (status & (1ULL << REFRESH_BUTTON_PIN)) {
      Serial0.printf("Refresh button: redraw %s\n", portraitMode ? "portrait" : "landscape");
    }
  } else {
    Serial0.printf("Timer wake: %s mode\n", portraitMode ? "portrait" : "landscape");
  }
}

// The reTerminal E1002 dashboard is a wake-render-sleep device: there is no
// meaningful loop(). Everything happens once per wake in setup().
void setup() {
  Serial0.begin(115200);
  delay(100);
  Serial0.println("\nInkScores waking up");
  initButtons();

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

  uint8_t* previewImage = nullptr;
  size_t previewImageLength = 0;
  int previewImageWidth = 800;
  int previewImageHeight = 480;
  uint32_t previewRefreshSeconds = DEFAULT_SLEEP_SECONDS;
  Serial0.println("Fetching preview image");
  if (fetchPreviewImage(
          previewImage,
          previewImageLength,
          previewRefreshSeconds,
          portraitMode,
          previewImageWidth,
          previewImageHeight) ==
      PreviewImageStatus::Fresh) {
    shutdownWifi();
    Serial0.printf("Preview image bytes: %u\n", (unsigned)previewImageLength);
    Serial0.printf("Preview image size: %dx%d\n", previewImageWidth, previewImageHeight);
    Serial0.println("Rendering preview image");
    renderPreviewImage4bpp(previewImage, previewImageLength, previewImageWidth, previewImageHeight);
    freePreviewImage(previewImage);
    Serial0.println("Preview render complete");
    deepSleepSeconds(previewRefreshSeconds);
    return;
  }
  Serial0.println("Preview image unavailable, falling back to JSON");

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
