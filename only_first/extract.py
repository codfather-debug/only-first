"""Find the "first" scoring event in an ESPN game summary.

NBA -> first points scored   (+ who won the opening tip)
NHL -> first goal            (shootout goals ignored)
NFL -> first touchdown       (offense, defense or special teams)

Besides who/how, each FirstScore carries what the website needs to draw it:
  scorer_id  ESPN athlete id (headshot: a.espncdn.com/i/headshots/<league>/players/full/<id>.png)
  spot       where it happened, normalized per league:
               NBA {"x","y"} feet; hoop at (25, 0), y = feet out from the hoop; or {"ft": true}
               NHL {"x","y"} feet; attacking net at x = 89, y across the ice (-42.5..42.5)
               NFL {"yards", "lane"} yards to the end zone at the snap; lane left|middle|right
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict, field
from typing import Optional

SCHEMA = 3  # bump when FirstScore gains fields, so stored games get re-read


@dataclass
class FirstScore:
    league: str
    game_id: str
    matchup: str          # "CHA @ CHI"
    team: str             # team abbreviation that scored
    scorer: str           # player name
    how: str              # short description of how it was scored
    period: str           # "1st Quarter", "1st", "Q2", ...
    clock: str            # game clock when it happened
    description: str      # full play text from the feed
    assists: list[str]
    scorer_id: str = ""
    spot: Optional[dict] = None
    pos: str = ""         # scorer's position: NBA G/F/C, NHL C/LW/RW/D, NFL RB/WR/TE/QB...
    v: int = SCHEMA

    def to_dict(self) -> dict:
        return asdict(self)

    def headline(self) -> str:
        return f"{self.league.upper()} {self.matchup}: {self.scorer} ({self.team})"

    def message(self) -> str:
        line = f"{self.how}, {self.clock} {self.period}"
        if self.assists:
            line += f". Assist: {', '.join(self.assists)}"
        return f"{line}\n{self.description}"


# ---------------------------------------------------------------- helpers

def _teams(summary: dict) -> dict[str, str]:
    """team id -> abbreviation"""
    out = {}
    comp = summary.get("header", {}).get("competitions", [{}])[0]
    for c in comp.get("competitors", []):
        t = c.get("team", {})
        out[str(t.get("id"))] = t.get("abbreviation", "?")
    return out


def _matchup(summary: dict) -> str:
    comp = summary.get("header", {}).get("competitions", [{}])[0]
    home = away = "?"
    for c in comp.get("competitors", []):
        abbr = c.get("team", {}).get("abbreviation", "?")
        if c.get("homeAway") == "home":
            home = abbr
        else:
            away = abbr
    return f"{away} @ {home}"


def _athletes(summary: dict) -> dict[str, str]:
    """athlete id -> display name, from the box score."""
    out = {}
    for team in summary.get("boxscore", {}).get("players", []):
        for group in team.get("statistics", []):
            for a in group.get("athletes", []):
                ath = a.get("athlete", {})
                if ath.get("id"):
                    out[str(ath["id"])] = ath.get("displayName", "")
    return out


def _game_id(summary: dict) -> str:
    return str(summary.get("header", {}).get("id", ""))


def _ordered(plays: list[dict]) -> list[dict]:
    def key(p):
        try:
            return int(p.get("sequenceNumber", 0))
        except (TypeError, ValueError):
            return 0
    return sorted(plays, key=key)


def _team_abbr(play: dict, teams: dict[str, str]) -> str:
    t = play.get("team") or {}
    return t.get("abbreviation") or teams.get(str(t.get("id")), "?")


def _coord(play: dict) -> Optional[tuple[float, float]]:
    """ESPN uses huge negative sentinels for 'no location'."""
    c = play.get("coordinate") or {}
    x, y = c.get("x"), c.get("y")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    if abs(x) > 1000 or abs(y) > 1000:
        return None
    return float(x), float(y)


# ---------------------------------------------------------------- NBA

NBA_HOOP_Y = 1.0  # ESPN's NBA y is measured from just behind the hoop


def _nba_how(play: dict) -> str:
    kind = (play.get("type") or {}).get("text", "Basket")
    pts = play.get("scoreValue") or 0
    text = play.get("text", "")
    if "free throw" in kind.lower() or "free throw" in text.lower():
        return "Free throw"
    dist = re.search(r"(\d+)-foot", text)
    label = kind
    if pts == 3 and "three" not in kind.lower():
        label = f"3-pointer ({kind.lower()})"
    if dist:
        label += f" from {dist.group(1)} ft"
    return label


def tipoff_nba(summary: dict) -> Optional[dict]:
    """Who won the opening jump ball: {"team": "HOU", "text": "..."}."""
    teams = _teams(summary)
    for p in _ordered(summary.get("plays") or [])[:6]:
        kind = (p.get("type") or {}).get("text", "").lower().replace(" ", "")
        if "jumpball" in kind:
            return {"team": _team_abbr(p, teams), "text": p.get("text", "")}
    return None


def first_nba(summary: dict) -> Optional[FirstScore]:
    teams, people = _teams(summary), _athletes(summary)
    for p in _ordered(summary.get("plays") or []):
        if not p.get("scoringPlay") or not (p.get("scoreValue") or 0):
            continue
        parts = p.get("participants") or []
        scorer_id = str(parts[0]["athlete"]["id"]) if parts else ""
        scorer = people.get(scorer_id) or re.split(r" makes ", p.get("text", ""))[0]
        assists = [people.get(str(x["athlete"]["id"]), "") for x in parts[1:]]
        how = _nba_how(p)
        xy = _coord(p)
        if how == "Free throw":
            spot = {"ft": True}
        elif xy:
            spot = {"x": xy[0], "y": round(xy[1] - NBA_HOOP_Y, 1)}
        else:
            spot = None
        return FirstScore(
            league="nba", game_id=_game_id(summary), matchup=_matchup(summary),
            team=_team_abbr(p, teams), scorer=scorer, how=how,
            period=(p.get("period") or {}).get("displayValue", ""),
            clock=(p.get("clock") or {}).get("displayValue", ""),
            description=p.get("text", ""), assists=[a for a in assists if a],
            scorer_id=scorer_id, spot=spot,
        )
    return None


# ---------------------------------------------------------------- NHL

_SHOT_TYPES = ["Wrist Shot", "Snap Shot", "Slap Shot", "Backhand", "Tip-In",
               "Deflected", "Wrap-around", "Wraparound", "Between Legs", "Poke",
               "Bat", "Cradle"]


def _is_shootout(p: dict) -> bool:
    kind = p.get("type") or {}
    blob = f"{kind.get('text', '')} {kind.get('abbreviation', '')}".lower()
    per = (p.get("period") or {}).get("displayValue", "").upper()
    return "shootout" in blob or per == "SO"


def first_nhl(summary: dict) -> Optional[FirstScore]:
    teams = _teams(summary)
    for p in _ordered(summary.get("plays") or []):
        if not p.get("scoringPlay") or _is_shootout(p):
            continue
        parts = p.get("participants") or []
        scorer_p = next((x for x in parts if x.get("type") == "scorer"), None)
        scorer = scorer_p["athlete"].get("displayName") if scorer_p else None
        scorer_id = str(scorer_p["athlete"].get("id", "")) if scorer_p else ""
        text = p.get("text", "")
        if not scorer:
            scorer = text.split(" Goal")[0]
        assists = [x["athlete"].get("displayName", "") for x in parts
                   if x.get("type") == "assister"]
        shot = next((s for s in _SHOT_TYPES if s.lower() in text.lower()), "Goal")
        strength = (p.get("strength") or {}).get("text", "")
        how = shot if not strength else f"{shot}, {strength.lower()}"
        if "empty net" in text.lower():
            how += ", empty net"
        xy = _coord(p)
        spot = None
        if xy:
            x, y = xy
            if x < 0:  # always draw attacking the same net
                x, y = -x, -y
            spot = {"x": x, "y": y}
        return FirstScore(
            league="nhl", game_id=_game_id(summary), matchup=_matchup(summary),
            team=_team_abbr(p, teams), scorer=scorer, how=how,
            period=(p.get("period") or {}).get("displayValue", ""),
            clock=(p.get("clock") or {}).get("displayValue", ""),
            description=text, assists=assists, scorer_id=scorer_id, spot=spot,
        )
    return None


# ---------------------------------------------------------------- NFL

_PERIODS = {1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4"}


def _nfl_scorer(text: str) -> str:
    m = re.match(r"^(.+?)\s+\d+\s+Yd", text) or re.match(r"^(.+?)\s+(?:Fumble|Blocked|Interception)", text)
    return m.group(1).strip() if m else text


def _nfl_lane(text: str) -> Optional[str]:
    t = text.lower()
    if "middle" in t:
        return "middle"
    if re.search(r"\bleft\b", t):
        return "left"
    if re.search(r"\bright\b", t):
        return "right"
    return None


def _nfl_play(summary: dict, play_id: str) -> dict:
    for d in (summary.get("drives") or {}).get("previous", []) or []:
        for p in d.get("plays", []) or []:
            if str(p.get("id")) == play_id:
                return p
    return {}


def first_nfl(summary: dict) -> Optional[FirstScore]:
    teams = _teams(summary)
    names = {v: k for k, v in _athletes(summary).items()}  # name -> id
    plays = summary.get("scoringPlays") or []
    for p in plays:
        stype = (p.get("scoringType") or {}).get("abbreviation", "")
        if stype != "TD":
            continue
        text = p.get("text", "")
        how = (p.get("type") or {}).get("text", "Touchdown")
        yards = re.search(r"(\d+)\s+Yd", text)
        n = int(yards.group(1)) if yards else None
        if n is not None:
            how += f", {n} yd" + ("" if n == 1 else "s")
        passer = re.search(r"pass from (.+?)(?:\s*\(|$)", text)
        if passer:
            how += f" from {passer.group(1).strip()}"
        detail = _nfl_play(summary, str(p.get("id")))
        lane = _nfl_lane(detail.get("text", ""))
        to_go = (detail.get("start") or {}).get("yardsToEndzone")
        spot = None
        if isinstance(to_go, (int, float)) and 0 <= to_go <= 100 and "return" not in how.lower():
            spot = {"yards": int(to_go), "lane": lane}
        elif n is not None:
            spot = {"yards": min(n, 100), "lane": lane}
        scorer = _nfl_scorer(text)
        num = (p.get("period") or {}).get("number")
        return FirstScore(
            league="nfl", game_id=_game_id(summary), matchup=_matchup(summary),
            team=_team_abbr(p, teams), scorer=scorer, how=how,
            period=_PERIODS.get(num, "OT" if num else ""),
            clock=(p.get("clock") or {}).get("displayValue", ""),
            description=text, assists=[], scorer_id=names.get(scorer, ""), spot=spot,
        )
    return None


EXTRACTORS = {"nba": first_nba, "nhl": first_nhl, "nfl": first_nfl}
