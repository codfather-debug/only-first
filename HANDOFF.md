# Handoff: working on Only First locally

Only First tracks the first score of every NBA, NHL and NFL game (first points,
first goal, first touchdown), shows them on a website, and sends phone alerts.
It all runs free on GitHub: Actions does the checking, Pages hosts the site,
ntfy.sh delivers the alerts. See `README.md` for the full description.

## Get the code

```bash
git clone https://github.com/codfather-debug/only-first.git
cd only-first
code .
```

| Branch | What it holds |
|---|---|
| `main` | What's live: tracker, website, GitHub Actions workflow |
| `claude/only-first-sports-tracker-sc13lj` | Newer work in pull request #1: player cards, shot maps, share images, settings (sports, language, theme), installable app. Merge it to go live. |
| `data` | Score data only. GitHub Actions writes to it every few minutes; never edit it by hand. |

## What you need

- **Python 3.10 or newer.** No packages to install; the tracker uses only the standard library.
- **A browser.** The site is plain HTML, CSS and JavaScript with no build step.
- **Suggested VS Code extensions:** Python; optionally Live Server.

## Run it locally

```bash
python -m unittest                              # tests (9 should pass)
python -m only_first today                      # today's first scores in the terminal
python -m only_first backfill --since 20260909  # local score data (~4 min, sends no alerts)
cd docs && python -m http.server 8000           # open http://localhost:8000
```

- **Run the backfill before previewing the site.** The local site reads `docs/data/firsts.json`, which isn't in git.
  On `localhost` the site always uses that local file, never the live data.
- **`python -m only_first update` sends real push alerts** to everyone subscribed.
  To run it without alerts: `ONLY_FIRST_NTFY_PREFIX= python -m only_first update`.

## Where things live

| Path | Purpose |
|---|---|
| `only_first/extract.py` | Finds each game's first score: who, how, where (court/rink/field spot), NBA tip-off |
| `only_first/__main__.py` | Commands, the score store, automatic upgrade of older stored games |
| `only_first/espn.py` | ESPN data fetching; the only file to change if you switch data providers |
| `only_first/notify.py` | Push alerts via ntfy; optional Discord/Slack webhook |
| `docs/app.js` | Website logic |
| `docs/i18n.js` | All interface text in English, Spanish and French |
| `docs/maps.js`, `docs/share.js`, `docs/brand.js` | Court/rink/field drawings, share images, logo |
| `docs/config.json` | Site address, data address, alert topic prefix |
| `docs/sw.js` | Offline support for the installable app. Bump `SHELL` (e.g. `of-shell-v6`) whenever you change site files, or installed copies keep the old version. |
| `.github/workflows/track.yml` | The tracker: each ~9-minute run starts the next |
| `tests/` | Tests, using real saved games as test data |

## How the pieces connect

1. GitHub Actions runs `python -m only_first update --for-minutes 9 --stay`, checking every 30 seconds while a game is live and every 2 minutes otherwise. Each run starts the next one when it ends. GitHub's 5-minute schedule stays on only as a backup: it proved unreliable (once in 90 minutes on Nov 26, 2026).
2. It reads ESPN's public scoreboard and play-by-play, finds new first scores, and sends ntfy alerts to `onlyfirst-<league>` and `onlyfirst-<league>-<team>`.
3. It saves everything to `firsts.json` on the `data` branch.
4. The website (GitHub Pages, `docs/` on `main`) reads that file from the `data` branch.
   Keeping data on its own branch avoids rebuilding the site on every update.

## GitHub settings already in place

- **Pages:** deploy from branch `main`, folder `/docs`. Live at https://codfather-debug.github.io/only-first/
- **Actions:** the "Track first scores" workflow is enabled. It needs no secrets.
- **Optional secret:** `ONLY_FIRST_WEBHOOK_URL`, only to also post alerts to a Discord or Slack channel.
- **Keep the repo public.** Public repos get unlimited free Actions minutes; a private repo would run out in about a week.

## Status at handoff (Nov 26, 2026)

- **Pull request #1 is not merged yet.** The live site still shows the first, plain version.
- **The tracker restarts itself.** A new "Track first scores" run should appear in the Actions tab about every 10 minutes. If the runs stop, start one with *Run workflow*. To pause the tracker, cancel the running run or disable the workflow.
- **Phone alerts have not been seen arriving from GitHub yet.** Subscribe to `onlyfirst-nfl` in the ntfy app to confirm the next one.
- **The Spanish and French text needs a native speaker's review.**

## Known limits

- **ESPN's feeds are public but unofficial.** A commercial app should switch to a licensed feed by changing only `only_first/espn.py`.
- **Timing:** alerts usually arrive within about a minute. The website lags up to about 5 minutes because GitHub caches the data file.
- **Free ntfy limit:** 250 messages a day per sending address. Each first score sends 3, so about 120 on a busy day.
- **Open alert topics:** anyone who knows a topic name can also post to it.
- **Pausing:** GitHub pauses scheduled workflows after 60 days with no repo activity and emails first; one click turns them back on.
- **English only:** play-by-play text and push alerts stay in English in every language.
