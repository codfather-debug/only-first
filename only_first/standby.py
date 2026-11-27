"""Standby tracker for a home PC: takes over only when the GitHub tracker has stopped.

Run it every 5 minutes (Windows Task Scheduler, cron...). Each run asks GitHub when the
tracker workflow last ran:
  - it ran in the last STALE_MINUTES: do nothing (and, if this PC had taken over, say it's back)
  - it didn't: track games for MINUTES (alerts included), save the scores to the data branch,
    and send a private alert the first time it takes over
  - GitHub can't be reached: do nothing; there'd be nowhere to save the scores anyway

    python -m only_first.standby             # the scheduled run
    python -m only_first.standby --check     # just say whether the GitHub tracker looks alive
    python -m only_first.standby --rehearse  # take over now, but send no alerts and save nothing

Setup lives in environment variables:
  ONLY_FIRST_WEBHOOK_URL    the Discord webhook (same as the GitHub secret)
  ONLY_FIRST_STANDBY_TOPIC  a private ntfy topic for "PC took over" / "GitHub is back" notes

Files it keeps next to the repo (all gitignored): standby-data/ (a clone of the data
branch), standby-state.json, standby.log.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = "codfather-debug/only-first"
RUNS_URL = f"https://api.github.com/repos/{REPO}/actions/workflows/track.yml/runs?per_page=10"
STALE_MINUTES = 15   # GitHub runs last ~9 min and start the next at once, so 15 quiet minutes means stopped
RUN_MAX_MINUTES = 20  # a run "in progress" longer than this is stuck, not alive
MINUTES = 4          # tracking per scheduled run (scheduled every 5 min, so back to back)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "standby-data"
STATE = ROOT / "standby-state.json"
LOG = ROOT / "standby.log"


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    lines = (LOG.read_text(encoding="utf-8").splitlines() if LOG.exists() else [])[-3000:]
    LOG.write_text("\n".join(lines + [line]) + "\n", encoding="utf-8")


def _time(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def last_alive(runs: list[dict], now: datetime) -> datetime | None:
    """When the GitHub tracker was last seen working: now if a run is in progress (and not stuck),
    else when the latest finished run ended. Queued runs don't count: they may never start."""
    seen = []
    for r in runs:
        if r.get("status") == "in_progress":
            started = _time(r.get("run_started_at")) or _time(r.get("created_at"))
            if started and now - started < timedelta(minutes=RUN_MAX_MINUTES):
                seen.append(now)
        elif r.get("status") == "completed" and r.get("conclusion") in ("success", "failure"):
            seen.append(_time(r.get("updated_at")))
    seen = [t for t in seen if t]
    return max(seen) if seen else None


def stalled(runs: list[dict], now: datetime) -> bool:
    alive = last_alive(runs, now)
    return alive is None or now - alive > timedelta(minutes=STALE_MINUTES)


def github_runs() -> list[dict]:
    req = urllib.request.Request(RUNS_URL, headers={"User-Agent": "only-first-standby",
                                                    "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)["workflow_runs"]


def tell_owner(title: str, message: str) -> None:
    topic = os.environ.get("ONLY_FIRST_STANDBY_TOPIC")
    log(f"{title}: {message}")
    if not topic:
        return
    body = json.dumps({"topic": topic, "title": title, "message": message, "tags": ["computer"]}).encode()
    try:
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, method="POST",
                                                      headers={"Content-Type": "application/json"}), timeout=15).close()
    except Exception as e:
        log(f"could not send the standby note: {e}")


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=DATA if DATA.exists() else ROOT, capture_output=True,
                          text=True, check=check)


def sync_data() -> None:
    """standby-data/ = the data branch exactly as GitHub has it."""
    if not (DATA / ".git").exists():
        origin = subprocess.run(["git", "remote", "get-url", "origin"], cwd=ROOT, capture_output=True,
                                text=True, check=True).stdout.strip()
        subprocess.run(["git", "clone", "--quiet", "--branch", "data", "--single-branch", origin, str(DATA)],
                       check=True)
        git("config", "core.autocrlf", "false")  # keep firsts.json byte for byte, or every save is a giant diff
        git("config", "user.name", "only-first-standby")
        git("config", "user.email", "only-first-standby@users.noreply.github.com")
    git("fetch", "--quiet", "origin", "data")
    git("reset", "--quiet", "--hard", "origin/data")


def track(rehearse: bool) -> None:
    env = {**os.environ, "ONLY_FIRST_DATA_DIR": str(DATA), "PYTHONUTF8": "1"}
    if rehearse:
        env["ONLY_FIRST_NTFY_PREFIX"] = ""      # no phone alerts
        env.pop("ONLY_FIRST_WEBHOOK_URL", None)  # no Discord
    run = subprocess.run([sys.executable, "-m", "only_first", "update", "--for-minutes", str(MINUTES), "--stay"],
                         cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    for line in (run.stdout + run.stderr).strip().splitlines():
        log(f"  {line}")


def save() -> None:
    git("add", "-A")
    if git("diff", "--cached", "--quiet", check=False).returncode == 0:
        log("no new scores to save")
        return
    git("commit", "--quiet", "-m", "Update first scores (standby PC)")
    push = git("push", "--quiet", "origin", "HEAD:data", check=False)
    if push.returncode != 0:
        # Someone else (GitHub, back again) saved first. Theirs wins; this PC's copy is dropped.
        log(f"push refused, GitHub saved first: {push.stderr.strip()[:200]}")
        git("reset", "--quiet", "--hard", "origin/data")
    else:
        log("saved scores to the data branch")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="only_first.standby", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="only report whether the GitHub tracker looks alive")
    ap.add_argument("--rehearse", action="store_true", help="take over now without alerts or saving")
    args = ap.parse_args(argv)
    now = datetime.now(timezone.utc)
    state = json.loads(STATE.read_text()) if STATE.exists() else {"active": False}

    try:
        runs = github_runs()
    except Exception as e:
        log(f"can't reach GitHub ({e}); doing nothing")
        return 0
    alive = last_alive(runs, now)
    is_stalled = stalled(runs, now)
    ago = f"{(now - alive).total_seconds() / 60:.0f} min ago" if alive else "never"
    if args.check:
        log(f"GitHub tracker last seen {ago}: {'STOPPED, standby would take over' if is_stalled else 'alive'}")
        return 0

    if args.rehearse:
        log("rehearsal: taking over without alerts or saving")
        sync_data()
        track(rehearse=True)
        log("rehearsal done")
        return 0

    if not is_stalled:
        if state.get("active"):
            tell_owner("Only First: GitHub tracker is back", "The PC has stepped back to standby.")
            STATE.write_text(json.dumps({"active": False}))
        return 0

    if not state.get("active"):
        tell_owner("Only First: PC took over",
                   f"The GitHub tracker was last seen {ago}. The PC is tracking games and sending alerts.")
        STATE.write_text(json.dumps({"active": True}))
    sync_data()
    track(rehearse=False)
    save()
    return 0


if __name__ == "__main__":
    sys.exit(main())
