#include "wifi.h"

#include <WiFi.h>

#include "config.h"

bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long timeoutMs = (unsigned long)WIFI_TIMEOUT_SECONDS * 1000UL;
  const unsigned long start = millis();

  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > timeoutMs) {
      Serial.println(" timed out");
      return false;
    }
    delay(250);
    Serial.print(".");
  }

  Serial.print(" connected, IP ");
  Serial.println(WiFi.localIP());
  return true;
}

void shutdownWifi() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}
