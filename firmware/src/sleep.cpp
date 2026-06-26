#include "sleep.h"

#include <esp_sleep.h>
#include <driver/gpio.h>

#include "config.h"

#ifndef VIEW_BUTTON_PIN
#define VIEW_BUTTON_PIN 3
#endif
#ifndef VIEW_BUTTON_ACTIVE_LOW
#define VIEW_BUTTON_ACTIVE_LOW 1
#endif

void deepSleepSeconds(uint32_t seconds) {
  Serial0.printf("Sleeping for %u seconds\n", seconds);
  Serial0.flush();

  const uint64_t micros = (uint64_t)seconds * 1000000ULL;
  esp_sleep_enable_timer_wakeup(micros);
  esp_sleep_enable_ext0_wakeup(
      (gpio_num_t)VIEW_BUTTON_PIN,
      VIEW_BUTTON_ACTIVE_LOW ? 0 : 1);
  esp_deep_sleep_start();
}
