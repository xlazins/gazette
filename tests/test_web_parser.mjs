import assert from "node:assert/strict";

import {
  extractGazetteFile,
  parseNotice,
  pdfDateToIso,
} from "../parser.mjs";
import {
  httpDateToIso,
  officialPdfSource,
  parseContentRange,
} from "../source-url.mjs";
import {
  boldCompanyName,
  noticeRegions,
  noticeReference,
  pageContentToLines,
} from "../page-layout.mjs";
import { parseOcrFields } from "../ocr-fields.mjs";

const kleat = parseNotice({
  text: `
تلو د1اية محاذت مسؤلو شركة
1وحيوذ شريكوذ
لشركةذ إنشاء فرع تابع
KLEAT
تلو د1اية محاذت مسؤلو شركة
1وحيوذ شريكوذ
الجتماعي : مجمعو رها ن موعنوا
226 لخير رقمو
تجاريوذ سجلوذ في 1يي توذ رقم
8523
لشركةذ إنشاء فرع تابع
بسطات 2026/02/26
لشركة تحتذ رر إنشاء فرع تابع ت
تالي :وذ كائن باوذ تسمية -وذ
شارع بير 2ر ا 1بن قاصم ر
8 رقم
) قنوس (1سيوذ ملسير من طرفو
يونس.
انوني باملحكمة وذ ع1وإليو تم
بتاريخ بسطات ئية1والبتو
122 تحت رقم 2026/0 /08
  `,
  pdfPages: [332],
  printedPages: ["10372"],
  reference: "677I",
}, {
  filename: "BOAL_5922.pdf",
  issueNumber: "5922",
  publicationDate: "2026-04-29",
});

assert.ok(kleat);
assert.equal(kleat.company.name, "KLEAT");
assert.equal(kleat.company.legal_form, "SARL AU");
assert.equal(kleat.company.commercial_register_number, "8523");
assert.deepEqual(kleat.company.cities_mentioned, ["Settat"]);
assert.equal(kleat.event.primary_type, "BRANCH_OPENING");
assert.equal(kleat.event.decision_date, "2026-02-26");
assert.equal(kleat.event.effective_date, null);
assert.match(kleat.event.branch_address, /شارع بير/);
assert.equal(kleat.event.manager_or_liquidator, "قنوس يونس");
assert.equal(kleat.event.filing.number, "122");

const continuation = parseNotice({
  text: `
SIGIT MAROC TFZ
شركة ذات مسؤولية محدودة
رقم السجل التجاري 136529
الاستمرار في نشاط الشركة
تقرر عدم حل الشركة والاستمرار في النشاط رغم خسارة أكثر من ثلاثة أرباع رأسمال الشركة
  `,
  pdfPages: [20],
  printedPages: ["1192"],
  reference: "24P",
}, {
  filename: "BOAL_5908.pdf",
});

assert.ok(continuation);
assert.ok(continuation.event.types.includes("CONTINUATION_AFTER_LOSSES"));
assert.ok(!continuation.event.types.includes("DISSOLUTION"));

assert.equal(pdfDateToIso("D:20260429105130+01'00'"), "2026-04-29");
assert.equal(pdfDateToIso("D:20261340"), null);
assert.equal(
  httpDateToIso("Wed, 29 Apr 2026 10:51:30 GMT"),
  "2026-04-29",
);
assert.deepEqual(
  parseContentRange("bytes 0-1048575/17876768"),
  { start: 0, end: 1048575, total: 17876768 },
);
assert.equal(parseContentRange("bytes 10-5/20"), null);
assert.equal(noticeReference(" 42 P "), "42P");

const coordinateLines = pageContentToLines({
  items: [
    textItem("Gazette header", 25, 780, 10, "regular"),
    textItem("RIGHT COMPANY", 450, 750, 14, "bold"),
    textItem("constitution societe", 450, 730, 13, "regular"),
    textItem("1A", 442, 700, 13, "regular"),
    textItem("LEFT COMPANY", 25, 750, 14, "bold"),
    textItem("constitution societe", 25, 730, 13, "regular"),
    textItem("2B", 25, 700, 13, "regular"),
  ],
}, {
  pageNumber: 1,
  pageWidth: 595.276,
  pageHeight: 841.89,
});
assert.deepEqual(
  coordinateLines.map((line) => line.text),
  [
    "RIGHT COMPANY",
    "constitution societe",
    "1A",
    "LEFT COMPANY",
    "constitution societe",
    "2B",
  ],
);
assert.equal(boldCompanyName(coordinateLines.slice(0, 2)), "RIGHT COMPANY");
assert.deepEqual(noticeRegions(coordinateLines.slice(0, 2)), [{
  page: 1,
  column: 3,
  left: 436.6,
  right: 575.5,
  top: 764.7,
  bottom: 724.2,
  line_count: 2,
}]);

const officialSource = officialPdfSource(
  "https://www.sgg.gov.ma/BO/AR/3111/2026/BOAL_5922.pdf",
);
assert.equal(officialSource.filename, "BOAL_5922.pdf");
assert.equal(
  officialSource.fetchUrl,
  "/sgg-pdf/3111/2026/BOAL_5922.pdf",
);
assert.throws(
  () => officialPdfSource("https://example.com/BOAL_5922.pdf"),
  /official sgg\.gov\.ma/i,
);

const fakeItems = [
  "ALPHA",
  "شركة ذات مسؤولية محدودة",
  "تأسيس الشركة",
  "سطات",
  "1A",
  "BETA",
  "شركة ذات مسؤولية محدودة",
  "تأسيس الشركة",
  "الرباط",
  "2B",
].map((str) => ({ str, hasEOL: true }));
const fakeDocument = {
  numPages: 1,
  getMetadata: async () => ({
    info: { CreationDate: "D:20260429105130+01'00'" },
  }),
  getPage: async () => ({
    getTextContent: async () => ({ items: fakeItems }),
    cleanup() {},
  }),
  async destroy() {},
};
const allCities = await extractGazetteFile(
  {
    name: "BOAL_6000.pdf",
    arrayBuffer: async () => new ArrayBuffer(0),
  },
  {
    city: "Settat",
    onlyCity: true,
    includeRawText: true,
  },
  {
    getDocument: () => ({ promise: Promise.resolve(fakeDocument) }),
  },
);
assert.equal(allCities.records.length, 2);
assert.equal(allCities.summary.records_all_cities, 2);
assert.equal(allCities.summary.city_filter, null);
assert.equal(allCities.summary.publication_date, "2026-04-29");
assert.deepEqual(
  allCities.records.map((record) => record.company.cities_mentioned),
  [["Settat"], ["Rabat"]],
);

const crossPageDocument = {
  numPages: 2,
  getMetadata: async () => ({ info: {} }),
  getPage: async (pageNumber) => ({
    view: [0, 0, 595.276, 841.89],
    getTextContent: async () => ({
      items: pageNumber === 1
        ? [
            textItem("Gazette header", 450, 790, 10, "regular"),
            textItem("ALPHA SERVICES", 450, 95, 14, "bold"),
            textItem("SARL", 450, 75, 12, "regular"),
          ]
        : [
            textItem("Gazette header", 450, 790, 10, "regular"),
            textItem("constitution societe", 450, 750, 12, "regular"),
            textItem("registre commercial 12345", 450, 730, 12, "regular"),
            textItem("Settat", 450, 710, 12, "regular"),
            textItem("3A", 442, 690, 10, "regular"),
          ],
    }),
    cleanup() {},
  }),
  async destroy() {},
};
const crossPage = await extractGazetteFile(
  {
    name: "BOAL_6001.pdf",
    arrayBuffer: async () => new ArrayBuffer(0),
  },
  {
    includeRawText: true,
  },
  {
    getDocument: () => ({ promise: Promise.resolve(crossPageDocument) }),
  },
);
assert.equal(crossPage.records.length, 1);
assert.equal(crossPage.records[0].company.name, "ALPHA SERVICES");
assert.deepEqual(crossPage.records[0].source.pdf_pages, [1, 2]);
assert.deepEqual(
  crossPage.records[0].source.regions.map(({ page, column }) => ({ page, column })),
  [{ page: 1, column: 3 }, { page: 2, column: 3 }],
);
assert.doesNotMatch(crossPage.records[0].raw_text, /Gazette header/);

const ocrFields = parseOcrFields({
  companyName: "KLEAT",
  ocrText: `
    شركة ذات مسؤولية محدودة ذات الشريك الوحيد
    إنشاء فرع تابع للشركة
    KLEAT
    وعنوان مقرها الاجتماعي : مجمع الخير رقم 226
    رقم التقييد في السجل التجاري
    8523
    التسمية - والكائن بالعنوان التالي:
    بن قاصم ر1 و ر2 شارع بير انزاران رقم 48
    المسير من طرف السيد(ة) قنوس
    يونس.
    تم الإيداع القانوني بالمحكمة الابتدائية بسطات بتاريخ
    2026/04/08 تحت رقم 122
  `,
  embeddedText: "بمقتضى عقد مؤرخ بتاريخ 2026/02/26 بسطات",
});
assert.equal(ocrFields.company.name, "KLEAT");
assert.equal(ocrFields.company.legal_form, "SARL AU");
assert.equal(ocrFields.company.commercial_register_number, "8523");
assert.equal(ocrFields.company.registered_address, "مجمع الخير رقم 226");
assert.equal(ocrFields.event.primary_type, "BRANCH_OPENING");
assert.equal(ocrFields.event.decision_date, "2026-02-26");
assert.equal(
  ocrFields.event.branch_address,
  "بن قاصم ر1 و ر2 شارع بير انزاران رقم 48",
);
assert.equal(ocrFields.event.manager_or_liquidator, "قنوس يونس.");
assert.equal(ocrFields.event.filing.date, "2026-04-08");
assert.equal(ocrFields.event.filing.number, "122");

const incorporationFields = parseOcrFields({
  companyName: "IMPERIAL EQUITY DEVELOPMENTS",
  ocrText: `
    تأسيس شركة ذات مسؤولية محدودة
    ذات السجل التجاري عدد 194433
    الموقع : بفيلا رقم 4 شارع بير قاسم الرباط.
    اليدف:
    الشراء والبيع والكراء للأراضي.
    المدة : 99 سنة.
    رأس المال : حدد رأسمال الشركة في 100.000 درهم.
    التسيير : عين كمسير للشركة:
    السيد محمد نادر احمد محمد الحمادي.
    تم الإيداع القانوني لدى كتابة الضبط بالمحكمة التجارية بالرباط
    بتاريخ 06/01/2026 تحت رقم 198799
  `,
});
assert.equal(incorporationFields.company.commercial_register_number, "194433");
assert.equal(incorporationFields.event.primary_type, "INCORPORATION");
assert.equal(
  incorporationFields.event.business_purpose,
  "الشراء والبيع والكراء للأراضي.",
);
assert.equal(incorporationFields.event.capital_mad, 100000);
assert.equal(
  incorporationFields.event.manager_or_liquidator,
  "محمد نادر احمد محمد الحمادي.",
);
assert.equal(incorporationFields.event.filing.date, "2026-01-06");

console.log("web parser tests passed");

function textItem(str, x, y, height, fontName) {
  return {
    str,
    transform: [height, 0, 0, height, x, y],
    width: str.length * 6,
    height,
    fontName,
    dir: "ltr",
    hasEOL: false,
  };
}
