/**
 * Device-accurate browser preview. Instead of clean HTML/CSS, it draws the
 * dashboard onto an 800x480 canvas (1 canvas pixel = 1 panel pixel) and then
 * quantizes every pixel to the six Spectra inks. That strips anti-aliasing the
 * same way the ePaper panel does, so text shows its real hard-edged rendering
 * at the true resolution — not a smooth web font.
 *
 * Mirrors the fixed layout in firmware/src/render_dashboard.cpp.
 */
export const PREVIEW_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>InkScores preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&family=Handjet:wght@400;600;800&family=IBM+Plex+Sans:wght@400;600;700&family=Inter:wght@400;600;800&family=Instrument+Serif&family=Manrope:wght@400;600;800&family=Merriweather:wght@400;700;900&family=Pixelify+Sans:wght@400;600;700&family=Tiny5&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap" rel="stylesheet">
<style>
  /* Galmuri: legible pixel UI font (full Latin), loaded from CDN. */
  @font-face { font-family:'Galmuri11'; src:url('https://cdn.jsdelivr.net/npm/galmuri/dist/Galmuri11.woff2') format('woff2'); font-display:swap; }
  @font-face { font-family:'GalmuriMono9'; src:url('https://cdn.jsdelivr.net/npm/galmuri/dist/GalmuriMono9.woff2') format('woff2'); font-display:swap; }
  body { margin:0; background:#bdbbb4; font-family: Menlo, Consolas, monospace; color:#222; }
  .wrap { display:flex; flex-direction:column; align-items:center; gap:14px; padding:24px; }
  .bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; max-width:840px; }
  .bar a, .bar button, .bar select { font:inherit; text-decoration:none; color:#111; background:#fff; border:1px solid #888; border-radius:6px; padding:6px 10px; cursor:pointer; }
  .bar a.active { background:#111; color:#fff; }
  #screen { image-rendering:pixelated; box-shadow:0 0 0 1px #000, 0 8px 24px rgba(0,0,0,.25); }
  .meta { font-size:12px; color:#444; max-width:820px; text-align:center; }
</style>
</head>
<body>
<div class="wrap">
  <div class="bar" id="bar"></div>
  <canvas id="screen" width="800" height="480"></canvas>
  <div class="meta" id="meta"></div>
</div>
<script>
const MODES = [
  ["Real", ""],
  ["MLB", "mock=mlb"],
  ["Featured", "mock=featured"],
  ["Cubs idea", "mock=featured-cubs-idea"],
  ["MLB live", "mock=live"],
  ["NBA", "mock=nba"],
  ["NFL", "mock=nfl"],
  ["CFB", "mock=ncaaf"],
  ["CBB", "mock=ncaamb"],
  ["MLB+CFB", "mock=mlb-cfb"],
  ["MLB+NBA", "mock=mlb-nba"],
  ["NBA+CFB", "mock=nba-cfb"],
  ["NBA+CBB", "mock=nba-cbb"],
  ["Winter 3x", "mock=winter"],
  ["Madness", "mock=madness"],
  ["Mixed", "mock=mixed"],
  ["Offseason", "mock=offseason"],
  ["Error", "mock=error"],
  ["debug=all", "debug=all"],
];
const qs = new URLSearchParams(location.search).toString();

// The six Spectra inks (best-effort sRGB). Order matches logos.h / gen-logos.py.
// 0=black 1=white/paper 2=red 3=green 4=blue 5=yellow
const PAL = [[43,43,43],[232,231,225],[168,56,50],[61,122,82],[47,74,130],[204,169,58]];
const INK = { black:"rgb(43,43,43)", paper:"rgb(232,231,225)", red:"rgb(168,56,50)", green:"rgb(61,122,82)", blue:"rgb(47,74,130)", yellow:"rgb(204,169,58)" };
const accentInk = a => ({blue:INK.blue, red:INK.red, green:INK.green, orange:INK.red, gray:INK.black}[a] || INK.black);

// label -> { stack, family-to-preload (null = system font) }
const FONTS = {
  "IBM Plex Sans": ["'IBM Plex Sans',sans-serif", "'IBM Plex Sans'"],
  "SF Pro": ["-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif", null],
  "Manrope": ["'Manrope',sans-serif", "'Manrope'"],
  "Archivo": ["'Archivo',sans-serif", "'Archivo'"],
  "Satoshi": ["'Satoshi',sans-serif", "'Satoshi'"],
  "Inter": ["'Inter',sans-serif", "'Inter'"],
  "Instrument Serif": ["'Instrument Serif',Georgia,serif", "'Instrument Serif'"],
  "Merriweather": ["'Merriweather',Georgia,serif", "'Merriweather'"],
  "Pixelify Sans (pixel)": ["'Pixelify Sans',sans-serif", "'Pixelify Sans'"],
  "Galmuri11 (pixel)": ["'Galmuri11',monospace", "'Galmuri11'"],
  "GalmuriMono9 (pixel)": ["'GalmuriMono9',monospace", "'GalmuriMono9'"],
  "Handjet (pixel)": ["'Handjet',sans-serif", "'Handjet'"],
  "Tiny5 (pixel)": ["'Tiny5',sans-serif", "'Tiny5'"],
  "System Mono": ["Menlo,Consolas,monospace", null],
};

// Layout, device-aware. E1002 = 800x480 landscape, E1004 = 1200x1600 portrait.
const DEVICES = {
  e1002: { label: "E1002 800x480", W: 800, H: 480, M: 16, CARD_H: 116, FOOT_H: 16, maxCards: 2, zoom: 1 },
  e1004: { label: "E1004 1200x1600", W: 1200, H: 1600, M: 28, CARD_H: 132, FOOT_H: 22, maxCards: 6, zoom: 0.5 },
};
let deviceKey = "e1002";
try { deviceKey = localStorage.getItem("inkDevice") || "e1002"; } catch (e) {}
const GAP = 12;
// These are recomputed per render by setLayout().
let W = 800, H = 480, M = 16, CARD_H = 116, FOOT_H = 16, MAX_CARDS = 2;
let COL_W = 0, LEFT = 0, RIGHT = 0;

function setLayout() {
  const d = DEVICES[deviceKey] || DEVICES.e1002;
  W = d.W; H = d.H; M = d.M; CARD_H = d.CARD_H; FOOT_H = d.FOOT_H; MAX_CARDS = d.maxCards;
  COL_W = (W - 2 * M - GAP) / 2;
  LEFT = M; RIGHT = M + COL_W + GAP;
}
setLayout();

let LOGOS = { size:0, logos:{}, keyMap:{} };
let RASTER_LOGOS = {};
let lastDash = null;
let zoom = 1;
let fontLabel = "IBM Plex Sans";
try { fontLabel = localStorage.getItem("inkFont") || "IBM Plex Sans"; } catch (e) {}

function fam() { return (FONTS[fontLabel] || FONTS["IBM Plex Sans"])[0]; }
function cardH() {
  return (lastDash && lastDash.theme && Number(lastDash.theme.cardHeight)) || CARD_H;
}
function cardHFor(s) {
  const explicit = Number(s && s.cardHeight);
  return Number.isFinite(explicit) && explicit > 0 ? explicit : cardH();
}

async function getLogos() {
  try { LOGOS = await (await fetch("/preview/logos.json")).json(); } catch (e) {}
}
function logoNameFor(s) {
  const key = String(s.id || "").replace(/-card$/, "");
  const name = (LOGOS.keyMap && LOGOS.keyMap[key]) || key;
  return LOGOS.logos && LOGOS.logos[name] ? name : null;
}

function teamKeyFor(s) {
  return String(s.id || "").replace(/-card$/, "");
}

function teamAbbrFor(s) {
  const key = teamKeyFor(s);
  if (s.teamAbbr) return String(s.teamAbbr);
  if (key === "tigers") return "DET";
  if (key === "cubs") return "CHC";
  return String(s.badge || s.title || "?").toUpperCase().slice(0, 3);
}

function parseLastGame(last) {
  const t = String(last == null ? "" : last);
  const m = t.match(/^([WLT])?\s*(\d+)\s*-\s*(\d+)\s+(?:vs|@)\s+([A-Z0-9]+)\b/i);
  if (!m) return null;
  const result = (m[1] || "").toUpperCase();
  const a = m[2], b = m[3], opponent = m[4].toUpperCase();
  return {
    result,
    opponent,
    // Scorebug is opponent-left, watched-team-right. Loss strings are written
    // like "L 3-2 vs NYY"; win strings like "W 5-3 vs CLE".
    leftScore: result === "W" ? b : a,
    rightScore: result === "W" ? a : b,
  };
}

function dayStart(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function lastGamePlayedLabel(s) {
  const dateRaw = s.lastGame?.date || s.lastGameDate || "";
  if (!dateRaw) return "";
  const played = new Date(dateRaw);
  if (Number.isNaN(played.getTime())) return "";
  const baseRaw = (lastDash && lastDash.updatedAt) || "";
  const base = baseRaw ? new Date(baseRaw) : new Date();
  const diffDays = Math.round((dayStart(base).getTime() - dayStart(played).getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yest.";
  if (diffDays > 1 && diffDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(played);
  }
  return (played.getMonth() + 1) + "/" + played.getDate();
}

const TEAM_LOGO_FILES = {
  ARI: "/preview/team-logos/ari.png",
  ATL: "/preview/team-logos/atl.png",
  BAL: "/preview/team-logos/bal.png",
  BOS: "/preview/team-logos/bos.png",
  CHC: "/preview/team-logos/chc.png",
  CIN: "/preview/team-logos/cin.png",
  CLE: "/preview/team-logos/cle.png",
  COL: "/preview/team-logos/col.png",
  CWS: "/preview/team-logos/cws.png",
  DET: "/preview/team-logos/det.png",
  HOU: "/preview/team-logos/hou.png",
  KC: "/preview/team-logos/kc.png",
  LAA: "/preview/team-logos/laa.png",
  LAD: "/preview/team-logos/lad.png",
  MIA: "/preview/team-logos/mia.png",
  MIL: "/preview/team-logos/mil.png",
  MIN: "/preview/team-logos/min.png",
  NYM: "/preview/team-logos/nym.png",
  NYY: "/preview/team-logos/nyy.png",
  OAK: "/preview/team-logos/oak.png",
  ATH: "/preview/team-logos/oak.png",
  PHI: "/preview/team-logos/phi.png",
  PIT: "/preview/team-logos/pit.png",
  SD: "/preview/team-logos/sd.png",
  SEA: "/preview/team-logos/sea.png",
  SF: "/preview/team-logos/sf.png",
  STL: "/preview/team-logos/stl.png",
  TB: "/preview/team-logos/tb.png",
  TEX: "/preview/team-logos/tex.png",
  TOR: "/preview/team-logos/tor.png",
  WSH: "/preview/team-logos/wsh.png",
};

function logoVisualScaleFor(key) {
  const k = String(key || "").toLowerCase();
  return k === "det" || k === "tigers" ? 1.18 : 1;
}

function scorebugVariantFor(s) {
  const explicit = String(s.cardVariant || "");
  if (explicit === "scorebug" || explicit === "recommended") return explicit;
  return "";
}

function neededRasterLogoAbbrs(dash) {
  const out = new Set();
  for (const s of dash?.sections || []) {
    if (s.type !== "teamCard") continue;
    const teamAbbr = String(teamAbbrFor(s) || "").toUpperCase();
    if (TEAM_LOGO_FILES[teamAbbr]) out.add(teamAbbr);
    // Load every possible opponent mark: the scorebug/last-game opponent AND
    // the live opponent (a live card's last-game field is the previous game, so
    // its opponent differs from the team currently being played).
    const parsed = parseLastGame(s.last);
    for (const cand of [s.scorebugOpponent, parsed?.opponent, s.live?.opponent]) {
      const abbr = String(cand || "").toUpperCase();
      if (TEAM_LOGO_FILES[abbr]) out.add(abbr);
    }
  }
  return [...out];
}

function loadRasterLogo(abbr) {
  return new Promise((resolve) => {
    if (RASTER_LOGOS[abbr]) return resolve();
    const img = new Image();
    img.onload = () => { RASTER_LOGOS[abbr] = img; resolve(); };
    img.onerror = () => resolve();
    img.src = TEAM_LOGO_FILES[abbr];
  });
}

async function getRasterLogos(dash) {
  await Promise.all(neededRasterLogoAbbrs(dash).map(loadRasterLogo));
}

// ---- drawing ----------------------------------------------------------
function txt(ctx, str, x, y, px, weight, color) {
  ctx.fillStyle = color;
  ctx.font = weight + " " + px + "px " + fam();
  ctx.textBaseline = "top";
  ctx.fillText(str == null ? "—" : String(str), x, y);
}

function drawLogo(ctx, name, x, y) {
  const size = LOGOS.size, data = LOGOS.logos[name];
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < data.length; i++) {
    const c = PAL[data[i]] || PAL[1]; const o = i*4;
    img.data[o]=c[0]; img.data[o+1]=c[1]; img.data[o+2]=c[2]; img.data[o+3]=255;
  }
  ctx.putImageData(img, x, y);
}

function drawOpponentMark(ctx, abbr, x, y, size) {
  const img = RASTER_LOGOS[String(abbr || "").toUpperCase()];
  if (img) {
    drawRasterLogoImage(ctx, img, abbr, x, y, size);
    return;
  }

  ctx.strokeStyle = INK.black; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  ctx.fillStyle = INK.paper; ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = INK.black; ctx.font = "700 14px " + fam();
  ctx.fillText(String(abbr || "?").toUpperCase().slice(0, 3), x + size / 2, y + size / 2 + 1);
  ctx.textAlign = "left"; ctx.textBaseline = "top";
}

function drawRasterLogoImage(ctx, img, key, x, y, size) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  const scale = Math.min(size / img.width, size / img.height) * logoVisualScaleFor(key);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  ctx.drawImage(img, x + Math.round((size - w) / 2), y + Math.round((size - h) / 2), w, h);
  ctx.restore();
}

function drawTeamLogoMark(ctx, s, x, y, size) {
  const name = logoNameFor(s);
  const abbr = String(teamAbbrFor(s) || "").toUpperCase();
  const raster = RASTER_LOGOS[abbr];
  if (raster && logoVisualScaleFor(abbr) !== 1) {
    drawRasterLogoImage(ctx, raster, abbr, x, y, size);
    return;
  }
  if (name && size === (LOGOS.size || 44)) {
    drawLogo(ctx, name, x, y);
    return;
  }
  if (name) {
    const srcSize = LOGOS.size, data = LOGOS.logos[name];
    const tmp = document.createElement("canvas"); tmp.width = srcSize; tmp.height = srcSize;
    const tctx = tmp.getContext("2d");
    const img = tctx.createImageData(srcSize, srcSize);
    for (let i = 0; i < data.length; i++) {
      const c = PAL[data[i]] || PAL[1]; const o = i*4;
      img.data[o]=c[0]; img.data[o+1]=c[1]; img.data[o+2]=c[2]; img.data[o+3]=255;
    }
    tctx.putImageData(img, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, x, y, size, size);
    ctx.restore();
    return;
  }
  const cx = x + size / 2, cy = y + size / 2;
  ctx.fillStyle = accentInk(s.accent); ctx.beginPath(); ctx.arc(cx, cy, size / 2 - 1, 0, 7); ctx.fill();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = INK.paper; ctx.font = "700 18px " + fam();
  ctx.fillText((s.badge || (s.title||"?")[0]).toUpperCase(), cx, cy + 1);
  ctx.textAlign = "left"; ctx.textBaseline = "top";
}

function drawCard(ctx, s, x, y) {
  const h = cardHFor(s);
  ctx.strokeStyle = INK.black; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, COL_W - 1, h - 1);

  const tx = x + 12 + (LOGOS.size || 44) + 10;
  const scorebugVariant = scorebugVariantFor(s);

  if (String(s.cardVariant || "") === "standard" && s.summary && !(s.status === "live" && s.live)) {
    drawPlainSummaryCard(ctx, s, x, y);
    return;
  }

  if (String(s.cardVariant || "") === "team-result" && !(s.status === "live" && s.live)) {
    drawTeamResultSummaryCard(ctx, s, x, y);
    return;
  }

  if (s.status === "live" && s.live) {
    drawLiveCard(ctx, s, x, y);
    return;
  }

  // Highlighted team with a recap headline: name + next game beside it, result
  // score beneath the name, then the summary. Same box, same size.
  if (scorebugVariant && !(s.status === "live" && s.live)) {
    drawScorebugSummaryCard(ctx, s, x, y, scorebugVariant);
    return;
  }

  if (s.summary && !(s.status === "live" && s.live)) {
    drawSummaryCard(ctx, s, x, y, tx);
    return;
  }

  drawTeamLogoMark(ctx, s, x + 12, y + 12, LOGOS.size || 44);

  // Team name vertically centred against the logo.
  const logoMid = y + 12 + (LOGOS.size || 44) / 2;
  ctx.fillStyle = INK.black; ctx.font = "700 23px " + fam(); ctx.textBaseline = "middle";
  ctx.fillText(s.title == null ? "—" : String(s.title), tx, logoMid);
  ctx.textBaseline = "top";

  if (s.status === "live") {
    const padX = 7, bh = 19;
    ctx.font = "700 13px " + fam();
    const bw = Math.ceil(ctx.measureText("LIVE").width) + padX * 2;
    const bx = x + COL_W - bw - 8, by = y + 10;
    ctx.fillStyle = INK.red; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = INK.paper; ctx.textBaseline = "middle";
    ctx.fillText("LIVE", bx + padX, by + bh / 2 + 1);
    ctx.textBaseline = "top";
  }

  if (s.status === "live" && s.live) {
    drawLive(ctx, s, x, y);
    return;
  }

  // Last game: colour the W/L letter.
  drawResult(ctx, s.last, x + 12, y + 62, 16);

  // Next game: a calendar glyph instead of the word "Next:".
  drawCalendarText(ctx, s.next == null ? "—" : s.next, x + 12, y + 88, 16);
}

// "W 5-3 vs CLE" with the result letter coloured. Returns the total width.
function drawResult(ctx, last, x, y, size) {
  const t = String(last == null ? "—" : last);
  ctx.font = "600 " + size + "px " + fam();
  const w = ctx.measureText(t).width;
  if (t[0] === "W" || t[0] === "L") {
    txt(ctx, t[0], x, y, size, "600", t[0] === "W" ? INK.green : INK.red);
    ctx.font = "600 " + size + "px " + fam();
    const lw = ctx.measureText(t[0]).width;
    txt(ctx, t.slice(1), x + lw, y, size, "600", INK.black);
  } else {
    txt(ctx, t, x, y, size, "600", INK.black);
  }
  return w;
}

// Highlighted-team card body (logo already drawn): name, next game to the right,
// result beneath the name, then the wrapped recap summary.
function drawSummaryCard(ctx, s, x, y, tx) {
  const variant = scorebugVariantFor(s);
  if (variant === "scorebug" || variant === "recommended") {
    drawScorebugSummaryCard(ctx, s, x, y, variant);
    return;
  }

  // Team name vertically centred with the logo (as on a normal card).
  drawTeamLogoMark(ctx, s, x + 12, y + 12, LOGOS.size || 44);
  const logoMid = y + 12 + (LOGOS.size || 44) / 2;
  ctx.fillStyle = INK.black; ctx.font = "700 22px " + fam(); ctx.textBaseline = "middle";
  ctx.fillText(s.title == null ? "—" : String(s.title), tx, logoMid);
  ctx.textBaseline = "top";

  // Next scheduled game, right-aligned on the name row.
  const rightX = x + COL_W - 12;
  if (s.next != null) {
    const startX = rightX - calendarTextWidth(ctx, String(s.next), 14);
    drawCalendarText(ctx, String(s.next), startX, logoMid - 7, 14);
  }

  // Hot/cold reserved near the bottom (nudged up); summary fills above (down).
  const hasHC = (s.hot && s.hot.length) || (s.cold && s.cold.length);
  const h = cardHFor(s);
  const hcTop = y + h - 24;

  const startY = y + 58, lineH = 14;
  const sumBottom = (hasHC ? hcTop : y + h - 6) - 1;
  const maxLines = Math.max(2, Math.floor((sumBottom - startY) / lineH));

  // Result score inline before the summary (first line is narrowed for it).
  const resW = drawResult(ctx, s.last, x + 12, startY, 13);
  const lines = wrapText(ctx, s.summary, COL_W - 24, "400 13px " + fam(), COL_W - 24 - resW - 8);
  let sy = startY;
  clampLines(ctx, lines, maxLines, COL_W - 24, "400 13px " + fam()).forEach((ln, i) => {
    txt(ctx, ln, i === 0 ? x + 12 + resW + 8 : x + 12, sy, 13, "400", INK.black);
    sy += lineH;
  });

  // Hot (flame) and cold (snowflake) side by side on one row.
  if (hasHC) {
    drawHotCold(ctx, x, hcTop, s);
  }
}

function drawPlainSummaryCard(ctx, s, x, y) {
  const logoSize = LOGOS.size || 44;
  drawTeamLogoMark(ctx, s, x + 12, y + 12, logoSize);
  txt(ctx, s.title == null ? "—" : String(s.title), x + 12 + logoSize + 10, y + 22, 22, "700", INK.black);

  const hasHC = (s.hot && s.hot.length) || (s.cold && s.cold.length);
  const h = cardHFor(s);
  const hcTop = y + h - 24;
  const startY = y + 62, lineH = 14;
  const sumBottom = (hasHC ? hcTop : y + h - 6) - 1;
  const maxLines = Math.max(2, Math.floor((sumBottom - startY) / lineH));
  const lines = wrapText(ctx, s.summary, COL_W - 24, "400 13px " + fam());
  let sy = startY;
  clampLines(ctx, lines, maxLines, COL_W - 24, "400 13px " + fam()).forEach((ln) => {
    txt(ctx, ln, x + 12, sy, 13, "400", INK.black);
    sy += lineH;
  });

  if (hasHC) {
    drawHotCold(ctx, x, hcTop, s);
  }
}

function drawScorebug(ctx, s, x, y) {
  const parsed = parseLastGame(s.last);
  const opponent = String(s.scorebugOpponent || parsed?.opponent || "").toUpperCase();
  const leftScore = parsed?.leftScore || "—";
  const rightScore = parsed?.rightScore || "—";
  const logoSize = LOGOS.size || 44;
  const score = leftScore + " - " + rightScore;
  ctx.font = "800 24px " + fam();
  const scoreW = Math.ceil(ctx.measureText(score).width);
  const gap = 9;
  const sx = x + 12;
  const sy = y + 10;

  drawOpponentMark(ctx, opponent, sx, sy, logoSize);
  ctx.fillStyle = INK.black; ctx.textBaseline = "middle";
  ctx.fillText(score, sx + logoSize + gap, sy + logoSize / 2 + 1);
  ctx.textBaseline = "top";
  const teamX = sx + logoSize + gap + scoreW + gap;
  drawTeamLogoMark(ctx, s, teamX, sy, logoSize);
  return teamX + logoSize;
}

function drawFinalMeta(ctx, s, x, y) {
  const played = lastGamePlayedLabel(s);
  if (!played) return;
  txt(ctx, "FINAL", x, y + 18, 11, "700", INK.black);
  txt(ctx, played, x, y + 33, 11, "400", INK.black);
}

function drawScorebugSummaryCard(ctx, s, x, y, variant) {
  const scorebugEnd = drawScorebug(ctx, s, x, y);
  if (variant === "scorebug") drawFinalMeta(ctx, s, scorebugEnd + 12, y);

  const showHotCold = variant !== "recommended";
  const hasHC = showHotCold && ((s.hot && s.hot.length) || (s.cold && s.cold.length));
  const h = cardHFor(s);
  const hcTop = y + h - 24;
  const startY = y + (variant === "scorebug" ? 70 : 62), lineH = 14;
  const topNext = variant === "scorebug" && s.next != null;
  const nextReserve = !topNext && s.next != null ? 24 : 0;
  const sumBottom = (hasHC ? hcTop - 8 : y + h - 6 - nextReserve) - 1;
  const maxLines = variant === "recommended"
    ? 2
    : (hasHC ? 2 : Math.max(2, Math.floor((sumBottom - startY) / lineH)));
  const fallback = [s.record, s.standing].filter((v) => v && v !== "—").join(" · ");
  const body = s.summary || fallback;
  const lines = wrapText(ctx, body, COL_W - 24, "400 13px " + fam());
  let sy = startY;
  clampLines(ctx, lines, maxLines, COL_W - 24, "400 13px " + fam()).forEach((ln) => {
    txt(ctx, ln, x + 12, sy, 13, "400", INK.black);
    sy += lineH;
  });

  if (s.next != null && topNext) {
    const startX = x + COL_W - 12 - calendarTextWidth(ctx, String(s.next), 13);
    const nextY = y + 25;
    drawCalendarText(ctx, String(s.next), startX, nextY, 13);
  } else if (s.next != null) {
    const nextY = Math.min(sy + 10, y + h - 20);
    drawCalendarText(ctx, String(s.next), x + 12, nextY, 13);
  }

  if (hasHC) {
    drawHotCold(ctx, x, hcTop, s);
  }
}

function drawTeamResultSummaryCard(ctx, s, x, y) {
  const h = cardHFor(s);
  const logoSize = LOGOS.size || 44;
  const pad = 12;

  drawTeamLogoMark(ctx, s, x + pad, y + 12, logoSize);
  ctx.fillStyle = INK.black;
  ctx.font = "700 22px " + fam();
  ctx.textBaseline = "middle";
  ctx.fillText(s.title == null ? "—" : String(s.title), x + pad + logoSize + 10, y + 12 + logoSize / 2 + 1);
  ctx.textBaseline = "top";

  drawResult(ctx, s.last, x + pad, y + 64, 16);

  const fallback = [s.record, s.standing].filter((v) => v && v !== "—").join(" · ");
  const body = s.summary || fallback;
  const startY = y + 92, lineH = 14;
  const nextReserve = s.next != null ? 28 : 0;
  const bottom = y + h - 8 - nextReserve;
  const maxLines = Math.max(2, Math.floor((bottom - startY) / lineH));
  const lines = wrapText(ctx, body, COL_W - 24, "400 13px " + fam());
  let sy = startY;
  clampLines(ctx, lines, maxLines, COL_W - 24, "400 13px " + fam()).forEach((ln) => {
    txt(ctx, ln, x + pad, sy, 13, "400", INK.black);
    sy += lineH;
  });

  if (s.next != null) {
    const nextY = Math.min(sy + 12, y + h - 21);
    drawCalendarText(ctx, String(s.next), x + pad, nextY, 13);
  }
}

function drawLiveScorebug(ctx, s, x, y) {
  const L = s.live || {};
  const opponent = String(L.opponent || s.scorebugOpponent || "").toUpperCase();
  const logoSize = LOGOS.size || 44;
  const sx = x + 12;
  const sy = y + 10;
  let score = String(L.score == null ? "—" : L.score);
  const m = score.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) score = m[2] + " - " + m[1];
  else score = score.replace("-", " - ");

  ctx.font = "800 24px " + fam();
  const scoreW = Math.ceil(ctx.measureText(score).width);
  const gap = 9;
  drawOpponentMark(ctx, opponent, sx, sy, logoSize);
  ctx.fillStyle = INK.black; ctx.textBaseline = "middle";
  ctx.fillText(score, sx + logoSize + gap, sy + logoSize / 2 + 1);
  ctx.textBaseline = "top";
  drawTeamLogoMark(ctx, s, sx + logoSize + gap + scoreW + gap, sy, logoSize);
}

function drawLiveBadge(ctx, x, y) {
  const padX = 7, bh = 19;
  ctx.font = "700 13px " + fam();
  const bw = Math.ceil(ctx.measureText("LIVE").width) + padX * 2;
  ctx.fillStyle = INK.red; ctx.fillRect(x - bw, y, bw, bh);
  ctx.fillStyle = INK.paper; ctx.textBaseline = "middle";
  ctx.fillText("LIVE", x - bw + padX, y + bh / 2 + 1);
  ctx.textBaseline = "top";
}

function drawLiveCard(ctx, s, x, y) {
  const L = s.live || {};
  drawLiveScorebug(ctx, s, x, y);

  const basesSize = 38;
  const basesX = x + COL_W - 12 - basesSize - 58;
  const basesY = y + 13;
  drawBases(ctx, basesX, basesY, basesSize, L.onFirst, L.onSecond, L.onThird, INK.black);

  const detail = String(L.detail == null ? "" : L.detail);
  const m = detail.match(/^(top|bottom|bot)\s+(.*)$/i);
  let dx = basesX + basesSize + 10, rest = detail;
  if (m) {
    drawCaret(ctx, dx, y + 19, m[1].toLowerCase()[0] === "t", INK.black);
    dx += 13;
    rest = m[2];
  }
  txt(ctx, rest || "Live", dx, y + 14, 14, "700", INK.black);
  const outs = Number(L.outs);
  drawOuts(ctx, basesX + basesSize + 15, y + 38, Number.isFinite(outs) ? outs : 0, INK.black);

  const stats = (L.topPlayers || s.topPlayers || []).map((v) => String(v)).filter(Boolean);
  if (stats.length) {
    const font = "400 13px " + fam();
    txt(ctx, fitWidth(ctx, stats.slice(0, 4).join(" · "), COL_W - 24, font), x + 12, y + 68, 13, "400", INK.black);
  }

  drawWinProbabilityBar(ctx, s, x, y, L.winProbability);
}

function drawWinProbabilityBar(ctx, s, x, y, probability) {
  const pct = Number(probability);
  if (!Number.isFinite(pct)) return;

  const clamped = Math.max(0, Math.min(100, pct));
  const label = teamAbbrFor(s) + " " + Math.round(clamped) + "%";
  const labelX = x + 12;
  const rowY = y + 93;
  ctx.font = "600 11px " + fam();
  const labelW = Math.ceil(ctx.measureText(label).width);
  const barX = labelX + labelW + 9;
  const barY = rowY + 5;
  const barW = x + COL_W - 12 - barX;
  const fillW = Math.round(barW * clamped / 100);

  txt(ctx, label, labelX, rowY, 11, "600", INK.black);
  ctx.fillStyle = INK.black;
  ctx.fillRect(barX, barY + 1, barW, 1);
  ctx.fillStyle = accentInk(s.accent);
  ctx.fillRect(barX, barY, fillW, 3);
  ctx.fillRect(barX + Math.max(0, Math.min(barW - 2, fillW - 1)), barY - 2, 2, 7);
}

// Live MLB widget: score + inning + bases diamond + outs dots (no ball/strike
// count — too volatile for a slow-refresh panel).
function drawBases(ctx, x, y, size, b1, b2, b3, color) {
  const r = size * 0.18;    // base marker radius (all three identical)
  const bo = size * 0.24;   // spacing > radius, so there's a small gap between bases
  // No infield outline — just the three base squares forming the diamond.
  // Bias the centre down slightly since the home corner is omitted.
  const cx = x + size / 2, cy = y + size / 2 + size * 0.06;
  const diamond = (px, py, rr) => {
    ctx.beginPath(); ctx.moveTo(px, py-rr); ctx.lineTo(px+rr, py); ctx.lineTo(px, py+rr); ctx.lineTo(px-rr, py); ctx.closePath();
  };
  const base = (dx, dy, on) => {
    const px = cx + dx, py = cy + dy;
    diamond(px, py, r); ctx.fillStyle = color; ctx.fill();          // full-size ink
    // Empty base: border drawn inside, so it's the same outer size as a filled one.
    if (!on) { diamond(px, py, r - 2); ctx.fillStyle = INK.paper; ctx.fill(); }
  };
  base(0, -bo, b2);   // 2nd (top)
  base(bo, 0, b1);    // 1st (right)
  base(-bo, 0, b3);   // 3rd (left)
}

function drawOuts(ctx, x, y, outs, color) {
  for (let i = 0; i < 3; i++) {
    const ox = x + i*11;
    ctx.beginPath(); ctx.arc(ox, y, 3.5, 0, 7); ctx.fillStyle = color; ctx.fill();   // full-size ink
    // Empty out: paper centre, so the border sits inside (same outer size as filled).
    if (i >= (outs||0)) { ctx.beginPath(); ctx.arc(ox, y, 2, 0, 7); ctx.fillStyle = INK.paper; ctx.fill(); }
  }
}

// Red/paper checkerboard pattern — dithers to a "light red" the panel can show.
let _ditherRed = null;
function ditherRed(ctx) {
  if (_ditherRed) return _ditherRed;
  const p = document.createElement("canvas"); p.width = 2; p.height = 2;
  const c = p.getContext("2d");
  c.fillStyle = "rgb(232,231,225)"; c.fillRect(0, 0, 2, 2);
  c.fillStyle = "rgb(168,56,50)"; c.fillRect(0, 0, 1, 1); c.fillRect(1, 1, 1, 1);
  _ditherRed = ctx.createPattern(p, "repeat");
  return _ditherRed;
}

// Hot streak = small red flame.
function drawFlame(ctx, cx, cy, size, color) {
  const w = size, h = size;
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(cx - w * 0.08, cy - h * 0.58);
  ctx.bezierCurveTo(cx + w * 0.48, cy - h * 0.18, cx + w * 0.46, cy + h * 0.27, cx + w * 0.08, cy + h * 0.50);
  ctx.bezierCurveTo(cx - w * 0.30, cy + h * 0.44, cx - w * 0.50, cy + h * 0.12, cx - w * 0.34, cy - h * 0.20);
  ctx.bezierCurveTo(cx - w * 0.18, cy - h * 0.05, cx - w * 0.12, cy - h * 0.25, cx - w * 0.08, cy - h * 0.58);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = INK.yellow; ctx.beginPath();
  ctx.moveTo(cx + w * 0.04, cy - h * 0.12);
  ctx.bezierCurveTo(cx + w * 0.24, cy + h * 0.10, cx + w * 0.18, cy + h * 0.34, cx, cy + h * 0.42);
  ctx.bezierCurveTo(cx - w * 0.18, cy + h * 0.28, cx - w * 0.12, cy + h * 0.08, cx + w * 0.04, cy - h * 0.12);
  ctx.closePath(); ctx.fill();
}

// Cold streak = small blue snowflake.
function drawSnowflake(ctx, cx, cy, size, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.lineCap = "round";
  const r = size / 2, tick = size * 0.16;
  for (let a = 0; a < 3; a++) {
    const ang = a * Math.PI / 3, dx = Math.cos(ang) * r, dy = Math.sin(ang) * r;
    ctx.beginPath(); ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy); ctx.stroke();

    for (const side of [-1, 1]) {
      const ex = cx + dx * side, ey = cy + dy * side;
      const bx = cx + dx * side * 0.62, by = cy + dy * side * 0.62;
      const p1 = ang + Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(p1) * tick * side, by + Math.sin(p1) * tick * side); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(p1) * tick * side, by - Math.sin(p1) * tick * side); ctx.stroke();
    }
  }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, 1.4, 0, 7); ctx.fill();
  ctx.lineCap = "butt";
}

// Hot (flame) then cold (snowflake) on one row. The cold group follows the hot
// text by a consistent gap rather than starting at a fixed midpoint, so a short
// hot list hands its leftover width to the cold list.
function drawHotCold(ctx, x, hy, s) {
  const font = "400 12px " + fam();
  const hotTextX = x + 30;
  const rightEdge = x + COL_W - 12;
  const innerW = rightEdge - hotTextX;
  const SNOW_GAP = 16, SNOW_TEXT = 12;
  const minCold = Math.round(innerW * 0.34);
  const maxHotW = Math.max(24, innerW - minCold - SNOW_GAP - SNOW_TEXT);

  drawFlame(ctx, x + 18, hy + 8, 14, INK.red);
  const hotText = fitWidth(ctx, (s.hot || []).join(", ") || "—", maxHotW, font);
  txt(ctx, hotText, hotTextX, hy + 3, 12, "400", INK.black);

  ctx.font = font;
  const hotW = ctx.measureText(hotText).width;
  const snowX = hotTextX + hotW + SNOW_GAP;
  drawSnowflake(ctx, snowX, hy + 8, 14, INK.blue);
  const coldTextX = snowX + SNOW_TEXT;
  txt(ctx, fitWidth(ctx, (s.cold || []).join(", ") || "—", rightEdge - coldTextX, font), coldTextX, hy + 3, 12, "400", INK.black);
}

// Last-5 form dots: win = solid green, loss = dithered light-red. Oldest left.
function drawForm(ctx, x, y, form) {
  const cy = y + 8, r = 4, gap = 11;
  const s = String(form || "");
  if (!/^[WLwl]{2,5}$/.test(s)) {
    txt(ctx, s || "—", x, y, 15, "400", INK.black);
    return;
  }
  for (let i = 0; i < s.length && i < 5; i++) {
    const cx = x + r + i * gap;
    const win = s[i] === "W" || s[i] === "w";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
    ctx.fillStyle = win ? INK.green : ditherRed(ctx); ctx.fill();
  }
}

function drawLive(ctx, s, x, y) {
  const L = s.live || {};
  // Diamond vertically centred against the score+inning text block (~y+56..y+100).
  drawBases(ctx, x + 12, y + 62, 42, L.onFirst, L.onSecond, L.onThird, INK.black);
  const tx = x + 12 + 42 + 14;
  ctx.fillStyle = INK.black; ctx.font = "700 22px " + fam(); ctx.textBaseline = "top";
  const scoreStr = (L.score == null ? "—" : String(L.score)).replace("-", " - ");
  ctx.fillText(scoreStr, tx, y + 56);
  // Opponent next to the score, e.g. "vs MIN" (home) / "@ CLE" (away).
  const matchup = L.opponent ? (L.homeAway === "away" ? "@ " : "vs ") + L.opponent : "";
  if (matchup) {
    const sw = ctx.measureText(scoreStr).width;
    // Same styling as the last-game line (16px/600) so live "vs MIN" matches
    // past "vs CLE". Upcoming keeps its own (lighter) styling.
    txt(ctx, matchup, tx + sw + 12, y + 62, 16, "600", INK.black);
  }
  // Inning line: caret (up = top, down = bottom) + inning, then outs.
  const detail = String(L.detail == null ? "" : L.detail);
  const m = detail.match(/^(top|bottom|bot)\s+(.*)$/i);
  let dx = tx, rest = detail;
  if (m) {
    drawCaret(ctx, dx, y + 90, m[1].toLowerCase()[0] === "t", INK.black);
    dx += 13;
    rest = m[2];
  }
  txt(ctx, rest, dx, y + 86, 14, "400", INK.black);
  ctx.font = "400 14px " + fam();
  const rw = ctx.measureText(rest).width;
  drawOuts(ctx, dx + rw + 16, y + 93, L.outs, INK.black);
}

// Small filled triangle: up = top of the inning, down = bottom.
function drawCaret(ctx, x, y, up, color) {
  const w = 9, h = 7;
  ctx.fillStyle = color; ctx.beginPath();
  if (up) { ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w/2, y); }
  else { ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w/2, y + h); }
  ctx.closePath(); ctx.fill();
}

// Small calendar icon (~14px) drawn from primitives so it survives quantization.
function drawCalendar(ctx, x, y, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.fillRect(x + 3, y, 2, 3);          // left binding
  ctx.fillRect(x + 9, y, 2, 3);          // right binding
  ctx.strokeRect(x + 0.5, y + 2.5, 13, 11);
  ctx.fillRect(x + 1, y + 3, 13, 3);     // header bar
  ctx.fillRect(x + 3, y + 8, 2, 2);      // date dots
  ctx.fillRect(x + 7, y + 8, 2, 2);
}

function calendarTextWidth(ctx, text, size, weight = "400") {
  ctx.font = weight + " " + size + "px " + fam();
  return 20 + Math.ceil(ctx.measureText(String(text == null ? "—" : text)).width);
}

function drawCalendarText(ctx, text, x, textY, size, weight = "400", color = INK.black) {
  drawCalendar(ctx, x, textY - 2, color);
  txt(ctx, text == null ? "—" : text, x + 20, textY, size, weight, color);
}

function drawStandings(ctx, s, x, y) {
  // Column x-offsets by index: #, Team, Record, GB, form, playoff %.
  const COLX = [0, 24, 100, 174, 230, 316];
  txt(ctx, s.title, x, y, 16, "700", INK.black);
  // Stat-column headers inline with the division name (not over # or Team).
  const cols = s.columns || [];
  for (let k = 2; k < cols.length && k < COLX.length; k++) {
    txt(ctx, cols[k], x + 6 + COLX[k], y + 5, 11, "400", INK.black);
  }
  ctx.strokeStyle = INK.black; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + 21.5); ctx.lineTo(x + COL_W, y + 21.5); ctx.stroke();
  const hot = new Set(s.highlightRows || []);
  const acc = accentInk(s.accent);
  const rows = s.rows || []; const rowH = 20;
  let ry = y + 27;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const on = hot.has(i);
    // Subtle highlight: a thin accent tick at the row's left edge + the whole
    // row tinted in the accent ink (no loud fill).
    if (on) { ctx.fillStyle = acc; ctx.fillRect(x - 1, ry - 1, 3, rowH - 2); }
    const color = on ? acc : INK.black;
    for (let k = 0; k < r.length && k < COLX.length; k++) {
      const head = String(cols[k] || "").toLowerCase();
      if (head === "l5" || head === "l10" || head === "form") {
        drawForm(ctx, x + 6 + COLX[k], ry, r[k]);
      } else {
        txt(ctx, r[k] == null ? "" : r[k], x + 6 + COLX[k], ry, 15, on ? "700" : "400", color);
      }
    }
    ry += rowH;
  }
  // Solid divider after the division leaders (seeds 1-3).
  if (s.dividerAfter) {
    const dy = y + 27 + s.dividerAfter * rowH - 3;
    ctx.strokeStyle = INK.black; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, dy + 0.5); ctx.lineTo(x + COL_W, dy + 0.5); ctx.stroke();
  }
  // Playoff cutoff: dashed line after the in-the-spots teams.
  if (s.cutoffAfter) {
    const cyL = y + 27 + s.cutoffAfter * rowH - 3;
    ctx.strokeStyle = INK.black; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(x, cyL + 0.5); ctx.lineTo(x + COL_W, cyL + 0.5); ctx.stroke();
    ctx.setLineDash([]);
  }
  return ry - y;  // height used, so callers can stack below
}

// Compact division-leaders strip: a top rule, a label, then "GROUP TEAM" pairs.
function drawLeaders(ctx, s, x, y, w) {
  ctx.strokeStyle = INK.black; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + w, y + 0.5); ctx.stroke();
  txt(ctx, s.title || "Division Leaders", x, y + 8, 13, "700", INK.black);
  const items = s.items || [];
  let ix = x; const iy = y + 30;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    ctx.font = "400 14px " + fam();
    txt(ctx, it.group, ix, iy, 14, "400", INK.black);
    const gw = ctx.measureText(it.group + " ").width;
    txt(ctx, it.team, ix + gw, iy, 14, "700", INK.black);
    ctx.font = "700 14px " + fam();
    const tw = ctx.measureText(it.team).width;
    ix += gw + tw + 26;
  }
}

// Word-wrap text to a max pixel width. firstW (optional) narrows the first line
// to leave room for an inline prefix (e.g. the result score). Returns lines.
function wrapText(ctx, text, maxW, font, firstW) {
  ctx.font = font;
  const words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    const lim = (lines.length === 0 && firstW != null) ? firstW : maxW;
    if (cur && ctx.measureText(t).width > lim) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Clamp wrapped lines to maxLines. When text overflows, the last visible line
// is filled character-by-character up to the width — no word-boundary trim, no
// ellipsis — so it keeps going until the last character that fits.
function clampLines(ctx, lines, maxLines, maxW, font) {
  if (lines.length <= maxLines) return lines;
  const head = lines.slice(0, maxLines - 1);
  const rest = lines.slice(maxLines - 1).join(" ");
  ctx.font = font;
  let t = "";
  for (const ch of rest) {
    if (ctx.measureText(t + ch).width > maxW) break;
    t += ch;
  }
  head.push(t);
  return head;
}

// Truncate text with an ellipsis to fit a pixel width at the given font.
function fitWidth(ctx, text, maxW, font) {
  ctx.font = font;
  let t = String(text == null ? "" : text);
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

function drawMessage(ctx, s, x, y, w) {
  ctx.strokeStyle = INK.black; ctx.setLineDash([4,3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 96); ctx.setLineDash([]);
  txt(ctx, s.title, x + 12, y + 12, 20, "700", INK.black);
  txt(ctx, s.body, x + 12, y + 42, 15, "400", INK.black);
}

// Snap every pixel to the nearest ink — this is what removes anti-aliasing.
function quantize(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w || W, h || H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let best = 0, bd = 1e9;
    for (let p = 0; p < 6; p++) {
      const dr = d[i]-PAL[p][0], dg = d[i+1]-PAL[p][1], db = d[i+2]-PAL[p][2];
      const dist = dr*dr + dg*dg + db*db;
      if (dist < bd) { bd = dist; best = p; }
    }
    d[i]=PAL[best][0]; d[i+1]=PAL[best][1]; d[i+2]=PAL[best][2]; d[i+3]=255;
  }
  ctx.putImageData(img, 0, 0);
}

function render() {
  setLayout();
  const cv = document.getElementById("screen");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = INK.paper; ctx.fillRect(0, 0, W, H);
  if (!lastDash) { quantize(ctx); return; }

  const secs = lastDash.sections;
  const cards = secs.filter(s => s.type === "teamCard").slice(0, MAX_CARDS);
  const allStand = secs.filter(s => s.type === "standings");
  const sideBySideMock = lastDash.theme && lastDash.theme.layout === "team-comparison";
  const wildcards = allStand.filter(s => /wild|playoff/i.test(s.id || "") || /wild|playoff/i.test(s.title || ""));
  const divisions = allStand.filter(s => wildcards.indexOf(s) < 0).slice(0, 2);
  const leaders = secs.find(s => s.type === "leaders");
  const msg = secs.find(s => s.type === "message");

  // Cards in the 2-column grid (the featured team renders richer content inside
  // its own box — same size and position).
  const rowHeights = [];
  cards.forEach((c, i) => {
    const row = Math.floor(i / 2);
    rowHeights[row] = Math.max(rowHeights[row] || 0, cardHFor(c));
  });
  const cardRowTop = (row) => {
    let y = M;
    for (let r = 0; r < row; r++) y += (rowHeights[r] || cardH()) + GAP;
    return y;
  };
  cards.forEach((c, i) => {
    const x = (i % 2 === 0) ? LEFT : RIGHT;
    const y = cardRowTop(Math.floor(i / 2));
    drawCard(ctx, c, x, y);
  });
  const cardRows = Math.max(1, Math.ceil(cards.length / 2));
  const standTop = cardRowTop(cardRows);

  if (sideBySideMock) {
    const leftStandTop = M + (cards[0] ? cardHFor(cards[0]) : cardH()) + GAP;
    const rightStandTop = M + (cards[1] ? cardHFor(cards[1]) : cardH()) + GAP;
    let leftY = leftStandTop;
    allStand.filter((s) => /^al-/i.test(String(s.id || ""))).forEach((t, i) => {
      const h = drawStandings(ctx, t, LEFT, leftY);
      leftY += h + (i === 0 ? 8 : 0);
    });
    const rightTables = allStand.filter((s) => /^nl-/i.test(String(s.id || "")));
    if (rightTables.length) {
      let rightY = rightStandTop;
      rightTables.forEach((t, i) => {
        const h = drawStandings(ctx, t, RIGHT, rightY);
        rightY += h + (i === 0 ? 8 : 0);
      });
    } else {
      const right = allStand.find((s) => !/^al-/i.test(String(s.id || "")));
      if (right) drawStandings(ctx, right, RIGHT, rightStandTop);
    }
    ctx.textAlign = "right";
    txt(ctx, lastDash.footer || "", W - M, 2, 11, "400", INK.black);
    ctx.textAlign = "left";
    quantize(ctx, W, H);
    return;
  }

  // Divisions row, then (MLB only) wild-card row beneath, then leaders strip.
  let bottom = standTop;
  if (divisions.length) {
    let h = 0;
    divisions.forEach((t, i) => { h = Math.max(h, drawStandings(ctx, t, i === 0 ? LEFT : RIGHT, standTop)); });
    bottom = standTop + h;
  }
  if (wildcards.length) {
    const wcTop = bottom + 14;
    let h = 0;
    wildcards.forEach((t, i) => { h = Math.max(h, drawStandings(ctx, t, i === 0 ? LEFT : RIGHT, wcTop)); });
    bottom = wcTop + h;
  }
  if (leaders) drawLeaders(ctx, leaders, M, bottom + 14, W - 2 * M);

  if (msg && cards.length === 0) drawMessage(ctx, msg, M, M + 30, W - 2*M);
  else if (msg && divisions.length < 2 && !wildcards.length) drawMessage(ctx, msg, divisions.length === 0 ? LEFT : RIGHT, standTop, COL_W);

  // "Updated …" tucked into the top-right margin so the bottom is free for an
  // extra standings/playoff row.
  ctx.textAlign = "right";
  txt(ctx, lastDash.footer || "", W - M, 2, 11, "400", INK.black);
  ctx.textAlign = "left";

  quantize(ctx, W, H);
}

// ---- shell ------------------------------------------------------------
function setZoom(z) { setLayout(); zoom = z; const cv = document.getElementById("screen"); cv.style.width = (W*z)+"px"; cv.style.height = (H*z)+"px"; }

function setDevice(key) {
  deviceKey = key;
  try { localStorage.setItem("inkDevice", key); } catch (e) {}
  setLayout();
  setZoom((DEVICES[key] || DEVICES.e1002).zoom);
  buildBar();
  render();
}

async function applyFont(name) {
  fontLabel = name;
  try { localStorage.setItem("inkFont", name); } catch (e) {}
  const f = (FONTS[name] || [])[1];
  if (f) { try { await Promise.all([document.fonts.load("700 23px "+f), document.fonts.load("400 16px "+f)]); } catch (e) {} }
  render();
}

function buildBar() {
  const bar = document.getElementById("bar");
  const opts = Object.keys(FONTS).map(n => '<option' + (n===fontLabel?' selected':'') + '>' + n + '</option>').join("");
  const devOpts = Object.keys(DEVICES).map(k => '<option value="' + k + '"' + (k===deviceKey?' selected':'') + '>' + DEVICES[k].label + '</option>').join("");
  bar.innerHTML = MODES.map(([label, q]) =>
    '<a class="' + (q===qs?"active":"") + '" href="?' + q + '">' + label + '</a>'
  ).join("")
    + '<button onclick="load()">↻</button>'
    + '<select title="Device" onchange="setDevice(this.value)">' + devOpts + '</select>'
    + '<select title="Font" onchange="applyFont(this.value)">' + opts + '</select>'
    + '<button onclick="setZoom(0.5)">.5x</button>'
    + '<button onclick="setZoom(1)">1x</button>'
    + '<button onclick="setZoom(1.5)">1.5x</button>'
    + '<button onclick="setZoom(2)">2x</button>';
}

async function load() {
  setLayout();
  buildBar(); setZoom((DEVICES[deviceKey] || DEVICES.e1002).zoom);
  await getLogos();
  try {
    const res = await fetch("/api/dashboard.json" + (qs ? "?"+qs : ""), { cache:"no-store" });
    lastDash = await res.json();
  } catch (e) { lastDash = { version:0, refreshAfterSeconds:0, sections:[{type:"message",title:"Error",body:String(e)}] }; }
  await getRasterLogos(lastDash);
  await applyFont(fontLabel); // loads font then renders
  document.getElementById("meta").textContent =
    "Device-accurate: " + W + "x" + H + ", quantized to 6 inks, no anti-aliasing.  Font: " + fontLabel
    + "  |  v" + lastDash.version + " refresh " + lastDash.refreshAfterSeconds + "s";
}
load();
</script>
</body>
</html>`;
