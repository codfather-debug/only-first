/* Only First — share a first score as an image (1080x1350, made for feeds and stories). */
(() => {
  "use strict";
  const W = 1080, H = 1350;
  const WHAT = { nba: "First points", nhl: "First goal", nfl: "First touchdown" };
  const LNAME = { nba: "NBA", nhl: "NHL", nfl: "NFL" };
  const ONE = ["..#..", ".##..", "#.#..", "..#..", "..#..", "..#..", "#####"];

  const loadImg = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

  function svgImage(svg) {
    if (!svg) return Promise.resolve(null);
    return loadImg(URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
  }

  function mix(hex, other, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
    const ch = (n, s) => (n >> s) & 255;
    const m = (s) => Math.round(ch(a, s) * (1 - t) + ch(b, s) * t);
    return `rgb(${m(16)},${m(8)},${m(0)})`;
  }

  function fitText(ctx, text, maxW, size, weight, family) {
    let s = size;
    do { ctx.font = `${weight} ${s}px ${family}`; s -= 4; } while (ctx.measureText(text).width > maxW && s > 40);
    return s + 4;
  }

  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/); const lines = []; let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function brand(ctx, x, y, s) {
    ctx.fillStyle = "#12151c"; roundRect(ctx, x, y, s, s, s * 0.22); ctx.fill();
    const step = s * 0.11, r = s * 0.043, x0 = x + s / 2 - 2 * step, y0 = y + s / 2 - 3 * step;
    ONE.forEach((row, j) => [...row].forEach((c, i) => {
      ctx.beginPath(); ctx.arc(x0 + i * step, y0 + j * step, r, 0, Math.PI * 2);
      ctx.fillStyle = c === "#" ? "#ffc533" : "#262c37"; ctx.fill();
    }));
  }

  /** opts: {game, team, first, photo, logo, color, alt, ink, url, dateText} */
  async function render(o) {
    await document.fonts.ready;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const D = '"Barlow Condensed", "Arial Narrow", sans-serif', B = 'Barlow, Arial, sans-serif';
    const [photo, logo, map] = await Promise.all([loadImg(o.photo), loadImg(o.logo),
      svgImage(window.OFMaps.standalone(o.game.league, o.first, o.color, 620))]);

    // Team-color field
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H * 0.75);
    g.addColorStop(0, o.color); g.addColorStop(1, mix(o.color, "#000000", 0.42));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W, 0, 0, W, 0, W * 0.9);
    glow.addColorStop(0, "rgba(255,255,255,.28)"); glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    if (logo) { ctx.globalAlpha = 0.16; ctx.drawImage(logo, W - 620, -60, 700, 700); ctx.globalAlpha = 1; }

    // Header: brand + game
    brand(ctx, 64, 60, 76);
    ctx.fillStyle = o.ink; ctx.textBaseline = "middle";
    ctx.font = `700 56px ${D}`; ctx.fillText("Only First", 160, 100);
    ctx.textAlign = "right"; ctx.font = `600 34px ${B}`; ctx.globalAlpha = 0.9;
    ctx.fillText(`${LNAME[o.game.league]}  ${o.game.name}`, W - 64, 84);
    ctx.font = `500 28px ${B}`; ctx.fillText(o.dateText, W - 64, 124);
    ctx.globalAlpha = 1; ctx.textAlign = "left";

    // Kicker + name
    ctx.textBaseline = "alphabetic";
    ctx.font = `600 40px ${B}`; ctx.fillText(`${WHAT[o.game.league]}: ${o.team.name}`, 64, 250);
    const name = o.first.scorer.toUpperCase();
    const size = fitText(ctx, name, W - 128, 150, 700, D);

    // Headshot behind the name, poster style
    if (photo) {
      const ph = 560, pw = ph * (photo.width / photo.height);
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 40;
      ctx.drawImage(photo, W - pw - 20, 826 - ph, pw, ph); ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = o.ink === "#ffffff" ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.5)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 4;
    ctx.fillStyle = o.ink; ctx.font = `700 ${size}px ${D}`; ctx.fillText(name, 64, 250 + size * 0.98);
    ctx.restore();

    // Jersey-trim stripe + white panel
    const panelY = 840;
    ctx.fillStyle = o.alt; ctx.fillRect(0, panelY - 14, W, 14);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, panelY, W, H - panelY);

    // Panel: how / when / result on the left, map on the right
    const mapW = map ? 420 : 0;
    const leftW = W - 128 - (map ? mapW + 40 : 0);
    ctx.fillStyle = "#12151c"; ctx.font = `700 52px ${D}`;
    let y = panelY + 90;
    for (const line of wrap(ctx, o.first.how, leftW).slice(0, 3)) { ctx.fillText(line, 64, y); y += 56; }
    ctx.fillStyle = "#545b68"; ctx.font = `500 34px ${B}`;
    y += 10; ctx.fillText(`${o.periodText || o.first.period} ${o.first.clock}`, 64, y);
    if (o.first.assists?.length) { y += 48; for (const l of wrap(ctx, `Assist: ${o.first.assists.join(", ")}`, leftW).slice(0, 2)) { ctx.fillText(l, 64, y); y += 44; } y -= 44; }
    if (o.result) { y += 60; ctx.fillStyle = o.result.won ? "#0f7a2a" : "#545b68"; ctx.font = `700 36px ${B}`; ctx.fillText(o.result.text, 64, y); }
    if (map) {
      let mw = mapW, mh = mapW * (map.height / map.width);
      if (mh > 380) { mw = mw * (380 / mh); mh = 380; }
      const mx = W - 64 - mw;
      ctx.save(); roundRect(ctx, mx, panelY + 60, mw, mh, 18); ctx.clip();
      ctx.drawImage(map, mx, panelY + 60, mw, mh); ctx.restore();
    }

    // Footer
    ctx.fillStyle = "#7d8492"; ctx.font = `500 30px ${B}`;
    ctx.fillText(o.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), 64, H - 56);

    return new Promise((res) => c.toBlob(res, "image/png"));
  }

  async function share(o) {
    const blob = await render(o);
    const file = new File([blob], `only-first-${o.game.league}-${o.game.id}.png`, { type: "image/png" });
    const text = `${WHAT[o.game.league]}: ${o.first.scorer} (${o.first.team}), ${o.first.how}. ${o.game.name}`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Only First", text: `${text} ${o.link}` }); return "shared"; }
      catch (e) { if (e.name === "AbortError") return "cancelled"; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    try { await navigator.clipboard.writeText(o.link); } catch { /* not allowed; the download still worked */ }
    return "downloaded";
  }

  window.OFShare = { render, share };
})();
