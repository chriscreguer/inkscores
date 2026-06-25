#include "render_dashboard.h"

#include <GxEPD2_7C.h>

#include "dashboard_types.h"
#include "logos.h"

// ---------------------------------------------------------------------------
// Panel binding (BOARD-SPECIFIC)
//
// The reTerminal E1002 carries a 7.3" 6-colour (Spectra/E6) panel driven over
// SPI by the ESP32-S3. The exact GxEPD2 class and pin numbers depend on your
// board revision — confirm against Seeed's reTerminal E1002 ePaper example and
// adjust the four pins below if the display stays blank.
// ---------------------------------------------------------------------------
#ifndef EPD_CS
#define EPD_CS 10
#endif
#ifndef EPD_DC
#define EPD_DC 11
#endif
#ifndef EPD_RST
#define EPD_RST 12
#endif
#ifndef EPD_BUSY
#define EPD_BUSY 13
#endif

// E Ink Spectra 6 (E6) 7.3" panel as shipped on the reTerminal E1002.
// Inks: black, white, red, yellow, green, blue (no orange). Driven via the
// GxEPD2_7C colour-capable base. Confirm the exact class against Seeed's
// reTerminal E1002 ePaper example for your board revision.
GxEPD2_7C<GxEPD2_730c_GDEP073E01, GxEPD2_730c_GDEP073E01::HEIGHT> display(
    GxEPD2_730c_GDEP073E01(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

namespace {

uint16_t colorFor(Accent accent) {
  switch (accent) {
    case Accent::Blue:
      return GxEPD_BLUE;
    case Accent::Red:
      return GxEPD_RED;
    case Accent::Green:
      return GxEPD_GREEN;
    case Accent::Orange:
      // Spectra 6 has no orange ink; red is the closest available accent.
      return GxEPD_RED;
    case Accent::Gray:
    default:
      return GxEPD_BLACK;
  }
}

void drawText(int x, int y, const String& text, uint8_t size, uint16_t color) {
  display.setTextColor(color);
  display.setTextSize(size);
  display.setCursor(x, y);
  display.print(text);
}

const char* str(const JsonObjectConst& obj, const char* key, const char* fallback) {
  return obj[key] | fallback;
}

// --- Section renderers ---------------------------------------------------

// Small footer line at the bottom of the panel (no header band/title/rule,
// so the cards get the full height up top).
void renderFooter(const String& footer) {
  using namespace layout;
  const int charW = 6;  // size 1 default font advance
  const int fx = kWidth - kMargin - (int)footer.length() * charW;
  drawText(fx < kMargin ? kMargin : fx, kHeight - kFooterHeight, footer, 1, GxEPD_BLACK);
}

// Draw a centred string of size `size` at pixel centre (cx, cy).
void drawCentered(int cx, int cy, const String& text, uint8_t size, uint16_t color) {
  const int tw = (int)text.length() * 6 * size;  // default GFX font is 6px wide
  const int th = 8 * size;
  drawText(cx - tw / 2, cy - th / 2, text, size, color);
}

// Logo palette index -> GxEPD colour. MUST match PALETTE in tools/gen-logos.py.
// 0=black 1=white 2=red 3=green 4=blue 5=yellow
const uint16_t LOGO_PALETTE[6] = {
    GxEPD_BLACK, GxEPD_WHITE, GxEPD_RED, GxEPD_GREEN, GxEPD_BLUE, GxEPD_YELLOW,
};

// Blit a baked logo bitmap at (x, y). White pixels are skipped so the logo
// floats on the paper-coloured card.
void blitLogo(const Logo* lg, int x, int y) {
  for (int py = 0; py < lg->size; py++) {
    for (int px = 0; px < lg->size; px++) {
      const uint8_t idx = lg->data[py * lg->size + px];
      if (idx == 1 || idx >= 6) continue;  // white (or unexpected) -> paper
      display.drawPixel(x + px, y + py, LOGO_PALETTE[idx]);
    }
  }
}

// Fallback monogram badge: a solid accent-colour circle with a white letter.
void renderBadge(const JsonObjectConst& s, int cx, int cy, uint16_t accent) {
  const int r = 17;
  display.fillCircle(cx, cy, r, accent);
  String mono = str(s, "badge", "");
  if (mono.length() == 0) mono = fitText(str(s, "title", "?"), 1);  // first letter
  mono.toUpperCase();
  drawCentered(cx, cy, mono, mono.length() > 2 ? 2 : 3, GxEPD_WHITE);
}

// Watched-team key from a card id, e.g. "tigers-card" -> "tigers".
String keyFromId(const JsonObjectConst& s) {
  String id = str(s, "id", "");
  const int at = id.lastIndexOf("-card");
  return at >= 0 ? id.substring(0, at) : id;
}

// Draw the real baked logo for this team, falling back to the monogram badge
// when no bitmap exists for the key. Occupies a LOGO_SIZE box at (x, y).
void renderLogo(const JsonObjectConst& s, int x, int y, uint16_t accent) {
  const Logo* lg = logoForKey(keyFromId(s));
  if (lg) {
    blitLogo(lg, x, y);
  } else {
    renderBadge(s, x + LOGO_SIZE / 2, y + LOGO_SIZE / 2, accent);
  }
}

// Draw one team card at the given top-left corner with the given width.
void renderTeamCard(const JsonObjectConst& s, int x, int y, int w) {
  using namespace layout;
  const int h = kCardHeight;
  const uint16_t accent = colorFor(accentFromString(s["accent"] | "gray"));
  const int pad = 12;
  const bool live = strcmp(s["status"] | "active", "live") == 0;

  display.drawRect(x, y, w, h, GxEPD_BLACK);

  // Real team logo top-left, team name to its right (black; logo carries colour).
  renderLogo(s, x + pad, y + pad, accent);

  const int textX = x + pad;                    // body lines run full width below
  const int titleX = x + pad + LOGO_SIZE + 10;  // right of the logo
  drawText(titleX, y + pad + 8, fitText(str(s, "title", "Team"), 11), 3, GxEPD_BLACK);

  if (live) {
    // Solid red badge with white text reads as "live" at a glance.
    const int bw = 52, bh = 20, bx = x + w - bw - 8, by = y + 8;
    display.fillRect(bx, by, bw, bh, GxEPD_RED);
    drawText(bx + 6, by + 3, "LIVE", 2, GxEPD_WHITE);
  }

  // Last game: colour the W/L result green/red, keep the rest black. The letter
  // still says W or L, so colour is reinforcement, not the only cue.
  String last = fitText(str(s, "last", "-"), 24);
  uint16_t resultColor = GxEPD_BLACK;
  if (last.length() > 0 && last[0] == 'W') resultColor = GxEPD_GREEN;
  else if (last.length() > 0 && last[0] == 'L') resultColor = GxEPD_RED;
  if (resultColor != GxEPD_BLACK) {
    drawText(textX, y + 64, last.substring(0, 1), 2, resultColor);
    drawText(textX + 12, y + 64, last.substring(1), 2, GxEPD_BLACK);
  } else {
    drawText(textX, y + 64, last, 2, GxEPD_BLACK);
  }
  drawText(textX, y + 84, "Next: " + fitText(str(s, "next", "-"), 22), 2, GxEPD_BLACK);
  // Record + standing intentionally omitted from the card — it's in the
  // standings table below.
}

// True when index `i` is listed in the section's highlightRows array.
bool isHighlightRow(const JsonObjectConst& s, int i) {
  JsonArrayConst hl = s["highlightRows"].as<JsonArrayConst>();
  if (hl.isNull()) return false;
  for (JsonVariantConst v : hl) {
    if ((int)v.as<int>() == i) return true;
  }
  return false;
}

// Draw one standings table at the given top-left corner with the given width.
void renderStandings(const JsonObjectConst& s, int x, int y, int w, int h) {
  using namespace layout;
  const uint16_t accent = colorFor(accentFromString(s["accent"] | "gray"));

  drawText(x, y, fitText(str(s, "title", "Standings"), 22), 2, GxEPD_BLACK);
  display.drawFastHLine(x, y + 20, w, GxEPD_BLACK);

  JsonArrayConst rows = s["rows"].as<JsonArrayConst>();
  int ry = y + 30;
  const int rowH = 22;
  const int maxRows = (h - 30) / rowH;
  int count = 0;

  for (JsonArrayConst row : rows) {
    if (count >= maxRows) break;
    // Watched team's row gets a yellow highlighter fill (black text stays
    // readable on yellow) plus the team name in its accent colour. The fill
    // means the highlight survives even a degraded/monochrome render.
    const bool hot = isHighlightRow(s, count);
    if (hot) display.fillRect(x - 2, ry - 3, w + 2, rowH, GxEPD_YELLOW);
    const uint16_t teamColor = hot ? accent : GxEPD_BLACK;

    // Columns: rank, team, record, [gb]. Fixed x offsets keep rows aligned.
    const char* rank = row[0] | "";
    const char* team = row[1] | "";
    const char* rec = row[2] | "";
    const char* gb = row[3] | "";
    drawText(x, ry, String(rank), 2, GxEPD_BLACK);
    drawText(x + 28, ry, String(team), 2, teamColor);
    drawText(x + 120, ry, String(rec), 2, GxEPD_BLACK);
    drawText(x + 220, ry, String(gb), 2, GxEPD_BLACK);
    ry += rowH;
    count++;
  }
}

void renderMessage(const JsonObjectConst& s, int x, int y, int w) {
  drawText(x, y, fitText(str(s, "title", "Notice"), 30), 3, GxEPD_BLACK);
  drawText(x, y + 34, fitText(str(s, "body", ""), 58), 2, GxEPD_BLACK);
}

}  // namespace

void initDisplay() {
  display.init(115200);
  display.setRotation(0);  // 800x480 landscape
  display.setFullWindow();
}

void renderDashboard(const JsonDocument& doc, FetchStatus status) {
  using namespace layout;

  String footer = doc["footer"] | "Sports";
  if (status == FetchStatus::Cached) footer = "Cached - " + footer;

  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);

    // Partition sections by type so we can place them in the fixed MVP layout.
    JsonArrayConst sections = doc["sections"].as<JsonArrayConst>();

    int cardIndex = 0;
    int standingsIndex = 0;
    JsonObjectConst message;
    bool hasMessage = false;

    // No header band: cards start at the top margin and get the full height.
    const int contentTop = kMargin;
    const int colW = (kWidth - 2 * kMargin - kSectionGap) / 2;
    const int leftX = kMargin;
    const int rightX = kMargin + colW + kSectionGap;
    const int standingsTop = contentTop + kCardHeight + kSectionGap;
    const int standingsH = kHeight - standingsTop - kFooterHeight - kMargin;

    for (JsonObjectConst s : sections) {
      const char* type = s["type"] | "";
      if (strcmp(type, "teamCard") == 0 && cardIndex < 2) {
        const int x = (cardIndex == 0) ? leftX : rightX;
        renderTeamCard(s, x, contentTop, colW);
        cardIndex++;
      } else if (strcmp(type, "standings") == 0 && standingsIndex < 2) {
        const int x = (standingsIndex == 0) ? leftX : rightX;
        renderStandings(s, x, standingsTop, colW, standingsH);
        standingsIndex++;
      } else if (strcmp(type, "message") == 0 && !hasMessage) {
        message = s;
        hasMessage = true;
      }
    }

    // If there were no cards/standings, a message takes the whole content area.
    if (hasMessage && cardIndex == 0 && standingsIndex == 0) {
      renderMessage(message, kMargin, contentTop + 30, kWidth - 2 * kMargin);
    } else if (hasMessage && standingsIndex < 2) {
      // Otherwise show the message in the spare standings column.
      const int x = (standingsIndex == 0) ? leftX : rightX;
      renderMessage(message, x, standingsTop, colW);
    }

    renderFooter(footer);
  } while (display.nextPage());

  display.hibernate();
}

void renderError(const char* reason) {
  using namespace layout;
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    drawText(kMargin, 80, "Unable to load scores", 3, GxEPD_BLACK);
    drawText(kMargin, 130, String(reason), 2, GxEPD_BLACK);
    drawText(kMargin, 160, "Will retry shortly.", 2, GxEPD_BLACK);
  } while (display.nextPage());
  display.hibernate();
}
