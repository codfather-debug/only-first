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


def image(fs: FirstScore, game: dict, note: str | None = None, site_url: str | None = None,
          timeout: int = 60) -> bytes | None:
    """PNG bytes of the share image, or None if Chrome is missing or drawing fails."""
    exe = chrome()
    if not exe:
        return None
    url = (ROOT / "render.html").as_uri() + "#" + urllib.parse.quote(json.dumps(options(fs, game, note, site_url)))
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "share.png"
        cmd = [exe, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
               "--force-device-scale-factor=1", "--window-size=1080,1350", "--virtual-time-budget=15000",
               f"--user-data-dir={tmp}/profile", f"--screenshot={out}", url]
        try:
            subprocess.run(cmd, capture_output=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            return None
        data = out.read_bytes() if out.exists() else b""
    return data if data.startswith(b"\x89PNG") and len(data) > 20000 else None
