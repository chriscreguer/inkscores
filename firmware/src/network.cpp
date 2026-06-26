#include "network.h"

#include <WiFi.h>

#include "config.h"

bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long timeoutMs = (unsigned long)WIFI_TIMEOUT_SECONDS * 1000UL;
  const unsigned long start = millis();

  Serial0.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > timeoutMs) {
      Serial0.println(" timed out");
      return false;
    }
    delay(250);
    Serial0.print(".");
  }

  Serial0.print(" connected, IP ");
  Serial0.println(WiFi.localIP());
  return true;
}

void shutdownWifi() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}
