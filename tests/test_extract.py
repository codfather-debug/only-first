import json
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


class TestMatchupLean(unittest.TestCase):
    def store(self):
        g = lambda i, day, away, home, first: (f"nfl:{i}", {"league": "nfl", "date": day, "away": away, "home": home,
                                                           "first": {"team": first} if first else None})
        return {"games": dict([
            g(1, "20261101", "KC", "DEN", "KC"), g(2, "20261108", "KC", "LV", "KC"), g(3, "20261115", "KC", "LAC", "LAC"),
            g(4, "20261101", "MIA", "BUF", "MIA"), g(5, "20261108", "NYJ", "BUF", "BUF"),
            g(6, "20261122", "KC", "BUF", "KC"),  # the game being alerted: left out
            g(7, "20251109", "KC", "BUF", "BUF"),  # last season: left out
        ])}

    def test_lean_matches_the_matchup_tab(self):
        from only_first.__main__ import lean_note, matchup_lean
        s = self.store()
        # KC scored first in 2 of 3, BUF in 1 of 2: (2/3 + 1/2) / 2 = 58%
        self.assertEqual(matchup_lean(s, "nfl", "20261122", "KC", "BUF", skip="nfl:6"), ("KC", 58))
        rec = s["games"]["nfl:6"]
        self.assertEqual(lean_note(s, "nfl", "20261122", rec, "nfl:6"), "Pre-game lean: KC 58% · BUF 42% (called it ✅)")
        rec["first"]["team"] = "BUF"
        self.assertTrue(lean_note(s, "nfl", "20261122", rec, "nfl:6").endswith("(missed ❌)"))

    def test_no_lean_without_games(self):
        from only_first.__main__ import matchup_lean
        self.assertIsNone(matchup_lean(self.store(), "nfl", "20261122", "KC", "SF"))


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
