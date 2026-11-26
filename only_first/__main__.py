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

from . import espn, notify
from .extract import EXTRACTORS

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
CONFIG = DOCS / "config.json"
TEAMS = DOCS / "teams.json"
# Score data lives on its own `data` branch in production (see README); locally it's docs/data.
DATA = Path(os.environ.get("ONLY_FIRST_DATA_DIR") or DOCS / "data")
FIRSTS = DATA / "firsts.json"
ET = ZoneInfo("America/New_York")
POLL_SECONDS = 30


def config() -> dict:
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else {}


def ntfy_prefix() -> str | None:
    env = os.environ.get("ONLY_FIRST_NTFY_PREFIX")
    if env is not None:
        return env or None          # set to "" to turn push off
    return config().get("ntfy_prefix") or None


def find_first(league: str, game_id: str):
    return EXTRACTORS[league](espn.summary(league, game_id))


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
            fs = find_first(league, g["id"])
        except Exception as e:
            print(f"[warn] {key}: {e}", flush=True)
            continue
        if fs:
            rec["first"] = fs.to_dict()
            new += 1
            if alert:
                notify.send(fs, [g["home"], g["away"]], prefix, site)
            else:
                notify.console(fs)
    return new


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
    save_store(store)
    return store


def cmd_update(args) -> None:
    deadline = time.monotonic() + args.for_minutes * 60
    while True:
        store = update_once(args.leagues)
        if time.monotonic() + POLL_SECONDS > deadline or not worth_polling(store):
            return
        time.sleep(POLL_SECONDS)


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
