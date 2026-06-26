#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_sleep.h>

#include "config.h"
#include "fetch_dashboard.h"
#include "fetch_preview_image.h"
#include "render_dashboard.h"
#include "sleep.h"
#include "network.h"

#ifndef VIEW_BUTTON_PIN
#define VIEW_BUTTON_PIN 3
#endif
#ifndef VIEW_BUTTON_ACTIVE_LOW
#define VIEW_BUTTON_ACTIVE_LOW 1
#endif

RTC_DATA_ATTR bool portraitMode = false;

void initViewModeButton() {
  pinMode(VIEW_BUTTON_PIN, VIEW_BUTTON_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  delay(10);
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0) {
    portraitMode = !portraitMode;
    Serial0.printf("View button wake: %s mode\n", portraitMode ? "portrait" : "landscape");
  } else {
    Serial0.printf("Current view mode: %s\n", portraitMode ? "portrait" : "landscape");
  }
}

// The reTerminal E1002 dashboard is a wake-render-sleep device: there is no
// meaningful loop(). Everything happens once per wake in setup().
void setup() {
  Serial0.begin(115200);
  delay(100);
  Serial0.println("\nInkScores waking up");
  initViewModeButton();

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
