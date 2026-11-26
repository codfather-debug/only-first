/* Only First — small SVG diagrams of where a first score happened.
   Coordinates come from only_first/extract.py ("spot"). */
(() => {
  "use strict";
  const LINE = 'fill="none" stroke="currentColor" stroke-width=".45" vector-effect="non-scaling-stroke"';

  // ------------------------------------------------------------ NBA half court
  // Feet. Hoop at (25, 0); y grows away from the basket. Baseline at y = -5.25.
  const NBA_VIEW = "-1 -6.25 52 37";
  function courtLines() {
    return `<g class="lines" ${LINE}>
      <rect x="0" y="-5.25" width="50" height="40"/>
      <rect x="17" y="-5.25" width="16" height="19"/>
      <circle cx="25" cy="13.75" r="6"/>
      <path d="M3,-5.25 L3,8.95 A23.75,23.75 0 0 0 47,8.95 L47,-5.25"/>
      <path d="M21,0 A4,4 0 0 0 29,0"/>
      <line x1="22" y1="-1.25" x2="28" y2="-1.25"/>
      <circle cx="25" cy="0" r=".75"/>
    </g>`;
  }
  function nbaPoint(spot) {
    if (!spot) return null;
    if (spot.ft) return { x: 25, y: 13.75, ft: true };
    return { x: Math.max(0.5, Math.min(49.5, spot.x)), y: Math.max(-4.5, Math.min(30, spot.y)) };
  }

  // ------------------------------------------------------------ NHL offensive zone
  // Feet. Goal line 89 ft from center, boards at 100, blue line at 25.
  // Drawn with the net at the top: svgX = y, svgY = 100 - x.
  const NHL_VIEW = "-43.5 -1 87 77";
  function rinkLines() {
    return `<g class="lines" ${LINE}>
      <path d="M-42.5,75 L-42.5,28 A28,28 0 0 1 -14.5,0 L14.5,0 A28,28 0 0 1 42.5,28 L42.5,75 Z"/>
      <line x1="-36.7" y1="11" x2="36.7" y2="11" class="red"/>
      <path d="M-6,11 A6,6 0 0 0 6,11" class="crease"/>
      <rect x="-3" y="7" width="6" height="4"/>
      <circle cx="-22" cy="31" r="15" class="red"/><circle cx="22" cy="31" r="15" class="red"/>
      <circle cx="-22" cy="31" r=".9" class="red dot"/><circle cx="22" cy="31" r=".9" class="red dot"/>
      <line x1="-42.5" y1="75" x2="42.5" y2="75" class="blue"/>
    </g>`;
  }
  function nhlPoint(spot) {
    if (!spot) return null;
    return { x: Math.max(-41, Math.min(41, spot.y)), y: Math.max(1, Math.min(74, 100 - spot.x)) };
  }

  // ------------------------------------------------------------ NFL field
  // Yards. Offense drives right; their end zone is x 110–120. Field is 53.3 wide.
  const NFL_VIEW = "0 0 120 53.3";
  const LANE_Y = { left: 12, middle: 26.65, right: 41.3 };
  function fieldLines(endColor) {
    let yl = "";
    for (let x = 20; x <= 100; x += 10) yl += `<line x1="${x}" y1="0" x2="${x}" y2="53.3"/>`;
    return `<rect x="110" y="0" width="10" height="53.3" fill="${endColor}" opacity=".85"/>
      <g class="lines" ${LINE}>
        <rect x="0" y="0" width="120" height="53.3"/>
        <line x1="10" y1="0" x2="10" y2="53.3"/><line x1="110" y1="0" x2="110" y2="53.3"/>
        ${yl}
        <line x1="60" y1="0" x2="60" y2="53.3" class="mid"/>
      </g>`;
  }
  function nflPath(spot, how, jitter = 0) {
    if (!spot) return null;
    const sx = 110 - Math.max(0, Math.min(100, spot.yards ?? 0));
    const ly = (LANE_Y[spot.lane] ?? LANE_Y.middle) + jitter;
    const pass = /pass/i.test(how || "");
    const d = pass
      ? `M${sx},26.65 Q${(sx + 112) / 2},${ly < 26 ? ly - 14 : ly + 14} 113,${ly}`
      : `M${sx},${26.65 + jitter * 0.4} L113,${ly}`;
    return { d, sx, ly, pass };
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------------------------------------ public: one score (card)
  function mini(league, first, color) {
    const spot = first.spot;
    if (league === "nba") {
      const p = nbaPoint(spot);
      if (!p) return "";
      const mark = p.ft
        ? `<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="${color}" class="mark"/><text x="${p.x}" y="${p.y + 6.6}" class="ft">FT</text>`
        : `<circle cx="${p.x}" cy="${p.y}" r="2.1" fill="${color}" class="mark"/>`;
      return `<svg class="map court" viewBox="${NBA_VIEW}" role="img" aria-label="Shot location on the court">${courtLines()}${mark}</svg>`;
    }
    if (league === "nhl") {
      const p = nhlPoint(spot);
      if (!p) return "";
      return `<svg class="map rink" viewBox="${NHL_VIEW}" role="img" aria-label="Shot location in the offensive zone">${rinkLines()}
        <line x1="${p.x}" y1="${p.y}" x2="0" y2="9" class="shotline" stroke="${color}"/>
        <circle cx="${p.x}" cy="${p.y}" r="3.2" fill="${color}" class="mark"/></svg>`;
    }
    const path = nflPath(spot, first.how);
    if (!path) return "";
    return `<svg class="map field" viewBox="${NFL_VIEW}" role="img" aria-label="Touchdown from ${spot.yards} yards out">${fieldLines(color)}
      <path d="${path.d}" class="play ${path.pass ? "pass" : "run"}" stroke="${color}"/>
      <circle cx="${path.sx}" cy="26.65" r="2.6" class="ball"/></svg>`;
  }

  // ------------------------------------------------------------ public: season chart
  // games: [{first, ...}]; tip(g) -> tooltip text
  function season(league, games, color, tip) {
    if (league === "nba") {
      const marks = games.map((g) => {
        const p = nbaPoint(g.first.spot);
        if (!p) return "";
        const jx = p.ft ? (Math.random() - 0.5) * 10 : 0, jy = p.ft ? (Math.random() - 0.5) * 3 : 0;
        return `<circle cx="${(p.x + jx).toFixed(2)}" cy="${(p.y + jy).toFixed(2)}" r=".8" fill="${color}" class="dotm" data-tip="${esc(tip(g))}"/>`;
      }).join("");
      return `<svg class="bigmap court" viewBox="${NBA_VIEW}" role="img" aria-label="Where first points were scored">${courtLines()}<g class="marks">${marks}</g></svg>`;
    }
    if (league === "nhl") {
      const marks = games.map((g) => {
        const p = nhlPoint(g.first.spot);
        return p ? `<circle cx="${p.x}" cy="${p.y}" r="1.25" fill="${color}" class="dotm" data-tip="${esc(tip(g))}"/>` : "";
      }).join("");
      return `<svg class="bigmap rink" viewBox="${NHL_VIEW}" role="img" aria-label="Where first goals were scored">${rinkLines()}<g class="marks">${marks}</g></svg>`;
    }
    const marks = games.map((g, i) => {
      const jitter = ((i * 7) % 11 - 5) * 0.9;
      const p = nflPath(g.first.spot, g.first.how, jitter);
      const sy = p && p.pass ? 26.65 : 26.65 + jitter * 0.4;
      return p ? `<g class="tdg" data-tip="${esc(tip(g))}"><path d="${p.d}" class="play faint ${p.pass ? "pass" : "run"}" stroke="${color}"/>
        <circle cx="${p.sx}" cy="${sy.toFixed(2)}" r=".95" fill="${color}" class="dotm"/></g>` : "";
    }).join("");
    return `<svg class="bigmap field" viewBox="${NFL_VIEW}" role="img" aria-label="Where first touchdowns started">${fieldLines("var(--surface-2)")}<g class="marks">${marks}</g></svg>`;
  }

  // ------------------------------------------------------------ public: self-contained SVG (for share images)
  // Page CSS doesn't reach an SVG drawn into a canvas, so styles are embedded.
  const STANDALONE_CSS = `
    .lines{color:#8d939e}.lines .red{stroke:#d23a3a}.lines .blue{stroke:#2f6bd6;stroke-width:1.4}
    .lines .dot{fill:#d23a3a}.lines .crease{fill:rgba(80,150,230,.25)}.lines .mid{stroke-width:.9}
    .mark{stroke:#fff;stroke-width:.9}.shotline{stroke-width:1;stroke-dasharray:2 2;opacity:.7}
    .play{fill:none;stroke-width:2.2;stroke-linecap:round}.play.pass{stroke-dasharray:3 2.5}
    .ball{fill:#fff;stroke:rgba(0,0,0,.4);stroke-width:.5}.ft{font:700 4.4px Arial,sans-serif;fill:#545b68;text-anchor:middle}`;
  function standalone(league, first, color, px = 600) {
    const svg = mini(league, first, color);
    if (!svg) return "";
    const view = { nba: NBA_VIEW, nhl: NHL_VIEW, nfl: NFL_VIEW }[league].split(" ").map(Number);
    const bg = { nba: "#f6f3ec", nhl: "#f4f8fb", nfl: "#2f7d46" }[league];
    const w = px, h = Math.round((px * view[3]) / view[2]);
    let inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    if (league === "nfl") inner = inner.replace(/class="lines"/, 'class="lines" style="color:rgba(255,255,255,.6)"').replace(/class="play /, 'style="stroke:#fff" class="play ');
    inner = inner.replace(/vector-effect="non-scaling-stroke"/g, "");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.join(" ")}" width="${w}" height="${h}">
      <style>${STANDALONE_CSS}</style>
      <rect x="${view[0]}" y="${view[1]}" width="${view[2]}" height="${view[3]}" fill="${bg}"/>${inner}</svg>`;
  }

  window.OFMaps = { mini, season, standalone };
})();
