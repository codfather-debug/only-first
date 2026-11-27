"""Only First: who scored first, and how.

  python -m only_first today   [--leagues nba,nhl,nfl] [--date YYYYMMDD] [--json]
  python -m only_first update  [--for-minutes N]   # refresh data + send alerts (used by GitHub Actions)
  python -m only_first watch                       # run `update` forever on your own machine
  python -m only_first backfill --since YYYYMMDD   # fill in past games, no alerts
  python -m only_first teams                       # refresh docs/teams.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from . import espn, notify, shareimg
from .extract import EXTRACTORS, SCHEMA, tipoff_nba

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
CONFIG = DOCS / "config.json"
TEAMS = DOCS / "teams.json"
# Score data lives on its own `data` branch in production (see README); locally it's docs/data.
DATA = Path(os.environ.get("ONLY_FIRST_DATA_DIR") or DOCS / "data")
FIRSTS = DATA / "firsts.json"
ET = ZoneInfo("America/New_York")
POLL_SECONDS = 30
IDLE_SECONDS = 120  # with --stay, how often to look when no game is live or about to start


def config() -> dict:
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else {}


def ntfy_prefix() -> str | None:
    env = os.environ.get("ONLY_FIRST_NTFY_PREFIX")
    if env is not None:
        return env or None          # set to "" to turn push off
    return config().get("ntfy_prefix") or None


ENRICH_PER_PASS = 150  # older stored games re-read per pass to pick up new fields


def find_first(league: str, game_id: str):
    return EXTRACTORS[league](espn.summary(league, game_id))


def read_game(league: str, game_id: str) -> tuple:
    """(FirstScore or None, extras dict) from one summary fetch."""
    summary = espn.summary(league, game_id)
    extras = {}
    if league == "nba":
        extras["tip"] = tipoff_nba(summary)
    fs = EXTRACTORS[league](summary)
    if fs and fs.scorer_id:
        fs.pos = position(league, fs.scorer_id, summary)
    return fs, extras


_POS: dict = {}


def position(league: str, player_id: str, summary: dict) -> str:
    """The scorer's position abbreviation (NBA G/F/C, NHL C/LW/RW/D, NFL RB/WR/TE/QB...), or "".
    From the box score when it has one (NBA, NHL), else ESPN's athlete page (NFL), cached per run."""
    for side in (summary.get("boxscore") or {}).get("players") or []:
        for group in side.get("statistics") or []:
            for a in group.get("athletes") or []:
                ath = a.get("athlete") or {}
                if str(ath.get("id")) == str(player_id) and (ath.get("position") or {}).get("abbreviation"):
                    return ath["position"]["abbreviation"]
    if (league, player_id) not in _POS:
        try:
            _POS[league, player_id] = espn.athlete_position(league, player_id)
        except Exception as e:
            print(f"[warn] position {league} {player_id}: {e}", flush=True)
            return ""
    return _POS[league, player_id]


# ------------------------------------------------------------------ store

def load_store() -> dict:
    if FIRSTS.exists():
        return json.loads(FIRSTS.read_text())
    return {"updated": None, "games": {}}


def save_store(store: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    store["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    store["games"] = dict(sorted(store["games"].items(),
                                 key=lambda kv: (kv[1]["start"], kv[0]), reverse=True))
    FIRSTS.write_text(json.dumps(store, ensure_ascii=False, separators=(",", ":")) + "\n")


WHAT = {"nba": "points", "nhl": "goal", "nfl": "TD"}


def season_of(day: str) -> int:
    """The year a season starts in. All three leagues start in Aug-Oct, so Jan-Jul belongs to the year before."""
    return int(day[:4]) if int(day[4:6]) >= 8 else int(day[:4]) - 1


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def season_count(store: dict, league: str, day: str, first: dict) -> int:
    """How many of this season's games, this one included, the scorer of `first` scored first in."""
    season = season_of(day)
    pid = first.get("scorer_id")
    def same(f: dict) -> bool:
        if pid and f.get("scorer_id"):
            return f["scorer_id"] == pid
        return (f.get("scorer"), f.get("team")) == (first.get("scorer"), first.get("team"))
    return sum(1 for g in store["games"].values()
               if g.get("league") == league and g.get("first") and season_of(g["date"]) == season and same(g["first"]))


def season_note(store: dict, league: str, day: str, first: dict) -> str:
    n = season_count(store, league, day, first)
    times = "First time" if n == 1 else f"{ordinal(n)} time"
    return f"{times} this season scoring the game's first {WHAT[league]}"


POS_NAMES = {
    "nba": {"G": "guards", "F": "forwards", "C": "centers"},
    "nhl": {"C": "centers", "LW": "left wings", "RW": "right wings", "D": "defensemen", "G": "goalies"},
    "nfl": {"RB": "running backs", "WR": "wide receivers", "TE": "tight ends", "QB": "quarterbacks",
            "DST": "defense & special teams"},
}


def pos_group(league: str, pos: str | None) -> str:
    """Same groups as the Matchup tab: NBA G/F/C; NHL as given; NFL RB/WR/TE/QB, the rest DST."""
    p = (pos or "").upper()
    if not p:
        return ""
    if league == "nba":
        return "C" if p == "C" else "G" if p in ("PG", "SG", "G") else "F" if p in ("SF", "PF", "F") else p[0]
    if league == "nfl":
        return "RB" if p == "FB" else p if p in ("RB", "WR", "TE", "QB") else "DST"
    return p


def matchup_pick(store: dict, league: str, day: str, away: str, home: str, skip: str = "") -> dict | None:
    """The Matchup tab's pick from this season's games before this one: the team with the better
    first-score rate in this spot (away team on the road vs home team at home), then the best fit
    among its first scorers (most firsts, weighted by how often their position scores first against
    the other team). None when either team lacks games in that spot or the rates are equal."""
    season = season_of(day)
    games = [g for k, g in store["games"].items()
             if k != skip and g.get("league") == league and g.get("first") and g.get("date", "") <= day
             and season_of(g["date"]) == season]
    def rate(abbr, side):
        gs = [g for g in games if g[side] == abbr]
        return sum(g["first"]["team"] == abbr for g in gs), len(gs)
    ra, rh = rate(away, "away"), rate(home, "home")
    if not ra[1] or not rh[1] or ra[0] / ra[1] == rh[0] / rh[1]:
        return None
    team = away if ra[0] / ra[1] > rh[0] / rh[1] else home
    opp = home if team == away else away
    against = [g for g in games if opp in (g["home"], g["away"]) and g["first"]["team"] != opp]
    with_pos = [g for g in against if pos_group(league, g["first"].get("pos"))]
    share = {}
    for g in with_pos:
        grp = pos_group(league, g["first"]["pos"])
        share[grp] = share.get(grp, 0) + 1
    players = {}
    for g in sorted(games, key=lambda g: g.get("start", ""), reverse=True):
        if g["first"]["team"] != team:
            continue
        k = g["first"].get("scorer_id") or g["first"]["scorer"]
        p = players.setdefault(k, {"name": g["first"]["scorer"], "id": g["first"].get("scorer_id", ""),
                                   "grp": pos_group(league, g["first"].get("pos")), "n": 0})
        p["n"] += 1
    best = None
    if len(with_pos) >= 3 and players:
        fit = lambda p: p["n"] * (share.get(p["grp"], 0) / len(with_pos) + 0.05)
        best = max(players.values(), key=lambda p: (fit(p), p["n"]))
        best = {**best, "pct": round(100 * share.get(best["grp"], 0) / len(with_pos))}
    return {"team": team, "opp": opp, "away": ra, "home": rh, "best": best}


def pick_note(store: dict, league: str, day: str, rec: dict, key: str) -> str | None:
    pk = matchup_pick(store, league, day, rec["away"], rec["home"], skip=key)
    if not pk:
        return None
    f = rec["first"]
    pc = lambda r: f"{round(100 * r[0] / r[1])}% ({r[0]}/{r[1]})"
    mark = lambda ok: "✅" if ok else "❌"
    lines = [f"🎯 Pre-game pick: **{pk['team']}** {mark(f['team'] == pk['team'])} "
             f"({rec['away']} on the road {pc(pk['away'])} vs {rec['home']} at home {pc(pk['home'])})"]
    b = pk["best"]
    if b:
        hit = (b["id"] and b["id"] == f.get("scorer_id")) or b["name"] == f.get("scorer")
        pos = f" ({b['grp']})" if b["grp"] else ""
        why = f": {POS_NAMES[league].get(b['grp'], b['grp'])} scored {b['pct']}% of firsts against {pk['opp']}" if b["grp"] else ""
        lines.append(f"Best fit: {b['name']}{pos} {mark(hit)}{why}")
    return "\n".join(lines)


def process_date(store: dict, league: str, day: str, alert: bool) -> int:
    """Refresh one league/date in the store. Returns number of new first scores."""
    new = 0
    site = config().get("site_url")
    prefix = ntfy_prefix() if alert else None
    for g in espn.scoreboard(league, day):
        if g["season_type"] == 1:
            continue  # skip preseason
        key = f"{league}:{g['id']}"
        rec = store["games"].get(key) or {"first": None}
        rec.update({"league": league, "id": g["id"], "date": day, "start": g["start"],
                    "name": g["name"], "home": g["home"], "away": g["away"],
                    "state": g["state"], "final": g["state"] == "post",
                    "playoffs": g["season_type"] == 3,
                    "home_score": g["home_score"], "away_score": g["away_score"]})
        store["games"][key] = rec
        if rec["first"] or g["state"] == "pre":
            continue  # first scores never change once found
        try:
            fs, extras = read_game(league, g["id"])
        except Exception as e:
            print(f"[warn] {key}: {e}", flush=True)
            continue
        rec.update(extras)
        if fs:
            rec["first"] = fs.to_dict()
            new += 1
            note = season_note(store, league, day, rec["first"])
            if alert:
                notify.send(fs, [g["home"], g["away"]], prefix, site, note,
                            pick=pick_note(store, league, day, rec, key), image=lambda: shareimg.image(fs, rec, note, site))
            else:
                notify.console(fs, note)
    return new


def enrich(store: dict, limit: int) -> int:
    """Re-read games stored by an older version so they gain new fields
    (headshot id, shot spot, NBA tip-off, scorer position). Newest games first."""
    todo = [k for k, g in store["games"].items()
            if g.get("first") and g["first"].get("v", 1) < SCHEMA]
    done = 0
    for key in todo[:limit]:
        g = store["games"][key]
        try:
            fs, extras = read_game(g["league"], g["id"])
        except Exception as e:
            print(f"[warn] enrich {key}: {e}", flush=True)
            continue
        g.update(extras)
        if fs:
            g["first"] = fs.to_dict()
        else:
            g["first"]["v"] = SCHEMA  # don't retry forever
        done += 1
    if done:
        print(f"enriched {done} older games ({len(todo) - done} left)", flush=True)
    return done


def et_days_back(n: int) -> list[str]:
    today = datetime.now(ET).date()
    return [(today - timedelta(days=i)).strftime("%Y%m%d") for i in range(n)]


def worth_polling(store: dict) -> bool:
    """True if a game is live, or starts within 15 minutes, and still lacks its first score."""
    soon = datetime.now(timezone.utc) + timedelta(minutes=15)
    for g in store["games"].values():
        if g["first"] or g["final"]:
            continue
        if g["state"] == "in":
            return True
        try:
            if datetime.fromisoformat(g["start"].replace("Z", "+00:00")) <= soon:
                return True
        except ValueError:
            pass
    return False


# ------------------------------------------------------------------ commands

def update_once(leagues: list[str]) -> dict:
    store = load_store()
    for lg in leagues:
        # Yesterday too, so games that run past midnight Eastern get finished off.
        for day in et_days_back(2):
            try:
                process_date(store, lg, day, alert=True)
            except Exception as e:
                print(f"[warn] {lg} {day}: {e}", flush=True)
    enrich(store, ENRICH_PER_PASS)
    save_store(store)
    return store


def cmd_update(args) -> None:
    deadline = time.monotonic() + args.for_minutes * 60
    while True:
        store = update_once(args.leagues)
        live = worth_polling(store)
        if not live and not args.stay:
            return
        wait = POLL_SECONDS if live else IDLE_SECONDS
        if time.monotonic() + wait > deadline:
            return
        time.sleep(wait)


def cmd_watch(args) -> None:
    print(f"Only First is watching {', '.join(l.upper() for l in args.leagues)}. Ctrl+C to stop.", flush=True)
    while True:
        store = update_once(args.leagues)
        time.sleep(POLL_SECONDS if worth_polling(store) else 300)


def cmd_backfill(args) -> None:
    store = load_store()
    d = datetime.strptime(args.since, "%Y%m%d").date()
    end = datetime.now(ET).date()
    while d <= end:
        day = d.strftime("%Y%m%d")
        for lg in args.leagues:
            try:
                process_date(store, lg, day, alert=False)
            except Exception as e:
                print(f"[warn] {lg} {day}: {e}", flush=True)
        save_store(store)
        d += timedelta(days=1)
    while enrich(store, 100):
        save_store(store)
    save_store(store)


def cmd_teams(args) -> None:
    out = {lg: espn.teams(lg) for lg in espn.LEAGUES}
    TEAMS.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {TEAMS} ({sum(len(v) for v in out.values())} teams)")


def cmd_today(args) -> None:
    results = []
    for lg in args.leagues:
        for g in espn.scoreboard(lg, args.date):
            fs = find_first(lg, g["id"]) if g["state"] != "pre" else None
            if args.json:
                results.append({"league": lg, "game": g, "first": fs.to_dict() if fs else None})
            elif fs:
                notify.console(fs)
            else:
                label = "not started" if g["state"] == "pre" else "no score yet"
                print(f"\n{notify.EMOJI[lg]} {lg.upper()} {g['name']}: {label}")
    if args.json:
        print(json.dumps(results, indent=2))


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="only_first", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    leagues = lambda s: [x.strip().lower() for x in s.split(",") if x.strip()]
    for name in ("today", "update", "watch", "backfill", "teams"):
        p = sub.add_parser(name)
        p.add_argument("--leagues", default="nba,nhl,nfl", type=leagues)
        if name == "today":
            p.add_argument("--date", help="YYYYMMDD (default: today's slate)")
            p.add_argument("--json", action="store_true")
        if name == "update":
            p.add_argument("--for-minutes", type=float, default=0,
                           help="keep polling every 30s for this long while games are live")
            p.add_argument("--stay", action="store_true",
                           help="use all of --for-minutes even with no game live, looking every 2 min")
        if name == "backfill":
            p.add_argument("--since", required=True, help="YYYYMMDD")
    args = ap.parse_args(argv)
    bad = [l for l in args.leagues if l not in espn.LEAGUES]
    if bad:
        sys.exit(f"unknown league(s): {', '.join(bad)}")
    try:
        globals()[f"cmd_{args.cmd}"](args)
    except (KeyboardInterrupt, BrokenPipeError):
        pass


if __name__ == "__main__":
    main()
