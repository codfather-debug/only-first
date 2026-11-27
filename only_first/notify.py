"""Notification channels.

Push (free, via https://ntfy.sh): every first score is published to two topics,
    {prefix}-{league}           e.g. onlyfirst-nba        (every game)
    {prefix}-{league}-{team}    e.g. onlyfirst-nba-bos    (one team's games)
for BOTH teams in the game, so fans of either side get it. People subscribe in
the ntfy app to only the topics they want: no accounts, no server of our own.

The topic prefix comes from docs/config.json ("ntfy_prefix"); the website uses
the same file to build its subscribe links. Env vars:
  ONLY_FIRST_NTFY_PREFIX  override the prefix ("" turns push off)
  ONLY_FIRST_NTFY_SERVER  default https://ntfy.sh
  ONLY_FIRST_WEBHOOK_URL  optional Discord/Slack incoming webhook (all games)
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from .extract import FirstScore

EMOJI = {"nba": "🏀", "nhl": "🏒", "nfl": "🏈"}
NTFY_TAGS = {"nba": "basketball", "nhl": "ice_hockey", "nfl": "football"}


def topics(prefix: str, league: str, teams: list[str]) -> list[str]:
    return [f"{prefix}-{league}"] + [f"{prefix}-{league}-{t.lower()}" for t in teams]


def _body(fs: FirstScore, note: str | None) -> str:
    return fs.message() + (f"\n{note}" if note else "")


def console(fs: FirstScore, note: str | None = None) -> None:
    body = _body(fs, note).replace("\n", "\n   ")
    print(f"\n{EMOJI.get(fs.league, '')} ONLY FIRST  {fs.headline()}\n   {body}", flush=True)


def _ntfy(server: str, topic: str, fs: FirstScore, click: str | None, note: str | None = None) -> None:
    payload = {"topic": topic, "title": f"Only First: {fs.headline()}",
               "message": _body(fs, note), "tags": [NTFY_TAGS[fs.league]]}
    if click:
        payload["click"] = click
    req = urllib.request.Request(server.rstrip("/"), data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    for attempt in range(3):
        try:
            urllib.request.urlopen(req, timeout=15).close()
            return
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 2:
                raise
            wait = min(int(e.headers.get("Retry-After") or 10), 30)
            time.sleep(wait)


def _webhook(url: str, fs: FirstScore, note: str | None = None) -> None:
    text = f"{EMOJI.get(fs.league, '')} **Only First:** {fs.headline()}\n{_body(fs, note)}"
    req = urllib.request.Request(url, data=json.dumps({"content": text, "text": text}).encode(),
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "only-first/0.2"}, method="POST")
    urllib.request.urlopen(req, timeout=15).close()


def send(fs: FirstScore, teams: list[str], prefix: str | None, site_url: str | None = None,
         note: str | None = None) -> None:
    console(fs, note)
    server = os.environ.get("ONLY_FIRST_NTFY_SERVER", "https://ntfy.sh")
    hook = os.environ.get("ONLY_FIRST_WEBHOOK_URL")
    jobs = []
    if prefix:
        jobs += [(f"ntfy:{t}", lambda t=t: _ntfy(server, t, fs, site_url, note))
                 for t in topics(prefix, fs.league, teams)]
    if hook:
        jobs.append(("webhook", lambda: _webhook(hook, fs, note)))
    for name, fn in jobs:
        try:
            fn()
        except Exception as e:  # never let one channel kill the run
            print(f"   [warn] {name} failed: {e}", flush=True)
