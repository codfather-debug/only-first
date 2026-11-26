"""Thin client for ESPN's public (unofficial) scoreboard + summary endpoints."""
from __future__ import annotations

import json
import urllib.request

BASE = "https://site.api.espn.com/apis/site/v2/sports"

LEAGUES = {
    "nba": "basketball/nba",
    "nhl": "hockey/nhl",
    "nfl": "football/nfl",
}


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "only-first/0.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def scoreboard(league: str, date: str | None = None) -> list[dict]:
    """Games for a date (YYYYMMDD) or ESPN's default "current" slate.

    Returns [{id, name, state}] where state is 'pre' | 'in' | 'post'.
    """
    url = f"{BASE}/{LEAGUES[league]}/scoreboard"
    if date:
        url += f"?dates={date}"
    data = _get(url)
    games = []
    for e in data.get("events", []):
        games.append({
            "id": str(e["id"]),
            "name": e.get("shortName", e.get("name", "")),
            "state": e.get("status", {}).get("type", {}).get("state", "pre"),
        })
    return games


def summary(league: str, game_id: str) -> dict:
    return _get(f"{BASE}/{LEAGUES[league]}/summary?event={game_id}")
