import json
import os
import unittest
from pathlib import Path

from only_first.extract import first_nba, first_nhl, first_nfl, tipoff_nba

FIX = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIX / name).read_text())


class TestFirsts(unittest.TestCase):
    def test_nba_first_points(self):
        fs = first_nba(load("nba_summary.json"))
        self.assertEqual(fs.scorer, "Coby White")
        self.assertEqual(fs.team, "CHA")
        self.assertIn("Pullup Jump Shot", fs.how)
        self.assertEqual(fs.clock, "11:14")
        self.assertEqual(fs.assists, ["Moussa Diabate"])

    def test_nhl_first_goal(self):
        fs = first_nhl(load("nhl_summary.json"))
        self.assertEqual(fs.scorer, "Timo Meier")
        self.assertEqual(fs.how, "Wrist Shot, even strength")
        self.assertEqual(fs.assists, ["Jack Hughes", "Connor Brown"])

    def test_nfl_first_touchdown_skips_field_goal(self):
        fs = first_nfl(load("nfl_summary.json"))
        self.assertEqual(fs.scorer, "Tee Higgins")
        self.assertEqual(fs.team, "CIN")
        self.assertEqual(fs.how, "Passing Touchdown, 31 yds from Joe Burrow")
        self.assertEqual(fs.period, "Q2")

    def test_nhl_ignores_shootout(self):
        s = {"header": {"id": "1"}, "plays": [
            {"sequenceNumber": "1", "scoringPlay": True, "type": {"text": "Shootout Goal"},
             "period": {"displayValue": "SO"}, "text": "X scores"}]}
        self.assertIsNone(first_nhl(s))

    def test_nba_spot_and_tip(self):
        s = load("nba_summary.json")
        fs = first_nba(s)
        self.assertEqual(fs.scorer_id, "4395651")
        self.assertEqual(fs.spot, {"x": 29.0, "y": 6.0})   # 7-foot jumper
        self.assertEqual(tipoff_nba(s)["team"], "CHA")

    def test_nhl_spot_attacks_one_net(self):
        fs = first_nhl(load("nhl_summary.json"))
        self.assertEqual(fs.scorer_id, "3899978")
        self.assertGreater(fs.spot["x"], 0)

    def test_nfl_spot_and_id(self):
        fs = first_nfl(load("nfl_summary.json"))
        self.assertEqual(fs.scorer_id, "4239993")
        self.assertEqual(fs.spot, {"yards": 31, "lane": "left"})

    def test_free_throw_spot(self):
        s = {"header": {"id": "1"}, "plays": [
            {"sequenceNumber": "1", "scoringPlay": True, "scoreValue": 1, "type": {"text": "Free Throw - 1 of 2"},
             "text": "A makes free throw 1 of 2", "coordinate": {"x": -214748340, "y": -214748365},
             "participants": [{"athlete": {"id": "9"}}]}]}
        self.assertEqual(first_nba(s).spot, {"ft": True})

    def test_no_score_yet(self):
        self.assertIsNone(first_nba({"plays": []}))
        self.assertIsNone(first_nfl({"scoringPlays": []}))


class TestPosition(unittest.TestCase):
    def test_from_box_score(self):
        from only_first.__main__ import position
        summary = {"boxscore": {"players": [{"statistics": [{"athletes": [
            {"athlete": {"id": "1", "position": {"abbreviation": "C"}}},
            {"athlete": {"id": "2", "position": {"abbreviation": "G"}}}]}]}]}}
        self.assertEqual(position("nba", "2", summary), "G")

    def test_falls_back_to_athlete_page(self):
        from unittest import mock
        from only_first import __main__ as m
        with mock.patch.object(m.espn, "athlete_position", return_value="RB") as ap:
            self.assertEqual(m.position("nfl", "99", {"boxscore": {"players": []}}), "RB")
            self.assertEqual(m.position("nfl", "99", {}), "RB")  # cached
            ap.assert_called_once()


if __name__ == "__main__":
    unittest.main()


class TestSeasonCount(unittest.TestCase):
    def setUp(self):
        from only_first import __main__ as m
        self.m = m
        f = lambda pid, name="X", team="DET": {"scorer_id": pid, "scorer": name, "team": team}
        self.store = {"games": {
            "a": {"league": "nfl", "date": "20260913", "first": f("1")},
            "b": {"league": "nfl", "date": "20261101", "first": f("1", team="CHI")},  # traded: same id counts
            "c": {"league": "nfl", "date": "20270105", "first": f("1")},             # January: same season
            "d": {"league": "nfl", "date": "20250914", "first": f("1")},             # last season
            "e": {"league": "nba", "date": "20261101", "first": f("1")},             # other league
            "f": {"league": "nfl", "date": "20261101", "first": f("2")},
            "g": {"league": "nfl", "date": "20261108", "first": None},
        }}

    def test_counts_this_season_by_player_id(self):
        self.assertEqual(self.m.season_count(self.store, "nfl", "20270105", {"scorer_id": "1"}), 3)

    def test_note_wording(self):
        self.assertEqual(self.m.season_note(self.store, "nfl", "20261101", {"scorer_id": "2"}),
                         "First time this season scoring the game's first TD")
        self.assertEqual(self.m.season_note(self.store, "nfl", "20261101", {"scorer_id": "1"}),
                         "3rd time this season scoring the game's first TD")
        self.assertEqual([self.m.ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22, 111)],
                         ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "111th"])


class TestDiscordImage(unittest.TestCase):
    def test_multipart_holds_payload_and_png(self):
        from only_first.notify import multipart
        body, ctype = multipart({"payload_json": '{"content": "hi"}'}, {"files[0]": ("a.png", b"\x89PNG data", "image/png")})
        boundary = ctype.split("boundary=")[1]
        self.assertTrue(body.endswith(f"--{boundary}--\r\n".encode()))
        self.assertIn(b'name="payload_json"', body)
        self.assertIn(b'name="files[0]"; filename="a.png"', body)
        self.assertIn(b"\x89PNG data", body)

    def test_share_options_match_the_website(self):
        from only_first.extract import FirstScore
        from only_first.shareimg import options
        fs = FirstScore(league="nba", game_id="1", matchup="BOS @ NY", team="NY", scorer="Jalen Brunson",
                        how="Jump Shot, 18 ft", period="1st Quarter", clock="11:20", description="", assists=[],
                        scorer_id="3934672")
        o = options(fs, {"date": "20261126", "name": "BOS @ NY"}, "2nd time this season scoring the game's first points", None)
        self.assertEqual(o["periodText"], "Q1")
        self.assertEqual(o["kicker"], "First points: New York Knicks")
        self.assertEqual(o["dateText"], "Thu, November 26")
        self.assertTrue(o["photo"].endswith("3934672.png&w=700&h=510&scale=crop&cquality=60"))
        self.assertIn(o["ink"], ("#ffffff", "#12151c"))



class TestShareImageCommand(unittest.TestCase):
    def test_chrome_arguments_stay_short(self):
        # Linux refuses any single argument over 128 KB, and the options (with the logo) are far bigger.
        from unittest import mock
        from only_first import shareimg
        from only_first.extract import FirstScore
        fs = FirstScore(league="nhl", game_id="1", matchup="DAL @ STL", team="STL", scorer="Philip Broberg",
                        how="Wrist Shot", period="1st", clock="0:24", description="", assists=[], scorer_id="4378683")
        seen = {}
        def fake_run(cmd, **kw):
            seen["cmd"] = cmd
            seen["page"] = Path(cmd[-1].replace("file://", "")).read_text()
            return mock.Mock(returncode=0, stderr=b"")
        from pathlib import Path
        with mock.patch.object(shareimg, "chrome", return_value="chrome"), \
             mock.patch.object(shareimg.subprocess, "run", side_effect=fake_run):
            shareimg.image(fs, {"date": "20261127", "name": "DAL @ STL"}, "2nd time", None)
        self.assertLess(max(len(a) for a in seen["cmd"]), 4096)
        self.assertIn("window.OF_OPTS = {", seen["page"])
        self.assertIn("Philip Broberg", seen["page"])


class TestNflScorerText(unittest.TestCase):
    def test_short_form(self):
        from only_first.extract import _nfl_scorer
        self.assertEqual(_nfl_scorer("Deebo Samuel 82 Yd pass from Brock Purdy (Eddy Pineiro Kick)"), "Deebo Samuel")

    def test_long_form_with_lateral(self):
        from only_first.extract import _nfl_long_form, _nfl_scorer
        text = "Brock Purdy complete pass to Mike Evans for 2 yards, lateral to Deebo Samuel for 80 yards (Eddy Pineiro Kick)"
        self.assertEqual(_nfl_scorer(text), "Deebo Samuel")
        self.assertEqual(_nfl_long_form(text), (82, "Brock Purdy"))

    def test_long_form_pass(self):
        from only_first.extract import _nfl_scorer
        self.assertEqual(_nfl_scorer("Jared Goff pass short left to Sam LaPorta for 12 yards, TOUCHDOWN"), "Sam LaPorta")

    def test_falls_back_to_last_named_player(self):
        from only_first.extract import _nfl_scorer
        known = {"Jahmyr Gibbs": "1", "Jake Bates": "2"}
        self.assertEqual(_nfl_scorer("Jahmyr Gibbs up the middle, TOUCHDOWN (Jake Bates Kick)", known), "Jahmyr Gibbs")


class TestNameMatch(unittest.TestCase):
    def test_suffixes_ignored(self):
        from only_first.extract import _norm
        self.assertEqual(_norm("Deebo Samuel Sr."), _norm("Deebo Samuel"))
        self.assertEqual(_norm("James Cook III"), _norm("James Cook"))
        self.assertNotEqual(_norm("Josh Allen"), _norm("Josh Allen Jr"[:-3] + "x"))


class TestWebhookFor(unittest.TestCase):
    def test_sport_channel_then_shared(self):
        from unittest import mock
        from only_first import notify
        env = {"ONLY_FIRST_WEBHOOK_URL": "shared", "ONLY_FIRST_WEBHOOK_URL_NBA": "nba",
               "ONLY_FIRST_WEBHOOK_URL_NHL": ""}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(notify.webhook_for("nba"), "nba")
            self.assertEqual(notify.webhook_for("nhl"), "shared")  # empty secret = unset
            self.assertEqual(notify.webhook_for("nfl"), "shared")
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(notify.webhook_for("nfl"))


class TestNtfyClick(unittest.TestCase):
    def test_click_opens_the_game(self):
        import json as _json
        from unittest import mock
        from only_first import notify
        from only_first.extract import FirstScore
        fs = FirstScore(league="nfl", game_id="401873081", matchup="CHI @ DET", team="DET", scorer="Jahmyr Gibbs",
                        how="Rushing Touchdown", period="Q1", clock="9:00", description="", assists=[])
        with mock.patch.object(notify.urllib.request, "urlopen") as op:
            notify._ntfy("https://ntfy.example", "t", fs, "https://onlyf1rst.com/")
        sent = _json.loads(op.call_args[0][0].data)
        self.assertEqual(sent["click"], "https://onlyf1rst.com/#game=nfl-401873081")


class TestStandby(unittest.TestCase):
    from datetime import datetime as _dt, timezone as _tz
    NOW = _dt(2026, 11, 27, 20, 0, tzinfo=_tz.utc)

    def run_(self, status, minutes_ago, conclusion="success"):
        t = (self.NOW - __import__("datetime").timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")
        return {"status": status, "conclusion": conclusion, "updated_at": t, "run_started_at": t, "created_at": t}

    def test_alive_while_a_run_is_going(self):
        from only_first.standby import stalled
        self.assertFalse(stalled([self.run_("in_progress", 5), self.run_("completed", 30)], self.NOW))

    def test_alive_just_after_a_run(self):
        from only_first.standby import stalled
        self.assertFalse(stalled([self.run_("completed", 3)], self.NOW))

    def test_stalled_after_quiet_spell(self):
        from only_first.standby import stalled
        self.assertTrue(stalled([self.run_("completed", 40)], self.NOW))

    def test_stuck_or_queued_runs_dont_count(self):
        from only_first.standby import stalled
        self.assertTrue(stalled([self.run_("in_progress", 45), self.run_("queued", 1), self.run_("completed", 50)], self.NOW))
        self.assertTrue(stalled([self.run_("completed", 2, conclusion="cancelled")], self.NOW))
        self.assertTrue(stalled([], self.NOW))
