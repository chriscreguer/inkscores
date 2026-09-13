# Display refresh

Panel: **GDEP073E01**, 800×480, E Ink Spectra 6 (E6), driven by GxEPD2 over SPI
at 2 MHz. Six inks: black, white, red, yellow, green, blue. No orange — the
renderer maps `Accent::Orange` to red.

## How a render actually runs

`MAX_DISPLAY_BUFFER_SIZE` is 16000 bytes and the panel is 800 px wide at 4 bpp,
so GxEPD2 pages the framebuffer in **12 strips of 40 rows**. The scene is
redrawn in full on every strip; each strip is then shipped into controller RAM.
Only after the twelfth strip does GxEPD2 trigger one full-screen refresh.

| Phase | Time |
|-------|------|
| Paged drawing + SPI (12 × 16 KB @ 2 MHz) | ~2–3 s |
| Panel waveform (full refresh) | ~29 s |
| **Total, measured on this unit** | **~31.7 s** |

The panel's high-voltage booster is switched on at the *first* strip write
(`_InitDisplay()` ends with `_PowerOn()`), so it stays live across the whole
~31.7 s window, not just the waveform.

## The dark-screen bug (fixed)

**Symptom:** intermittently the screen came back dark and half-drawn, as if the
refresh had stopped partway, and stayed that way until the next wake — which on
the normal cadence could be hours.

**Cause:** GxEPD2 constructs this panel with a hard 20 s ceiling on every BUSY
wait:

```cpp
// GxEPD2_730c_GDEP073E01.cpp
GxEPD2_730c_GDEP073E01::GxEPD2_730c_GDEP073E01(...) :
  GxEPD2_EPD(cs, dc, rst, busy, LOW, 20000000, ...)
```

That ceiling was sized for the ~12.5 s full refresh the library measured.
**This unit takes ~31.7 s.** Past the ceiling, `_waitWhileBusy` gives up,
`refresh()` returns as though it had succeeded, and `GxEPD2_7C::nextPage()`
sends POF and then deep-sleep to a panel whose waveform is still running. The
pigment freezes mid-transit — a dark, half-drawn screen.

Note that `_waitWhileBusy(comment, busy_time)`'s `busy_time` argument is
**diagnostic only**. The panel's declared `full_refresh_time = 15000` has no
effect on the timeout; `_busy_timeout` is the only cap.

**Why it was intermittent rather than constant:** Spectra 6 selects its
waveform by panel temperature, so the refresh runs longer as the panel gets
colder. Warm enough and it finished under 20 s; below that threshold it was
truncated every time. The ~31.7 s measured above is the current regime, so
recent failures were likely the common case rather than the rare one.

**Why it was silent:** the only warning GxEPD2 emits is
`Serial.println("Busy Timeout!")`. See [Serial ports](#serial-ports) — that goes
somewhere nobody was watching.

## The fix

`_busy_timeout` is `protected`, and GxEPD2 lives in gitignored `.pio/libdeps`,
so the panel is subclassed purely to widen it (`render_dashboard.cpp`):

```cpp
class InkScoresPanel : public GxEPD2_730c_GDEP073E01 {
 public:
  InkScoresPanel(int16_t cs, int16_t dc, int16_t rst, int16_t busy)
      : GxEPD2_730c_GDEP073E01(cs, dc, rst, busy) {
    _busy_timeout = INKSCORES_BUSY_TIMEOUT_US;  // 60 s
  }
};
```

This only raises the ceiling — the wait still ends the instant BUSY deasserts,
so a fast refresh is no slower. 60 s is roughly 2× the measured case.

Alongside it:

- **`RenderOutcome` / `lastRenderOutcome()`** — every render path is timed. A
  render that reaches the ceiling is flagged `truncated` and reported, instead
  of passing for success.
- **Retry on truncation** — a truncated render sleeps
  `TRUNCATED_RENDER_RETRY_SECONDS` (120 s) and repaints, up to
  `MAX_TRUNCATED_RENDER_RETRIES` (2) times, then resumes the normal cadence.
  A ruined screen no longer persists for the full refresh interval.
- **`esp_reset_reason()` logged every boot** — a brownout during the ~31.7 s the
  booster is live produces an identical dark screen, and is the one cause a
  longer timeout cannot fix. It has to be distinguishable in the log.

## Reading the serial log

A healthy cycle:

```
InkScores waking up
Reset reason: power-on
Timer wake: landscape mode
Connecting to Wi-Fi. connected, IP 192.168.1.67
Fetching preview image
Preview image bytes: 192000
Preview image size: 800x480
Initializing display
Display initialized
Rendering preview image
Preview render complete
Render took 31692 ms
Sleeping for 289 seconds
```

| Log line | Meaning |
|----------|---------|
| `Render took N ms`, N ≈ 30000 | Normal for this panel. |
| `Render took N ms`, N ≈ 60000 | Hit the ceiling. The panel got slower still — raise `INKSCORES_BUSY_TIMEOUT_US`. |
| `Refresh hit the BUSY ceiling...` | Truncated render; a retry is scheduled. |
| `Reset reason: BROWNOUT` | Power, not firmware. Check supply/battery under refresh load. |
| `Reset reason: deep-sleep` | Normal wake. |
| `spiAttachMISO(): HSPI Does not have default pins` | Benign. MISO is passed as `-1`; the panel is write-only. |

## Serial ports

The board builds with `ARDUINO_USB_CDC_ON_BOOT=1`, which splits the two Arduino
serial objects:

| Object | Goes to |
|--------|---------|
| `Serial` | USB CDC — **what GxEPD2 prints to**, including `Busy Timeout!` |
| `Serial0` | UART0 — what all InkScores logging uses, and what `pio device monitor` attaches to |

That split is why the original failure left no trace in the monitor. If you ever
need GxEPD2's own diagnostics, either route them or use
`display.epd2.setBusyCallback()`.

The board exposes UART0 through a **CH340 bridge** (USB `1a86:7523`), which
appears as `/dev/cu.usbserial-*` on macOS. It is a separate chip powered from
USB, so the port stays enumerated even while the ESP32-S3 is in deep sleep.

## Flashing and watching a cycle

```bash
cd firmware
pio run --target upload --upload-port /dev/cu.usbserial-10
pio device monitor
```

The device wakes, renders, and deep-sleeps, so a cycle is over in well under a
minute. Press the green button (GPIO3) to force a wake and re-render without
waiting for the timer — also the quickest way to clear a screen that is
currently dark.
