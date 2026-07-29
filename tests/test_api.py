from __future__ import annotations

import unittest

from api.companies import filter_records, load_dataset


class CompaniesApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.records = load_dataset()["records"]

    def test_filters_dissolutions(self) -> None:
        records, total, offset = filter_records(
            self.records,
            {"event": ["DISSOLUTION"]},
        )

        self.assertEqual(offset, 0)
        self.assertGreaterEqual(total, 2)
        self.assertTrue(all("DISSOLUTION" in row["event"]["types"] for row in records))

    def test_finds_kleat_by_company_name(self) -> None:
        records, total, _ = filter_records(
            self.records,
            {"company": ["kleat"], "min_confidence": ["0.8"]},
        )

        self.assertEqual(total, 1)
        self.assertEqual(records[0]["company"]["commercial_register_number"], "8523")

    def test_rejects_invalid_confidence(self) -> None:
        with self.assertRaises(ValueError):
            filter_records(self.records, {"min_confidence": ["2"]})


if __name__ == "__main__":
    unittest.main()
