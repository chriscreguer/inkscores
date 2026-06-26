#include "sleep.h"

#include <esp_sleep.h>

void deepSleepSeconds(uint32_t seconds) {
  Serial0.printf("Sleeping for %u seconds\n", seconds);
  Serial0.flush();

  const uint64_t micros = (uint64_t)seconds * 1000000ULL;
  esp_sleep_enable_timer_wakeup(micros);
  esp_deep_sleep_start();
}
