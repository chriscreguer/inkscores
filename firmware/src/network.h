#pragma once

#include <Arduino.h>

// Connect to Wi-Fi using the credentials in config.h. Returns true on success
// within WIFI_TIMEOUT_SECONDS, false otherwise.
bool connectWifi();

// Disconnect and power down the radio before sleeping to save battery.
void shutdownWifi();
