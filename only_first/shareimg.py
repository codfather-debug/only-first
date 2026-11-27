"""The website's share image for a first score, made with headless Chrome.

Draws the image with the website's own code (docs/share.js, via only_first/render.html),
so Discord gets exactly what the Share button makes. GitHub's Ubuntu runners come with
Chrome; anywhere without it, image() returns None and alerts go out as text only.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import urllib.parse
from pathlib import Path

from .extract import FirstScore

ROOT = Path(__file__).resolve().parent
DOCS = ROOT.parent / "docs"
KICKER = {"nba": "First points", "nhl": "First goal", "nfl": "First touchdown"}
CHROMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]


def chrome() -> str | None:
    for c in [os.environ.get("ONLY_FIRST_CHROME", "")] + CHROMES:
        if c and (shutil.which(c) or Path(c).exists()):
            return shutil.which(c) or c
    return None


def _hex(c: str | None) -> str:
    c = (c or "").lower()
    return f"#{c}" if len(c) == 6 and all(ch in "0123456789abcdef" for ch in c) else "#666666"


def _ink(c: str) -> str:
    """Same rule as the website's inkOn: dark text on light team colors."""
    n = int(_hex(c)[1:], 16)
    def lin(v: float) -> float:
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    lum = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
    return "#12151c" if lum > 0.42 else "#ffffff"


def _period(league: str, p: str) -> str:
    """English period label, as the website shows it ("1st Quarter" -> "Q1")."""
    if league == "nba" and p.endswith(" Quarter") and p[:1].isdigit():
        return f"Q{p[0]}"
    return p


def options(fs: FirstScore, game: dict, note: str | None, site_url: str | None) -> dict:
    """The options docs/share.js draws from, built as the website's shareGame() builds them (in English)."""
    teams = json.loads((DOCS / "teams.json").read_text())
    tm = next((t for t in teams.get(fs.league, []) if t["abbr"] == fs.team),
              {"abbr": fs.team, "name": fs.team, "color": "666666", "alt": "aaaaaa", "logo": ""})
    day = game["date"]
    from datetime import date
    when = date(int(day[:4]), int(day[4:6]), int(day[6:8]))
    photo = (f"https://a.espncdn.com/combiner/i?img=/i/headshots/{fs.league}/players/full/"
             f"{urllib.parse.quote(fs.scorer_id)}.png&w=700&h=510&scale=crop&cquality=60") if fs.scorer_id else ""
    assists = ""
    if fs.assists:
        assists = ("Assists: " if fs.league == "nhl" and len(fs.assists) > 1 else "Assist: ") + ", ".join(fs.assists)
    return {
        "game": {"league": fs.league, "id": fs.game_id, "name": game.get("name") or fs.matchup},
        "team": {"name": tm["name"]}, "first": fs.to_dict(),
        "periodText": _period(fs.league, fs.period), "howText": fs.how, "assistText": assists,
        "kicker": f"{KICKER[fs.league]}: {tm['name']}", "leagueName": fs.league.upper(),
        "seasonText": note or "", "photo": photo, "logo": tm.get("logo", ""),
        "color": _hex(tm.get("color")), "alt": _hex(tm.get("alt")), "ink": _ink(tm.get("color")),
        "url": site_url or "", "link": site_url or "",
        "dateText": f"{when:%a}, {when:%B} {when.day}", "result": None,  # alerts go out mid-game
        # As data, since Chrome won't load a local file into a cross-origin image.
        "brandLogo": "data:image/png;base64," + base64.b64encode((DOCS / "logo.png").read_bytes()).decode(),
    }


def page(opts: dict) -> str:
    """render.html with the options inlined and the website's scripts linked by absolute path."""
    html = (ROOT / "render.html").read_text().replace('src="../docs/', f'src="{DOCS.as_uri()}/')
    data = json.dumps(opts).replace("</", "<\\/")
    return html.replace("<body>", f"<body>\n<script>window.OF_OPTS = {data};</script>", 1)


def image(fs: FirstScore, game: dict, note: str | None = None, site_url: str | None = None,
          timeout: int = 60) -> bytes | None:
    """PNG bytes of the share image, or None (with the reason printed) if Chrome is missing or drawing fails."""
    exe = chrome()
    if not exe:
        print("   [warn] share image: no Chrome found", flush=True)
        return None
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / "share.html"
        html.write_text(page(options(fs, game, note, site_url)))
        out = Path(tmp) / "share.png"
        cmd = [exe, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
               "--force-device-scale-factor=1", "--window-size=1080,1350", "--virtual-time-budget=15000",
               "--allow-file-access-from-files", f"--user-data-dir={tmp}/profile", f"--screenshot={out}", html.as_uri()]
        try:
            run = subprocess.run(cmd, capture_output=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as e:
            print(f"   [warn] share image: Chrome failed to run: {e}", flush=True)
            return None
        data = out.read_bytes() if out.exists() else b""
    if data.startswith(b"\x89PNG") and len(data) > 20000:
        return data
    tail = run.stderr.decode(errors="replace").strip().splitlines()[-3:]
    print(f"   [warn] share image: no usable screenshot ({len(data)} bytes, exit {run.returncode}): {' | '.join(tail)}", flush=True)
    return None


def main(argv: list[str]) -> int:
    """python -m only_first.shareimg [out.png]: draw the newest stored first score (a check that
    Chrome works where the tracker runs). Exits 1 if no image comes out."""
    from .__main__ import load_store, season_note
    store = load_store()
    rec = max((g for g in store["games"].values() if g.get("first")), key=lambda g: g.get("start", ""))
    fs = FirstScore(**{k: v for k, v in rec["first"].items() if k in FirstScore.__dataclass_fields__})
    png = image(fs, rec, season_note(store, fs.league, rec["date"], rec["first"]), None)
    out = Path(argv[0] if argv else "share.png")
    if not png:
        print(f"no image for {fs.headline()}")
        return 1
    out.write_bytes(png)
    print(f"{out}: {len(png)} bytes, {fs.headline()}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main(sys.argv[1:]))
