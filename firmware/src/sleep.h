#pragma once

#include <Arduino.h>

// Enter deep sleep for the given number of seconds. Does not return; the device
// reboots into setup() on wake.
void deepSleepSeconds(uint32_t seconds);
