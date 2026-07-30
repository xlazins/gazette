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

console.log("web parser tests passed");
