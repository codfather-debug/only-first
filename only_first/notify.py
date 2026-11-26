"""Notification channels. Configure with environment variables:

ONLY_FIRST_NTFY_TOPIC   push to phones via https://ntfy.sh (free app, no account)
ONLY_FIRST_WEBHOOK_URL  POST to a Discord or Slack incoming webhook
"""
from __future__ import annotations

import json
import os
import urllib.request

from .extract import FirstScore

EMOJI = {"nba": "🏀", "nhl": "🏒", "nfl": "🏈"}


def console(fs: FirstScore) -> None:
    print(f"\n{EMOJI.get(fs.league, '')} ONLY FIRST  {fs.headline()}\n   {fs.message().replace(chr(10), chr(10) + '   ')}", flush=True)


def ntfy(fs: FirstScore, topic: str, server: str = "https://ntfy.sh") -> None:
    req = urllib.request.Request(
        f"{server.rstrip('/')}/{topic}",
        data=fs.message().encode(),
        headers={"Title": f"Only First: {fs.headline()}".encode("utf-8").decode("latin-1"),
                 "Tags": {"nba": "basketball", "nhl": "ice_hockey", "nfl": "football"}[fs.league]},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=15).close()


def webhook(fs: FirstScore, url: str) -> None:
    text = f"{EMOJI.get(fs.league, '')} **Only First:** {fs.headline()}\n{fs.message()}"
    body = json.dumps({"content": text, "text": text}).encode()  # Discord + Slack
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "only-first/0.1"})
    urllib.request.urlopen(req, timeout=15).close()


def send(fs: FirstScore) -> None:
    console(fs)
    topic = os.environ.get("ONLY_FIRST_NTFY_TOPIC")
    hook = os.environ.get("ONLY_FIRST_WEBHOOK_URL")
    for name, fn in (("ntfy", lambda: topic and ntfy(fs, topic, os.environ.get("ONLY_FIRST_NTFY_SERVER", "https://ntfy.sh"))),
                     ("webhook", lambda: hook and webhook(fs, hook))):
        try:
            fn()
        except Exception as e:  # never let one channel kill the watcher
            print(f"   [warn] {name} notification failed: {e}", flush=True)
