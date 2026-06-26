#include "fetch_preview_image.h"

#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <esp_heap_caps.h>

#include "config.h"

#ifndef DASHBOARD_IMAGE_URL
#define DASHBOARD_IMAGE_URL "https://inkscores-production.up.railway.app/api/dashboard.4bpp"
#endif

namespace {
constexpr size_t kPreviewImageBytes = 800 * 480 / 2;

uint8_t* allocateImageBuffer() {
  uint8_t* data = (uint8_t*)heap_caps_malloc(
      kPreviewImageBytes,
      MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (data != nullptr) return data;
  return (uint8_t*)heap_caps_malloc(kPreviewImageBytes, MALLOC_CAP_8BIT);
}

uint32_t parseRefreshHeader(HTTPClient& http) {
  const String value = http.header("X-Refresh-After-Seconds");
  const uint32_t seconds = (uint32_t)value.toInt();
  if (seconds < 60 || seconds > 86400) return DEFAULT_SLEEP_SECONDS;
  return seconds;
}
}  // namespace

PreviewImageStatus fetchPreviewImage(
    uint8_t*& data,
    size_t& length,
    uint32_t& refreshSeconds) {
  data = nullptr;
  length = 0;
  refreshSeconds = DEFAULT_SLEEP_SECONDS;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(15000);
  const char* headerKeys[] = {"X-Refresh-After-Seconds"};
  http.collectHeaders(headerKeys, 1);

  if (!http.begin(client, DASHBOARD_IMAGE_URL)) {
    Serial0.println("image http.begin failed");
    return PreviewImageStatus::Failed;
  }

  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial0.printf("Image GET failed: %d\n", code);
    http.end();
    return PreviewImageStatus::Failed;
  }

  const int contentLength = http.getSize();
  if (contentLength >= 0 && (size_t)contentLength != kPreviewImageBytes) {
    Serial0.printf("Bad image size: %d\n", contentLength);
    http.end();
    return PreviewImageStatus::Failed;
  }

  uint8_t* buffer = allocateImageBuffer();
  if (buffer == nullptr) {
    Serial0.println("Could not allocate preview image buffer");
    http.end();
    return PreviewImageStatus::Failed;
  }

  WiFiClient* stream = http.getStreamPtr();
  size_t read = 0;
  unsigned long lastDataAt = millis();
  while (read < kPreviewImageBytes && http.connected()) {
    const int available = stream->available();
    if (available > 0) {
      const size_t want = min((size_t)available, kPreviewImageBytes - read);
      const int n = stream->readBytes(buffer + read, want);
      if (n > 0) {
        read += (size_t)n;
        lastDataAt = millis();
      }
      continue;
    }

    if (millis() - lastDataAt > 15000UL) break;
    delay(10);
  }

  refreshSeconds = parseRefreshHeader(http);
  http.end();

  if (read != kPreviewImageBytes) {
    Serial0.printf("Short image read: %u\n", (unsigned)read);
    freePreviewImage(buffer);
    return PreviewImageStatus::Failed;
  }

  data = buffer;
  length = read;
  return PreviewImageStatus::Fresh;
}

void freePreviewImage(uint8_t* data) {
  if (data != nullptr) heap_caps_free(data);
}
