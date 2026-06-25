#pragma once

#include <Arduino.h>

// Layout constants for the 800x480 landscape ePaper panel. Kept here so the
// renderer and any future layout tweaks share one source of truth.
namespace layout {
constexpr int kWidth = 800;
constexpr int kHeight = 480;
constexpr int kMargin = 16;
constexpr int kSectionGap = 10;
constexpr int kCardHeight = 148;
constexpr int kFooterHeight = 16;
}  // namespace layout

// Accent colours map to whatever the panel supports. On a 6-colour Spectra
// panel these resolve to the nearest available ink; on black/white they fall
// back to black. The renderer owns the actual GxEPD2 colour constants.
enum class Accent { Gray, Blue, Red, Green, Orange };

inline Accent accentFromString(const char* value) {
  if (value == nullptr) return Accent::Gray;
  if (strcmp(value, "blue") == 0) return Accent::Blue;
  if (strcmp(value, "red") == 0) return Accent::Red;
  if (strcmp(value, "green") == 0) return Accent::Green;
  if (strcmp(value, "orange") == 0) return Accent::Orange;
  return Accent::Gray;
}

// Truncate text to a maximum character count, adding an ellipsis. Mirrors the
// backend's intent that the device never tries complex wrapping in the MVP.
inline String fitText(const String& value, int maxChars) {
  if (maxChars <= 0) return "";
  if ((int)value.length() <= maxChars) return value;
  return value.substring(0, maxChars - 1) + "...";
}
