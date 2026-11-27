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


class TestMatchupPick(unittest.TestCase):
    def test_pick_and_best_fit(self):
        from only_first.__main__ import matchup_pick, pick_note
        n = iter(range(100))
        def g(day, away, home, team, scorer, pos):
            return f"nfl:{next(n)}", {"league": "nfl", "date": day, "start": day, "away": away, "home": home,
                                     "first": {"team": team, "scorer": scorer, "scorer_id": scorer, "pos": pos}}
        games = dict([
            g("20261101", "CHI", "GB", "GB", "x", "WR"), g("20261108", "CHI", "MIN", "CHI", "y", "RB"),
            g("20261102", "NYG", "CHI", "NYG", "z", "RB"), g("20261109", "TB", "CHI", "TB", "w", "RB"),
            g("20261116", "CHI", "SEA", "SEA", "v", "RB"),
            g("20261101", "GB", "DET", "DET", "Gibbs", "RB"), g("20261108", "MIN", "DET", "DET", "ARSB", "WR"),
            g("20261115", "SEA", "DET", "DET", "ARSB", "WR"), g("20261116", "LAR", "DET", "LAR", "q", "QB"),
        ])
        k, rec = g("20261126", "CHI", "DET", "DET", "Gibbs", "RB")
        games[k] = rec
        store = {"games": games}
        pk = matchup_pick(store, "nfl", "20261126", "CHI", "DET", skip=k)
        self.assertEqual((pk["team"], pk["away"], pk["home"]), ("DET", (1, 3), (3, 4)))
        # Against CHI: RB 3 of 4 firsts. ARSB has 2 firsts as a WR (2 x .30), Gibbs 1 as an RB (1 x .80).
        self.assertEqual(pk["best"]["name"], "Gibbs")
        note = pick_note(store, "nfl", "20261126", rec, k)
        self.assertIn("**DET** ✅", note)
        self.assertIn("Best fit: Gibbs (RB) ✅: running backs scored 75% of firsts against CHI", note)

    def test_no_pick_on_equal_rates(self):
        from only_first.__main__ import matchup_pick
        store = {"games": {"a": {"league": "nba", "date": "20261101", "away": "A", "home": "X", "first": {"team": "A"}},
                           "b": {"league": "nba", "date": "20261101", "away": "Y", "home": "B", "first": {"team": "B"}}}}
        self.assertIsNone(matchup_pick(store, "nba", "20261126", "A", "B"))
