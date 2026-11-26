"""Thin client for ESPN's public (unofficial) scoreboard, summary and teams endpoints."""
from __future__ import annotations

import json
import time
import urllib.request

BASE = "https://site.api.espn.com/apis/site/v2/sports"

LEAGUES = {
    "nba": "basketball/nba",
    "nhl": "hockey/nhl",
    "nfl": "football/nfl",
}


def _get(url: str, tries: int = 3) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "only-first/0.2"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def scoreboard(league: str, date: str | None = None) -> list[dict]:
    """Games for a date (YYYYMMDD, US Eastern) or ESPN's default "current" slate.

    Returns [{id, name, state, start, home, away}]; state is 'pre' | 'in' | 'post'.
    """
    url = f"{BASE}/{LEAGUES[league]}/scoreboard"
    if date:
        url += f"?dates={date}"
    data = _get(url)
    games = []
    for e in data.get("events", []):
        comp = (e.get("competitions") or [{}])[0]
        sides, scores = {}, {}
        for c in comp.get("competitors", []):
            sides[c.get("homeAway")] = c.get("team", {}).get("abbreviation", "?")
            try:
                scores[c.get("homeAway")] = int(c.get("score"))
            except (TypeError, ValueError):
                scores[c.get("homeAway")] = None
        games.append({
            "id": str(e["id"]),
            "name": e.get("shortName", e.get("name", "")),
            "state": e.get("status", {}).get("type", {}).get("state", "pre"),
            "start": e.get("date", ""),
            "home": sides.get("home", "?"),
            "away": sides.get("away", "?"),
            "home_score": scores.get("home"),
            "away_score": scores.get("away"),
            "season_type": (e.get("season") or {}).get("type", 2),  # 1 pre, 2 reg, 3 post
        })
    return games


def summary(league: str, game_id: str) -> dict:
    return _get(f"{BASE}/{LEAGUES[league]}/summary?event={game_id}")


# The teams endpoint and the scoreboard occasionally disagree; use scoreboard spelling.
TEAM_ALIASES = {"nhl": {"UTAH": "UTA"}}


def teams(league: str) -> list[dict]:
    data = _get(f"{BASE}/{LEAGUES[league]}/teams")
    out = []
    for t in data["sports"][0]["leagues"][0]["teams"]:
        t = t["team"]
        logo = next((l["href"] for l in t.get("logos", []) if "default" in l.get("rel", [])),
                    (t.get("logos") or [{}])[0].get("href", ""))
        abbr = TEAM_ALIASES.get(league, {}).get(t["abbreviation"], t["abbreviation"])
        out.append({"abbr": abbr, "name": t["displayName"],
                    "short": t.get("shortDisplayName", t["displayName"]),
                    "color": t.get("color", "888888"), "logo": logo})
    return sorted(out, key=lambda x: x["name"])
