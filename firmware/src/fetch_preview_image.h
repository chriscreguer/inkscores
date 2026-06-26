#pragma once

#include <Arduino.h>

enum class PreviewImageStatus { Fresh, Failed };

PreviewImageStatus fetchPreviewImage(
    uint8_t*& data,
    size_t& length,
    uint32_t& refreshSeconds,
    bool portraitMode,
    int& width,
    int& height);

void freePreviewImage(uint8_t* data);
