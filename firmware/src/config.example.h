#pragma once

// Copy this file to `config.h` and fill in your values. `config.h` is
// gitignored so your Wi-Fi credentials never get committed.

#define WIFI_SSID "your_wifi"
#define WIFI_PASSWORD "your_password"

// Full URL to the backend dashboard endpoint. Must be reachable from the
// device. Use https:// in production.
#define DASHBOARD_URL "https://your-domain.com/api/dashboard.json"

// Optional: packed 4bpp preview image endpoint. If omitted in config.h, the
// firmware defaults to the production InkScores endpoint.
// #define DASHBOARD_IMAGE_URL "https://your-domain.com/api/dashboard.4bpp"

// Front buttons that wake the device from deep sleep (all active-low). Every
// wake re-fetches and re-renders; these only choose the view:
//   green (GPIO3)       -> refresh the current view, no mode change
//   left white (GPIO5)  -> landscape (view 1)
//   right white (GPIO4) -> portrait  (view 2)
// Override here if your unit wires the buttons to different GPIOs.
#define REFRESH_BUTTON_PIN 3
#define LANDSCAPE_BUTTON_PIN 5
#define PORTRAIT_BUTTON_PIN 4
// If portrait is upside down on the physical device, change this to 3.
#define PORTRAIT_DISPLAY_ROTATION 1

// Fallback sleep interval (seconds) if the backend does not provide
// refreshAfterSeconds. 7200 = 2 hours.
#define DEFAULT_SLEEP_SECONDS 7200

// Sleep interval (seconds) after a failed fetch with no cached data.
#define ERROR_SLEEP_SECONDS 1800

// Seconds to wait for a Wi-Fi connection before giving up.
#define WIFI_TIMEOUT_SECONDS 20
