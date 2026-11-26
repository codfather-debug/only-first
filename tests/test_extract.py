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


if __name__ == "__main__":
    unittest.main()
