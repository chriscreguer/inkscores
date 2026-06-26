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

// Button used to toggle landscape/portrait bitmap mode while the device sleeps.
// The E1002 programmable buttons are commonly exposed as GPIO3/GPIO4/GPIO5;
// change this if you wire a different button.
#define VIEW_BUTTON_PIN 3
#define VIEW_BUTTON_ACTIVE_LOW 1
// If portrait is upside down on the physical device, change this to 3.
#define PORTRAIT_DISPLAY_ROTATION 1

// Fallback sleep interval (seconds) if the backend does not provide
// refreshAfterSeconds. 7200 = 2 hours.
#define DEFAULT_SLEEP_SECONDS 7200

// Sleep interval (seconds) after a failed fetch with no cached data.
#define ERROR_SLEEP_SECONDS 1800

// Seconds to wait for a Wi-Fi connection before giving up.
#define WIFI_TIMEOUT_SECONDS 20
