/* Only First brand mark: a scoreboard-bulb "1" on a 5x7 grid. */
(() => {
  "use strict";
  const ONE = ["..#..", ".##..", "#.#..", "..#..", "..#..", "..#..", "#####"];
  function svg(size, { rounded = true, pad = 0 } = {}) {
    const step = 11 * (1 - pad), r = 4.3 * (1 - pad);
    const x0 = 50 - 2 * step, y0 = 50 - 3 * step;
    let lit = "", off = "";
    ONE.forEach((row, j) => [...row].forEach((c, i) => {
      const dot = `<circle cx="${(x0 + i * step).toFixed(2)}" cy="${(y0 + j * step).toFixed(2)}" r="${r.toFixed(2)}"/>`;
      if (c === "#") lit += dot; else off += dot;
    }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter></defs>
<rect width="100" height="100" rx="${rounded ? 22 : 0}" fill="#12151c"/>
<g fill="#262c37">${off}</g>
<g fill="#ffb000" filter="url(#glow)" opacity=".75">${lit}</g>
<g fill="#ffc533">${lit}</g>
</svg>`;
  }
  if (typeof window !== "undefined") window.OFBrand = { mark: (size) => svg(size), svg };
  if (typeof module !== "undefined") module.exports = { svg };
})();
