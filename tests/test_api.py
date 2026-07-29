from __future__ import annotations

import unittest

from api.companies import filter_records, load_dataset
from api.index import route_request


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

    def test_filters_city_after_loading_all_records(self) -> None:
        records, total, _ = filter_records(
            self.records,
            {"city": ["Settat"]},
        )

        self.assertGreaterEqual(total, 19)
        self.assertTrue(
            all("Settat" in row["company"]["cities_mentioned"] for row in records)
        )
        self.assertGreater(len(self.records), total)

    def test_rejects_invalid_confidence(self) -> None:
        with self.assertRaises(ValueError):
            filter_records(self.records, {"min_confidence": ["2"]})

    def test_root_handler_dispatches_companies_endpoint(self) -> None:
        status, payload, cache = route_request(
            "/api/companies?company=KLEAT&min_confidence=0.8"
        )

        self.assertEqual(status, 200)
        self.assertTrue(cache)
        self.assertEqual(payload["pagination"]["total"], 1)
        self.assertEqual(payload["records"][0]["company"]["name"], "KLEAT")


if __name__ == "__main__":
    unittest.main()
