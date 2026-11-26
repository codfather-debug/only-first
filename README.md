# Only First

Who scored first, and how. One alert per game:

| League | Tracks |
|---|---|
| 🏀 NBA | First points of the game (shot type, distance, assist) |
| 🏒 NHL | First goal (shot type, strength, assists; shootouts ignored) |
| 🏈 NFL | First touchdown (rush/pass/return, yards, passer) |

```
🏀 ONLY FIRST  NBA LAC @ HOU: Amen Thompson (HOU)
   Dunk Shot, 11:27 1st Quarter. Assist: Kevin Durant
🏒 ONLY FIRST  NHL MIN @ SJ: Kirill Kaprizov (MIN)
   Wrist Shot, power play, 7:37 1st. Assist: Matt Boldy, Joel Eriksson Ek
🏈 ONLY FIRST  NFL ARI @ KC: Travis Kelce (KC)
   Passing Touchdown, 8 yds from Patrick Mahomes, 9:46 Q1
```

Python 3.10+, standard library only.

## Use

```bash
python -m only_first today                       # today's slate, all leagues
python -m only_first today --date 20261122 --leagues nfl
python -m only_first today --json                # for an app/frontend
python -m only_first watch                       # live: alert as each first score happens
```

`watch` checks every 20 s while games are live and every 5 min otherwise, and
remembers announced games in `only_first_state.json` so restarts don't re-alert.

## Notifications

Set either or both:

- `ONLY_FIRST_NTFY_TOPIC=some-unguessable-name`: install the free **ntfy** app
  on your phone, subscribe to the same topic, and you get push notifications.
- `ONLY_FIRST_WEBHOOK_URL=...`: a Discord or Slack incoming webhook.

## Data

ESPN's public scoreboard/summary JSON (unofficial, no key). For a commercial
app, switch `only_first/espn.py` to a licensed feed (Sportradar, SportsDataIO,
etc.). The extractors in `only_first/extract.py` are where to adapt it.

## Tests

```bash
python -m unittest
```
