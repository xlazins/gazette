import assert from "node:assert/strict";

import { parseNotice } from "../parser.mjs";

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

console.log("web parser tests passed");
