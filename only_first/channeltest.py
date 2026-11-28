"""Post a labeled test to each sport's webhook, to check every Discord channel gets its own sport.

    python -m only_first.channeltest   # newest stored first score per sport; no phone alerts

Says for each sport whether it used the sport's own webhook or the shared one; never prints a URL.
"""
from __future__ import annotations

import os
import sys

from . import notify, shareimg
from .__main__ import load_store, season_note
from .extract import FirstScore


def main() -> int:
    store = load_store()
    failed = 0
    for lg in ("nba", "nhl", "nfl"):
        hook = notify.webhook_for(lg)
        own = bool(os.environ.get(f"ONLY_FIRST_WEBHOOK_URL_{lg.upper()}"))
        recs = [g for g in store["games"].values() if g.get("league") == lg and g.get("first")]
        if not hook or not recs:
            print(f"{lg}: skipped ({'no webhook' if not hook else 'no stored games'})")
            continue
        rec = max(recs, key=lambda g: g.get("start", ""))
        fs = FirstScore(**{k: v for k, v in rec["first"].items() if k in FirstScore.__dataclass_fields__})
        note = (f"{season_note(store, lg, rec['date'], rec['first'])}\n"
                f"_Test post: checking this channel gets {lg.upper()} alerts._")
        try:
            notify._webhook(hook, fs, note, image=lambda: shareimg.image(fs, rec, note, None))
            print(f"{lg}: sent to the {'sport' if own else 'SHARED'} webhook: {fs.headline()}")
        except Exception as e:
            failed += 1
            print(f"{lg}: FAILED ({e})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
