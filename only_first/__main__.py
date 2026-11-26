"""Only First: who scored first, and how.

  python -m only_first today [--leagues nba,nhl,nfl] [--date YYYYMMDD] [--json]
  python -m only_first watch [--leagues nba,nhl,nfl] [--state state.json]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import espn, notify
from .extract import EXTRACTORS

LIVE_POLL = 20      # seconds between checks while a game we care about is live
IDLE_POLL = 300     # seconds between checks when nothing is live


def find_first(league: str, game_id: str):
    return EXTRACTORS[league](espn.summary(league, game_id))


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


def cmd_watch(args) -> None:
    state_path = Path(args.state)
    sent: set[str] = set(json.loads(state_path.read_text())) if state_path.exists() else set()
    print(f"Only First is watching {', '.join(l.upper() for l in args.leagues)}. Ctrl+C to stop.", flush=True)
    while True:
        any_live = False
        for lg in args.leagues:
            try:
                games = espn.scoreboard(lg)
            except Exception as e:
                print(f"[warn] {lg} scoreboard: {e}", flush=True)
                continue
            for g in games:
                key = f"{lg}:{g['id']}"
                if g["state"] == "pre" or key in sent:
                    continue
                if g["state"] == "in":
                    any_live = True
                try:
                    fs = find_first(lg, g["id"])
                except Exception as e:
                    print(f"[warn] {key}: {e}", flush=True)
                    continue
                if fs:
                    notify.send(fs)
                    sent.add(key)
                    state_path.write_text(json.dumps(sorted(sent)))
                elif g["state"] == "post":
                    sent.add(key)  # finished with no qualifying score (e.g. no TD)
                    state_path.write_text(json.dumps(sorted(sent)))
        if args.once:
            return
        time.sleep(LIVE_POLL if any_live else IDLE_POLL)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="only_first", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("today", "watch"):
        p = sub.add_parser(name)
        p.add_argument("--leagues", default="nba,nhl,nfl",
                       type=lambda s: [x.strip().lower() for x in s.split(",") if x.strip()])
        if name == "today":
            p.add_argument("--date", help="YYYYMMDD (default: today's slate)")
            p.add_argument("--json", action="store_true")
        else:
            p.add_argument("--state", default="only_first_state.json",
                           help="remembers which games were already announced")
            p.add_argument("--once", action="store_true", help="check once and exit")
    args = ap.parse_args(argv)
    bad = [l for l in args.leagues if l not in espn.LEAGUES]
    if bad:
        sys.exit(f"unknown league(s): {', '.join(bad)}")
    try:
        {"today": cmd_today, "watch": cmd_watch}[args.cmd](args)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
