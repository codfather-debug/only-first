# Only First

Who scored first in every game, and how.

| League | Tracks |
|---|---|
| 🏀 NBA | First points (shot type, distance, assist) |
| 🏒 NHL | First goal (shot type, power play / even strength, assists; shootouts ignored) |
| 🏈 NFL | First touchdown (rush / pass / return, yards, passer) |

- **Website** (GitHub Pages): a card for every game's first score, with the
  player's photo in team colors and a small court, rink or field showing where it
  happened. Plus a team picker and season stats: shot maps, who scores first most,
  how it happens, how often the team that scores first wins, and (NBA) whether
  winning the opening tip matters.
- **Installable**: add the site to your phone's home screen and it opens full
  screen like an app (works offline for everything except new scores).
- **Phone alerts** (ntfy): one push per game, for every game or just your teams.

Everything runs free: GitHub Actions does the checking, GitHub Pages hosts the
site, ntfy.sh delivers the push notifications. Nothing to pay for, no server.

## How it fits together

```
GitHub Actions (every 5 min; checks every 30 s while games are live)
   │  python -m only_first update
   ├─► ESPN public scoreboard + play-by-play
   ├─► ntfy.sh push:  onlyfirst-nba, onlyfirst-nba-bos, ...
   └─► commits firsts.json to the `data` branch
                                   │
GitHub Pages (docs/ on main) ──────┘ reads firsts.json from the data branch
```

Score data lives on its own `data` branch so the frequent updates don't count
against GitHub Pages' limit of about 10 site rebuilds an hour.

## One-time setup (after the code is pushed)

1. The repo must be **public**. Public repos get unlimited free Actions minutes;
   private ones get 2,000 a month, which this would use up in about a week.
2. **Settings → Pages → Build and deployment**: Source *Deploy from a branch*,
   Branch `main`, folder `/docs`. The site appears at
   `https://<you>.github.io/only-first/`.
3. **Actions tab**: enable workflows if asked, then run *Track first scores* once
   by hand (*Run workflow*) to check it works.
4. Optional: **Settings → Secrets → Actions →** `ONLY_FIRST_WEBHOOK_URL` to also
   post to a Discord or Slack channel.

If you rename the repo or account, update `docs/config.json`.

## Phone alerts

Install the free **ntfy** app (iOS / Android), tap **+**, and subscribe to topics:

| Topic | You get |
|---|---|
| `onlyfirst-nba` / `onlyfirst-nhl` / `onlyfirst-nfl` | every game in that league |
| `onlyfirst-<league>-<team>` e.g. `onlyfirst-nhl-nyr` | only that team's games |

The website's **My teams** page lists the topics for the teams you pick.

## Limits of the free setup (honest notes)

- **Timing:** alerts usually arrive within about a minute, sometimes several
  minutes late. GitHub's scheduler can start runs late at busy times, and ESPN's
  feed lags a little behind TV. The website updates within about 5 minutes,
  because GitHub caches the data file.
- **ntfy free tier:** 250 messages a day per sending address. Each first score
  sends 3 (league + both teams), so even a 40-game day (about 120) fits.
- **Public topics:** anyone who knows a topic name can also post to it. Fine for
  now; a paid ntfy plan or self-hosting can lock topics later.
- **Pausing:** GitHub pauses scheduled workflows after 60 days with no repo
  activity and emails you first; one click turns them back on.
- **Data source:** ESPN's public JSON is unofficial and unlicensed. Fine for a
  personal or hobby project; a commercial app should switch to a licensed feed
  (only `only_first/espn.py` would change).

## Data upgrades

Each stored game records which version of the extractor read it. When the
extractor learns something new (like shot locations), the tracker re-reads older
games 150 at a time on each run, so the whole season upgrades itself within a
few runs. No manual step.

## Running it yourself

Python 3.10+, standard library only.

```bash
python -m only_first today                     # today's first scores in the terminal
python -m only_first today --date 20261122 --leagues nfl
python -m only_first update                    # one pass: refresh docs/data + send alerts
python -m only_first watch                     # keep running on your own machine
python -m only_first backfill --since 20260909 # load past games (no alerts)
python -m only_first teams                     # refresh docs/teams.json
cd docs && python -m http.server               # preview the site at localhost:8000
python -m unittest                             # tests
```
