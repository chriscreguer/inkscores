#include "fetch_dashboard.h"

#include <HTTPClient.h>
#include <LittleFS.h>
#include <WiFiClientSecure.h>

#include "config.h"

namespace {
constexpr const char* kCachePath = "/last.json";

// Download the dashboard payload as a String. Returns an empty string on error.
String httpsGet(const char* url) {
  WiFiClientSecure client;
  // MVP: skip certificate validation. For production, pin the backend's CA or
  // root certificate instead of trusting all hosts.
  client.setInsecure();

  HTTPClient http;
  http.setConnectTimeout(8000);
  http.setTimeout(8000);
  if (!http.begin(client, url)) {
    Serial0.println("http.begin failed");
    return String();
  }

  String body;
  const int code = http.GET();
  if (code == HTTP_CODE_OK) {
    body = http.getString();
  } else {
    Serial0.printf("HTTP GET failed: %d\n", code);
  }
  http.end();
  return body;
}

void saveCache(const String& payload) {
  File f = LittleFS.open(kCachePath, FILE_WRITE);
  if (!f) {
    Serial0.println("Could not open cache for writing");
    return;
  }
  f.print(payload);
  f.close();
}

bool loadCache(JsonDocument& doc) {
  File f = LittleFS.open(kCachePath, FILE_READ);
  if (!f) return false;
  const DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    Serial0.printf("Cache parse error: %s\n", err.c_str());
    return false;
  }
  return true;
}
}  // namespace

FetchStatus fetchDashboard(JsonDocument& doc) {
  if (!LittleFS.begin(true)) {
    Serial0.println("LittleFS mount failed (continuing without cache)");
  }

  const String payload = httpsGet(DASHBOARD_URL);
  if (payload.length() > 0) {
    const DeserializationError err = deserializeJson(doc, payload);
    if (!err) {
      saveCache(payload);
      return FetchStatus::Fresh;
    }
    Serial0.printf("JSON parse error: %s\n", err.c_str());
  }

  // Fetch or parse failed — fall back to the last good dashboard.
  doc.clear();
  if (loadCache(doc)) {
    return FetchStatus::Cached;
  }
  return FetchStatus::Failed;
}

uint32_t refreshSecondsFrom(const JsonDocument& doc) {
  const uint32_t seconds = doc["refreshAfterSeconds"] | (uint32_t)DEFAULT_SLEEP_SECONDS;
  // Guard against absurd values from a malformed payload.
  if (seconds < 60 || seconds > 86400) return DEFAULT_SLEEP_SECONDS;
  return seconds;
}
