#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_sleep.h>
#include <esp_system.h>

#include "config.h"
#include "fetch_dashboard.h"
#include "fetch_preview_image.h"
#include "render_dashboard.h"
#include "sleep.h"
#include "network.h"

// Three front buttons (Seeed reTerminal E1002, all active-low):
//   GPIO3 green       -> refresh the current view (no mode change)
//   GPIO5 left white  -> landscape: toggle Tigers+Cubs <-> Tigers stats panel
//   GPIO4 right white -> toggle portrait <-> landscape
#ifndef REFRESH_BUTTON_PIN
#define REFRESH_BUTTON_PIN 3
#endif
#ifndef LANDSCAPE_BUTTON_PIN
#define LANDSCAPE_BUTTON_PIN 5
#endif
#ifndef PORTRAIT_BUTTON_PIN
#define PORTRAIT_BUTTON_PIN 4
#endif

// Seconds to wait before re-rendering after a refresh that got cut off, and
// how many times in a row to try before giving up and resuming the normal
// cadence. A truncated refresh leaves the panel dark, so waiting out the usual
// multi-hour interval would strand the user looking at a ruined screen.
#define TRUNCATED_RENDER_RETRY_SECONDS 120
#define MAX_TRUNCATED_RENDER_RETRIES 2

RTC_DATA_ATTR uint8_t truncatedRenderRetries = 0;

RTC_DATA_ATTR bool portraitMode = false;
// Landscape-only: false = Tigers+Cubs (default), true = Tigers+Tigers stats.
// Irrelevant while portraitMode is true, but left button always sets it so the
// right sub-mode is already selected whenever landscape is shown next.
RTC_DATA_ATTR bool showTigersStats = false;

const char* resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_EXT: return "external";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "interrupt-wdt";
    case ESP_RST_TASK_WDT: return "task-wdt";
    case ESP_RST_WDT: return "other-wdt";
    case ESP_RST_DEEPSLEEP: return "deep-sleep";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "sdio";
    default: return "unknown";
  }
}

// A reset that is not a clean deep-sleep wake means the previous cycle died
// partway through. If it died during the ~15 s the panel spends refreshing,
// the screen is currently dark and half-drawn -- worth naming in the log,
// because a brownout here is the one cause a longer BUSY timeout cannot fix.
void reportResetReason() {
  const esp_reset_reason_t reason = esp_reset_reason();
  Serial0.printf("Reset reason: %s\n", resetReasonName(reason));
  if (reason == ESP_RST_BROWNOUT) {
    Serial0.println("Previous cycle browned out; check supply/battery under refresh load");
  }
}

// Decide how long to sleep after a render, shortening the interval when the
// refresh was cut off so the dark screen gets repainted soon instead of
// persisting for the full refresh interval.
uint32_t sleepAfterRender(uint32_t normalSeconds) {
  const RenderOutcome outcome = lastRenderOutcome();
  Serial0.printf("Render took %u ms\n", (unsigned)outcome.durationMs);
  if (!outcome.truncated) {
    truncatedRenderRetries = 0;
    return normalSeconds;
  }
  Serial0.println("Refresh hit the BUSY ceiling; panel was cut off mid-waveform");
  if (truncatedRenderRetries >= MAX_TRUNCATED_RENDER_RETRIES) {
    Serial0.println("Retry budget spent; resuming normal cadence");
    truncatedRenderRetries = 0;
    return normalSeconds;
  }
  truncatedRenderRetries++;
  Serial0.printf("Retrying render (%u/%u)\n",
                 truncatedRenderRetries,
                 (unsigned)MAX_TRUNCATED_RENDER_RETRIES);
  return TRUNCATED_RENDER_RETRY_SECONDS;
}

void initButtons() {
  // Every wake re-fetches and re-renders; the buttons only pick the view. EXT1
  // wakes on any of the three pins, and the status bitmask says which one.
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT1) {
    const uint64_t status = esp_sleep_get_ext1_wakeup_status();
    if (status & (1ULL << PORTRAIT_BUTTON_PIN)) {
      portraitMode = !portraitMode;
      Serial0.printf("Right button: %s\n", portraitMode ? "portrait" : "landscape");
    } else if (status & (1ULL << LANDSCAPE_BUTTON_PIN)) {
      portraitMode = false;
      showTigersStats = !showTigersStats;
      Serial0.printf("Left button: landscape, %s\n", showTigersStats ? "Tigers stats" : "Tigers+Cubs");
    } else if (status & (1ULL << REFRESH_BUTTON_PIN)) {
      Serial0.printf("Refresh button: redraw %s\n", portraitMode ? "portrait" : "landscape");
    }
  } else {
    Serial0.printf("Timer wake: %s mode\n", portraitMode ? "portrait" : "landscape");
  }
}

// The reTerminal E1002 dashboard is a wake-fetch-render-sleep device: there is
// no meaningful loop(). Everything happens once per wake in setup().
void setup() {
  Serial0.begin(115200);
  delay(100);
  Serial0.println("\nInkScores waking up");
  reportResetReason();
  initButtons();

  if (!connectWifi()) {
    // E-paper retains the last image without power. If there is no Wi-Fi,
    // leave the screen alone instead of repainting stale fallback content.
    Serial0.println("Wi-Fi unavailable; leaving display unchanged");
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
          showTigersStats,
          previewImageWidth,
          previewImageHeight) ==
      PreviewImageStatus::Fresh) {
    shutdownWifi();
    Serial0.printf("Preview image bytes: %u\n", (unsigned)previewImageLength);
    Serial0.printf("Preview image size: %dx%d\n", previewImageWidth, previewImageHeight);
    Serial0.println("Initializing display");
    initDisplay();
    Serial0.println("Display initialized");
    Serial0.println("Rendering preview image");
    renderPreviewImage4bpp(previewImage, previewImageLength, previewImageWidth, previewImageHeight);
    freePreviewImage(previewImage);
    Serial0.println("Preview render complete");
    deepSleepSeconds(sleepAfterRender(previewRefreshSeconds));
    return;
  }
  Serial0.println("Preview image unavailable, falling back to JSON");

  // ArduinoJson 7 elastic document; backend keeps the payload under ~16 KB.
  JsonDocument doc;
  Serial0.println("Fetching dashboard");
  const FetchStatus status = fetchDashboard(doc);
  Serial0.printf("Fetch status: %d\n", (int)status);
  shutdownWifi();

  Serial0.println("Initializing display");
  initDisplay();
  Serial0.println("Display initialized");

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

  deepSleepSeconds(sleepAfterRender(sleepSeconds));
}

void loop() {
  // Never reached; the device deep-sleeps at the end of setup().
}
