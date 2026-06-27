#include "sleep.h"

#include <esp_sleep.h>
#include <driver/gpio.h>
#include <driver/rtc_io.h>

#include "config.h"

// Keep these in sync with main.cpp. All three front buttons are active-low.
#ifndef REFRESH_BUTTON_PIN
#define REFRESH_BUTTON_PIN 3
#endif
#ifndef LANDSCAPE_BUTTON_PIN
#define LANDSCAPE_BUTTON_PIN 5
#endif
#ifndef PORTRAIT_BUTTON_PIN
#define PORTRAIT_BUTTON_PIN 4
#endif

void deepSleepSeconds(uint32_t seconds) {
  Serial0.printf("Sleeping for %u seconds\n", seconds);
  Serial0.flush();

  const uint64_t micros = (uint64_t)seconds * 1000000ULL;
  esp_sleep_enable_timer_wakeup(micros);

  // Wake on any of the three buttons. They idle high and pull to ground when
  // pressed, so hold the internal pullups through sleep and wake on ANY_LOW.
  const int buttons[] = {REFRESH_BUTTON_PIN, LANDSCAPE_BUTTON_PIN, PORTRAIT_BUTTON_PIN};
  uint64_t mask = 0;
  for (int pin : buttons) {
    mask |= (1ULL << pin);
    rtc_gpio_pullup_en((gpio_num_t)pin);
    rtc_gpio_pulldown_dis((gpio_num_t)pin);
  }
  esp_sleep_enable_ext1_wakeup(mask, ESP_EXT1_WAKEUP_ANY_LOW);
  esp_deep_sleep_start();
}
