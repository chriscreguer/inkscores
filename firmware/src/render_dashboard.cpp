#include "render_dashboard.h"

#include <GxEPD2_7C.h>
#include <SPI.h>

#include "dashboard_types.h"
#include "logos.h"

#if __has_include("sf_pro_fonts.h")
// Locally generated from user-installed SF Pro fonts. This file is gitignored
// because it contains font bitmap data from a licensed, user-supplied font.
#include "sf_pro_fonts.h"
#define INKSCORES_HAS_SF_PRO 1
#else
#define INKSCORES_HAS_SF_PRO 0
#endif

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
#ifndef EPD_SCK
#define EPD_SCK 7
#endif
#ifndef EPD_MOSI
#define EPD_MOSI 9
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

SPIClass hspi(HSPI);

#define MAX_DISPLAY_BUFFER_SIZE 16000u
#define MAX_HEIGHT(EPD) \
  (EPD::HEIGHT <= (MAX_DISPLAY_BUFFER_SIZE) / (EPD::WIDTH / 2) \
       ? EPD::HEIGHT \
       : (MAX_DISPLAY_BUFFER_SIZE) / (EPD::WIDTH / 2))

// E Ink Spectra 6 (E6) 7.3" panel as shipped on the reTerminal E1002.
// Inks: black, white, red, yellow, green, blue (no orange).
GxEPD2_7C<GxEPD2_730c_GDEP073E01, MAX_HEIGHT(GxEPD2_730c_GDEP073E01)> display(
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

struct TextMetrics {
  int w;
  int h;
};

#if INKSCORES_HAS_SF_PRO
const GFXfont* fontFor(uint8_t size) {
  switch (size) {
    case 1:
      return &SFProTextRegular8pt7b;
    case 3:
      return &SFProDisplayRegular18pt7b;
    case 2:
    default:
      return &SFProTextRegular12pt7b;
  }
}

void applyFont(uint8_t size) {
  display.setFont(fontFor(size));
  display.setTextSize(1);
}

TextMetrics measureText(const String& text, uint8_t size) {
  applyFont(size);
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  return {(int)w, (int)h};
}

void drawText(int x, int y, const String& text, uint8_t size, uint16_t color) {
  applyFont(size);
  display.setTextColor(color);

  // Custom GFX fonts position the cursor on the baseline. Keep the renderer's
  // existing top-left text coordinates by offsetting with the measured bounds.
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  display.setCursor(x - x1, y - y1);
  display.print(text);
}
#else
TextMetrics measureText(const String& text, uint8_t size) {
  return {(int)text.length() * 6 * size, 8 * size};
}

void drawText(int x, int y, const String& text, uint8_t size, uint16_t color) {
  display.setFont();
  display.setTextColor(color);
  display.setTextSize(size);
  display.setCursor(x, y);
  display.print(text);
}
#endif

const char* str(const JsonObjectConst& obj, const char* key, const char* fallback) {
  return obj[key] | fallback;
}

void renderNextGame(const String& next, int x, int y, uint16_t color);

// --- Section renderers ---------------------------------------------------

// Small footer line at the bottom of the panel (no header band/title/rule,
// so the cards get the full height up top).
void renderFooter(const String& footer) {
  using namespace layout;
  const int fx = kWidth - kMargin - measureText(footer, 1).w;
  drawText(fx < kMargin ? kMargin : fx, kHeight - kFooterHeight, footer, 1, GxEPD_BLACK);
}

// Draw a centred string of size `size` at pixel centre (cx, cy).
void drawCentered(int cx, int cy, const String& text, uint8_t size, uint16_t color) {
  const TextMetrics m = measureText(text, size);
  drawText(cx - m.w / 2, cy - m.h / 2, text, size, color);
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

String teamAbbrFor(const JsonObjectConst& s) {
  String abbr = str(s, "teamAbbr", "");
  if (abbr.length() == 0) abbr = str(s, "badge", "");
  if (abbr.length() == 0) abbr = fitText(str(s, "title", "?"), 3);
  abbr.toUpperCase();
  return abbr;
}

void renderOpponentMark(const String& abbr, int x, int y, int size) {
  display.drawRect(x, y, size, size, GxEPD_BLACK);
  String label = fitText(abbr.length() ? abbr : String("?"), 4);
  label.toUpperCase();
  drawCentered(x + size / 2, y + size / 2, label, 2, GxEPD_BLACK);
}

void renderTeamOrOpponentMark(
    const JsonObjectConst& s,
    const String& opponent,
    bool team,
    int x,
    int y,
    uint16_t accent) {
  if (team) {
    renderLogo(s, x, y, accent);
  } else {
    renderOpponentMark(opponent, x, y, LOGO_SIZE);
  }
}

struct ScorebugParts {
  bool ok;
  String opponent;
  String leftScore;
  String rightScore;
  bool leftTeam;
};

ScorebugParts parseLastScorebug(const String& raw) {
  String value = raw;
  value.trim();
  const int firstSpace = value.indexOf(' ');
  if (firstSpace < 0 || firstSpace + 1 >= value.length()) return {false, "", "-", "-", true};

  const int scoreEnd = value.indexOf(' ', firstSpace + 1);
  if (scoreEnd < 0) return {false, "", "-", "-", true};

  String score = value.substring(firstSpace + 1, scoreEnd);
  const int dash = score.indexOf('-');
  if (dash < 0) return {false, "", "-", "-", true};

  String us = score.substring(0, dash);
  String them = score.substring(dash + 1);
  us.trim();
  them.trim();

  String rest = value.substring(scoreEnd + 1);
  rest.trim();
  const bool watchedHome = rest.startsWith("vs ");
  const bool watchedAway = rest.startsWith("@ ");
  if (!watchedHome && !watchedAway) return {false, "", us, them, true};

  String opponent = rest.substring(watchedHome ? 3 : 2);
  opponent.trim();
  opponent.toUpperCase();
  return {
      true,
      opponent,
      watchedHome ? them : us,
      watchedHome ? us : them,
      !watchedHome,
  };
}

String scoreWithSpaces(const String& raw) {
  String score = raw;
  score.trim();
  const int dash = score.indexOf('-');
  if (dash < 0) return score.length() ? score : String("-");
  String left = score.substring(0, dash);
  String right = score.substring(dash + 1);
  left.trim();
  right.trim();
  return left + " - " + right;
}

void drawSummaryLines(const String& raw, int x, int y, int maxChars, int maxLines) {
  String remaining = raw;
  remaining.trim();
  if (remaining.length() == 0) return;

  for (int line = 0; line < maxLines && remaining.length() > 0; line++) {
    if ((int)remaining.length() <= maxChars) {
      drawText(x, y + line * 16, remaining, 1, GxEPD_BLACK);
      return;
    }

    int split = -1;
    for (int i = maxChars; i > maxChars / 2; i--) {
      if (remaining[i] == ' ') {
        split = i;
        break;
      }
    }
    if (split < 0) split = maxChars;

    String lineText = remaining.substring(0, split);
    lineText.trim();
    if (line == maxLines - 1) {
      drawText(x, y + line * 16, fitText(remaining, maxChars), 1, GxEPD_BLACK);
      return;
    }
    drawText(x, y + line * 16, lineText, 1, GxEPD_BLACK);
    remaining = remaining.substring(split);
    remaining.trim();
  }
}

int drawFinalScorebug(const JsonObjectConst& s, int x, int y, uint16_t accent) {
  ScorebugParts parts = parseLastScorebug(str(s, "last", "-"));
  if (!parts.ok) {
    parts.opponent = str(s, "scorebugOpponent", "");
    parts.opponent.toUpperCase();
  }
  if (parts.opponent.length() == 0) {
    parts.opponent = str(s, "scorebugOpponent", "");
    parts.opponent.toUpperCase();
  }

  const int gap = 9;
  const int logoY = y + 10;
  const int leftX = x + 12;
  const String score = parts.leftScore + " - " + parts.rightScore;
  const int scoreW = measureText(score, 3).w;
  const int scoreX = leftX + LOGO_SIZE + gap;
  const int rightX = scoreX + scoreW + gap;

  renderTeamOrOpponentMark(s, parts.opponent, parts.leftTeam, leftX, logoY, accent);
  drawText(scoreX, logoY + 8, score, 3, GxEPD_BLACK);
  renderTeamOrOpponentMark(s, parts.opponent, !parts.leftTeam, rightX, logoY, accent);
  return rightX + LOGO_SIZE;
}

void renderScorebugCard(const JsonObjectConst& s, int x, int y, int w, uint16_t accent) {
  const int scorebugEnd = drawFinalScorebug(s, x, y, accent);
  drawText(scorebugEnd + 12, y + 18, "FINAL", 1, GxEPD_BLACK);

  const char* summary = s["summary"] | "";
  String body = summary;
  if (body.length() == 0) {
    body = String(str(s, "record", "")) + " " + str(s, "standing", "");
    body.trim();
  }
  drawSummaryLines(body, x + 12, y + 72, 58, 2);

  if (!s["next"].isNull()) {
    renderNextGame(str(s, "next", "-"), x + w - 146, y + 18, GxEPD_BLACK);
  }
}

void renderLiveScorebugCard(const JsonObjectConst& s, int x, int y, int w, uint16_t accent) {
  JsonObjectConst live = s["live"].as<JsonObjectConst>();
  if (live.isNull()) return;

  String opponent = live["opponent"] | str(s, "scorebugOpponent", "");
  opponent.toUpperCase();
  const bool watchedHome = strcmp(live["homeAway"] | "home", "away") != 0;

  String rawScore = live["score"] | "-";
  String leftScore = rawScore;
  String rightScore = "";
  const int dash = rawScore.indexOf('-');
  if (dash >= 0) {
    String us = rawScore.substring(0, dash);
    String them = rawScore.substring(dash + 1);
    us.trim();
    them.trim();
    leftScore = watchedHome ? them : us;
    rightScore = watchedHome ? us : them;
  }

  const int gap = 9;
  const int logoY = y + 10;
  const int leftX = x + 12;
  const String score = rightScore.length() ? (leftScore + " - " + rightScore) : scoreWithSpaces(rawScore);
  const int scoreW = measureText(score, 3).w;
  const int scoreX = leftX + LOGO_SIZE + gap;
  const int rightX = scoreX + scoreW + gap;

  renderTeamOrOpponentMark(s, opponent, !watchedHome, leftX, logoY, accent);
  drawText(scoreX, logoY + 8, score, 3, GxEPD_BLACK);
  renderTeamOrOpponentMark(s, opponent, watchedHome, rightX, logoY, accent);

  const int bw = 52, bh = 20, bx = x + w - bw - 8, by = y + 8;
  display.fillRect(bx, by, bw, bh, GxEPD_RED);
  drawText(bx + 6, by + 3, "LIVE", 2, GxEPD_WHITE);

  drawText(x + 12, y + 70, fitText(live["detail"] | "Live", 34), 2, GxEPD_BLACK);
  JsonArrayConst topPlayers = live["topPlayers"].as<JsonArrayConst>();
  if (!topPlayers.isNull() && topPlayers.size() > 0) {
    drawText(x + 12, y + 98, fitText(topPlayers[0] | "", 44), 1, GxEPD_BLACK);
  }
}

struct NextGameParts {
  String when;
  String matchup;
};

String normalizeDateLabel(String value) {
  value.trim();
  if (value == "Yest." || value == "Yest") return "Yesterday";
  return value;
}

NextGameParts splitNextGame(String raw) {
  raw.trim();
  if (raw.length() == 0 || raw == "-") return {"-", ""};

  const int vsAt = raw.indexOf(" vs ");
  const int atAt = raw.indexOf(" @ ");
  int splitAt = -1;
  if (vsAt >= 0 && atAt >= 0) splitAt = min(vsAt, atAt);
  else if (vsAt >= 0) splitAt = vsAt;
  else if (atAt >= 0) splitAt = atAt;

  if (splitAt < 0) {
    return {normalizeDateLabel(raw), ""};
  }

  String when = raw.substring(0, splitAt);
  when.trim();
  if (when.length() == 0) when = "Today";
  String matchup = raw.substring(splitAt + 1);
  matchup.trim();
  return {normalizeDateLabel(when), matchup};
}

void drawCalendarIcon(int x, int y, uint16_t color) {
  display.drawRect(x, y + 2, 14, 12, color);
  display.fillRect(x + 1, y + 3, 13, 3, color);
  display.fillRect(x + 3, y, 2, 4, color);
  display.fillRect(x + 9, y, 2, 4, color);
  display.fillRect(x + 3, y + 8, 2, 2, color);
  display.fillRect(x + 7, y + 8, 2, 2, color);
}

void renderNextGame(const String& next, int x, int y, uint16_t color) {
  const NextGameParts parts = splitNextGame(next);
  const int textH = measureText(parts.when, 2).h;
  const int iconY = y + max(0, (textH - 14) / 2);
  drawCalendarIcon(x, iconY, color);
  drawText(x + 20, y, fitText(parts.when, 18), 2, color);
  if (parts.matchup.length() > 0) {
    drawText(x + 20, y + 20, fitText(parts.matchup, 24), 2, color);
  }
}

// Draw one team card at the given top-left corner with the given width.
void renderTeamCard(const JsonObjectConst& s, int x, int y, int w) {
  using namespace layout;
  const int h = kCardHeight;
  const uint16_t accent = colorFor(accentFromString(s["accent"] | "gray"));
  const int pad = 12;
  const bool live = strcmp(s["status"] | "active", "live") == 0;
  const String cardVariant = str(s, "cardVariant", "");

  display.drawRect(x, y, w, h, GxEPD_BLACK);

  if (live && !s["live"].isNull()) {
    renderLiveScorebugCard(s, x, y, w, accent);
    return;
  }

  if (cardVariant == "scorebug" || cardVariant == "recommended") {
    renderScorebugCard(s, x, y, w, accent);
    return;
  }

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
  renderNextGame(str(s, "next", "-"), textX, y + 90, GxEPD_BLACK);
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

bool isFormHeader(const char* value) {
  if (value == nullptr) return false;
  String h(value);
  h.toLowerCase();
  return h == "l5" || h == "l10" || h == "form";
}

bool isFormValue(const String& value) {
  const int n = value.length();
  if (n < 2 || n > 10) return false;
  for (int i = 0; i < n; i++) {
    const char c = value[i];
    if (c != 'W' && c != 'w' && c != 'L' && c != 'l') return false;
  }
  return true;
}

void drawFormDots(int x, int y, const String& form) {
  if (!isFormValue(form)) {
    drawText(x, y, form.length() ? form : String("-"), 2, GxEPD_BLACK);
    return;
  }

  const int r = 4;
  const int gap = 14;
  const int cy = y + 9;
  for (int i = 0; i < form.length() && i < 10; i++) {
    const char c = form[i];
    const uint16_t color = (c == 'W' || c == 'w') ? GxEPD_GREEN : GxEPD_RED;
    display.fillCircle(x + r + i * gap, cy, r, color);
  }
}

// Draw one standings table at the given top-left corner with the given width.
void renderStandings(const JsonObjectConst& s, int x, int y, int w, int h) {
  using namespace layout;
  const uint16_t accent = colorFor(accentFromString(s["accent"] | "gray"));

  drawText(x, y, fitText(str(s, "title", "Standings"), 22), 2, GxEPD_BLACK);
  display.drawFastHLine(x, y + 20, w, GxEPD_BLACK);

  JsonArrayConst columns = s["columns"].as<JsonArrayConst>();
  const bool hasFormColumn = isFormHeader(columns[4] | "");
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

    // Columns: rank, team, record, GB, optional L10/form dots. Fixed x offsets
    // keep rows aligned inside the 379px half-screen standings column.
    const char* rank = row[0] | "";
    const char* team = row[1] | "";
    const char* rec = row[2] | "";
    const char* gb = row[3] | "";
    drawText(x, ry, String(rank), 2, GxEPD_BLACK);
    drawText(x + 28, ry, String(team), 2, teamColor);
    drawText(x + 120, ry, String(rec), 2, GxEPD_BLACK);
    drawText(x + 194, ry, String(gb), 2, GxEPD_BLACK);
    if (hasFormColumn) {
      drawFormDots(x + 246, ry, String(row[4] | ""));
    }
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
  pinMode(EPD_RST, OUTPUT);
  pinMode(EPD_DC, OUTPUT);
  pinMode(EPD_CS, OUTPUT);
  hspi.begin(EPD_SCK, -1, EPD_MOSI, -1);
  display.epd2.selectSPI(hspi, SPISettings(2000000, MSBFIRST, SPI_MODE0));
  display.init(0);
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

void renderPreviewImage4bpp(const uint8_t* data, size_t length) {
  using namespace layout;
  constexpr size_t kExpectedLength = kWidth * kHeight / 2;
  if (data == nullptr || length != kExpectedLength) {
    renderError("Bad preview image");
    return;
  }

  display.setFullWindow();
  display.firstPage();
  do {
    for (int y = 0; y < kHeight; y++) {
      const size_t row = (size_t)y * (kWidth / 2);
      for (int bx = 0; bx < kWidth / 2; bx++) {
        const uint8_t packed = data[row + bx];
        const uint8_t left = packed >> 4;
        const uint8_t right = packed & 0x0F;
        display.drawPixel(bx * 2, y, left < 6 ? LOGO_PALETTE[left] : GxEPD_WHITE);
        display.drawPixel(bx * 2 + 1, y, right < 6 ? LOGO_PALETTE[right] : GxEPD_WHITE);
      }
    }
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
