from __future__ import annotations

import unittest

from gazette_extractor.models import RawNoticeSegment
from gazette_extractor.parser import GazetteNoticeParser


KLEAT_NOTICE = """
KLEAT
شركة ذات مسؤولية محدودة ذات الشريك الوحيد
وعنوان مقرها الاجتماعي : مجمع الخير رقم 226
رقم التقييد في السجل التجاري 8523
إنشاء فرع تابع للشركة
بمقتضى عقد مؤرخ بتاريخ 2026/02/26 بسطات
تقرر إنشاء فرع تابع للشركة تحت التسمية - والكائن بالعنوان التالي :
بن قاسم ر1 و ر2 شارع بئر أنزران رقم 48
المسير من طرف السيد قنوس يونس.
تم الإيداع القانوني بالمحكمة الابتدائية بسطات بتاريخ
2026/04/08 تحت رقم 122
""".strip()


class GazetteNoticeParserTest(unittest.TestCase):
    def test_extracts_kleat_branch_event(self) -> None:
        parser = GazetteNoticeParser(
            pdf_path="BOAL_5922.pdf",
            issue_number="5922",
            publication_date="2026-04-29",
        )
        segment = RawNoticeSegment(
            text=KLEAT_NOTICE,
            pdf_pages=[332],
            printed_pages=["10372"],
            reference="677I",
        )

        result = parser.parse(segment)

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.company.name, "KLEAT")
        self.assertEqual(result.company.legal_form, "SARL AU")
        self.assertEqual(result.company.commercial_register_number, "8523")
        self.assertEqual(result.company.cities_mentioned, ["Settat"])
        self.assertEqual(result.event.primary_type, "BRANCH_OPENING")
        self.assertEqual(result.event.decision_date, "2026-02-26")
        self.assertEqual(result.event.effective_date, "2026-04-08")
        self.assertIn("بن قاسم", result.event.branch_address or "")
        self.assertIn("قنوس يونس", result.event.manager_or_liquidator or "")
        self.assertEqual(result.event.filing.number, "122")

    def test_continuation_notice_is_not_dissolution(self) -> None:
        parser = GazetteNoticeParser(pdf_path="BOAL_5908.pdf")
        segment = RawNoticeSegment(
            text="""
SIGIT MAROC TFZ
شركة ذات مسؤولية محدودة
رقم السجل التجاري 136529
الاستمرار في نشاط الشركة
تقرر عدم حل الشركة والاستمرار في النشاط رغم خسارة أكثر من ثلاثة أرباع رأسمال الشركة
""",
            pdf_pages=[20],
            printed_pages=["1192"],
            reference="24P",
        )

        result = parser.parse(segment)

        self.assertIsNotNone(result)
        assert result is not None
        self.assertIn("CONTINUATION_AFTER_LOSSES", result.event.types)
        self.assertNotIn("DISSOLUTION", result.event.types)

    def test_keeps_unknown_arabic_name_null_instead_of_using_label_text(self) -> None:
        parser = GazetteNoticeParser(pdf_path="BOAL_5922.pdf")
        segment = RawNoticeSegment(
            text="""
تأسيس شركة
تسمية الشركة، متبوعة عند الاقتضاء، بمختصر تسميتها:
والاقتضاء، بمختصر تسميتها
بسطات
""",
            pdf_pages=[10],
            printed_pages=["10050"],
            reference="10I",
        )

        result = parser.parse(segment)

        self.assertIsNotNone(result)
        assert result is not None
        self.assertIsNone(result.company.name)
        self.assertIn("company_name_missing", result.review_reasons)

    def test_prefers_subject_company_over_legal_advertiser(self) -> None:
        parser = GazetteNoticeParser(pdf_path="BOAL_5922.pdf")
        segment = RawNoticeSegment(
            text="""
FORMAFID CONSEIL
SAFRES
شركة ذات مسؤولية محدودة ذات الشريك الوحيد
حل شركة
FORMAFID CONSEIL
N 33 BOULEVARD LARBI SETTAT MAROC
بمقتضى عقد مؤرخ في 27 مارس 2026 تقرر حل شركة SAFRES
رقم السجل التجاري 5059
""",
            pdf_pages=[375],
            printed_pages=["10415"],
            reference="819I",
        )

        result = parser.parse(segment)

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.company.name, "SAFRES")
        self.assertEqual(result.event.primary_type, "DISSOLUTION")
        self.assertEqual(result.event.decision_date, "2026-03-27")


if __name__ == "__main__":
    unittest.main()
