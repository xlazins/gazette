import {
  boldCompanyName,
  noticeRegions,
  noticeReference,
  pageContentToLines,
} from "./page-layout.mjs";

const SCHEMA_VERSION = "1.0.0";
const ARABIC_DIACRITICS_RE = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/gu;
const ARABIC_DIGITS = new Map([
  ["٠", "0"], ["١", "1"], ["٢", "2"], ["٣", "3"], ["٤", "4"],
  ["٥", "5"], ["٦", "6"], ["٧", "7"], ["٨", "8"], ["٩", "9"],
  ["۰", "0"], ["۱", "1"], ["۲", "2"], ["۳", "3"], ["۴", "4"],
  ["۵", "5"], ["۶", "6"], ["۷", "7"], ["۸", "8"], ["۹", "9"],
]);

const EVENT_RULES = [
  ["CONTINUATION_AFTER_LOSSES", [
    /عدم\s+حل.*الاستمرار\s+في\s+النشاط/is,
    /continuation\s+de\s+l.?activit/is,
  ]],
  ["REMOVAL_FROM_REGISTER", [
    /التشطيب\s+(?:النهائي\s+)?من\s+السجل\s+التجاري/is,
    /radiation\s+(?:definitive\s+)?du\s+registre/is,
  ]],
  ["LIQUIDATION_CLOSED", [
    /(?:اغلاق|قفل|اختتام|ختم)\s+(?:ال\w+\s+)?(?:اعمال\s+)?التصفيه/is,
    /cloture\s+(?:definitive\s+)?de\s+(?:la\s+)?liquidation/is,
  ]],
  ["DISSOLUTION", [
    /(?:حل|انحلال)(?:\s+(?:وذ|ذ|ال|لل|مسبق|مبكر)){0,3}\s+شركه/is,
    /حل\s+الشركه\s+قبل\s+الاوان/is,
    /dissolution\s+(?:anticipee\s+)?(?:de\s+la\s+)?societe/is,
  ]],
  ["LIQUIDATION", [
    /(?:تعيين|تسميه).{0,40}(?:مصفي|مصفية)/is,
    /تصفيه\s+(?:لل)?شركه/is,
    /mise\s+en\s+liquidation/is,
  ]],
  ["BRANCH_OPENING", [
    /انشاء\s+فرع/is,
    /فتح\s+فرع/is,
    /creation\s+d.?une\s+succursale/is,
  ]],
  ["INCORPORATION", [
    /تاسيس\s+(?:ال)?شركه/is,
    /اعلان\s+عن\s+تاسيس/is,
    /constitution\s+(?:d.?une\s+)?societe/is,
  ]],
  ["BUSINESS_PURPOSE_CHANGE", [
    /(?:تغيير|تعديل).{0,30}غرض\s+(?:ال)?شركه/is,
    /modification\s+de\s+l.?objet\s+social/is,
  ]],
  ["REGISTERED_OFFICE_CHANGE", [
    /(?:تحويل|تغيير).{0,35}المقر\s+الاجتماعي/is,
    /transfert\s+(?:du\s+)?siege\s+social/is,
  ]],
  ["LEGAL_FORM_CHANGE", [
    /تغيير\s+الشكل\s+القانوني/is,
    /transformation\s+(?:de\s+la\s+)?forme\s+juridique/is,
  ]],
  ["CAPITAL_CHANGE", [
    /(?:رفع|زياده|تخفيض).{0,30}راسما?ل/is,
    /(?:augmentation|reduction)\s+(?:du\s+)?capital/is,
  ]],
  ["MANAGER_CHANGE", [
    /(?:تعيين|استقاله|عزل|تغيير).{0,35}(?:مسير|مدير)/is,
    /(?:nomination|demission|revocation).{0,30}(?:gerant|administrateur)/is,
  ]],
  ["SHARE_TRANSFER", [
    /(?:تفويت|تحويل).{0,30}(?:حصص|اسهم)/is,
    /cession\s+(?:de\s+)?(?:parts|actions)/is,
  ]],
];

const CITY_PATTERNS = new Map([
  ["Settat", [/سطات/i, /\bsettat\b/i]],
  ["Casablanca", [/الدار\s+البيضاء/i, /\bcasablanca\b/i]],
  ["Rabat", [/الرباط/i, /\brabat\b/i]],
  ["Sale", [/سلا/i, /\bsal[eé]\b/i]],
  ["Temara", [/تماره/i, /\btemara\b/i, /\bt[eé]mara\b/i]],
  ["Marrakech", [/مراكش/i, /\bmarrakech\b/i]],
  ["Tangier", [/طنجه/i, /\btanger\b/i, /\btangier\b/i]],
  ["Tetouan", [/تطوان/i, /\bt[eé]touan\b/i, /\btetouan\b/i]],
  ["Fes", [/فاس/i, /\bfes\b/i, /\bfez\b/i]],
  ["Meknes", [/مكناس/i, /\bmeknes\b/i, /\bmekn[eè]s\b/i]],
  ["Agadir", [/اكادير/i, /\bagadir\b/i]],
  ["Inezgane", [/انزكان/i, /\binezgane\b/i]],
  ["Ait Melloul", [/ايت\s+ملول/i, /\ba[iï]t\s+melloul\b/i]],
  ["Kenitra", [/القنيطره/i, /\bkenitra\b/i, /\bk[eé]nitra\b/i]],
  ["El Jadida", [/الجديده/i, /\bel\s+jadida\b/i]],
  ["Mohammedia", [/المحمديه/i, /\bmohammedia\b/i]],
  ["Beni Mellal", [/بني\s+ملال/i, /\bbeni\s+mellal\b/i]],
  ["Oujda", [/وجده/i, /\boujda\b/i]],
  ["Nador", [/الناظور/i, /\bnador\b/i]],
  ["Berkane", [/بركان/i, /\bberkane\b/i]],
  ["Safi", [/اسفي/i, /\bsafi\b/i]],
  ["Khouribga", [/خريبكه/i, /\bkhouribga\b/i]],
  ["Berrechid", [/برشيد/i, /\bberrechid\b/i]],
  ["Benslimane", [/بنسليمان/i, /\bbenslimane\b/i]],
  ["Bouskoura", [/بوسكوره/i, /\bbouskoura\b/i]],
  ["Nouaceur", [/النواصر/i, /\bnouaceur\b/i]],
  ["Mediouna", [/مديونه/i, /\bmediouna\b/i]],
  ["Larache", [/العرائش/i, /\blarache\b/i]],
  ["Ksar El Kebir", [/القصر\s+الكبير/i, /\bksar\s+el\s+kebir\b/i]],
  ["Taza", [/تازه/i, /\btaza\b/i]],
  ["Ifrane", [/افران/i, /\bifrane\b/i]],
  ["Khenifra", [/خنيفـ?ره/i, /\bkhenifra\b/i]],
  ["Errachidia", [/الرشيديه/i, /\berrachidia\b/i]],
  ["Ouarzazate", [/ورزازات/i, /\bouarzazate\b/i]],
  ["Essaouira", [/الصويره/i, /\bessaouira\b/i]],
  ["Taroudant", [/تارودانت/i, /\btaroudant\b/i]],
  ["Tiznit", [/تزنيت/i, /\btiznit\b/i]],
  ["Guelmim", [/كلميم/i, /\bguelmim\b/i]],
  ["Laayoune", [/العيون/i, /\blaa?youne\b/i]],
  ["Dakhla", [/الداخله/i, /\bdakhla\b/i]],
  ["Sidi Kacem", [/سيدي\s+قاسم/i, /\bsidi\s+kacem\b/i]],
  ["Sidi Slimane", [/سيدي\s+سليمان/i, /\bsidi\s+slimane\b/i]],
  ["Ouezzane", [/وزان/i, /\bouezzane\b/i]],
  ["Chefchaouen", [/شفشاون/i, /\bchefchaouen\b/i]],
  ["Al Hoceima", [/الحسيمه/i, /\bal\s+hoceima\b/i]],
  ["Benguerir", [/بنجرير/i, /\bbenguerir\b/i]],
  ["Youssoufia", [/اليوسفيه/i, /\byoussoufia\b/i]],
]);

const MONTH_NUMBERS = new Map([
  ["يناير", 1], ["فبراير", 2], ["مارس", 3], ["ابريل", 4],
  ["ماي", 5], ["يونيو", 6], ["يوليوز", 7], ["غشت", 8],
  ["شتنبر", 9], ["اكتوبر", 10], ["نونبر", 11], ["دجنبر", 12],
  ["janvier", 1], ["fevrier", 2], ["mars", 3], ["avril", 4],
  ["mai", 5], ["juin", 6], ["juillet", 7], ["aout", 8],
  ["septembre", 9], ["octobre", 10], ["novembre", 11], ["decembre", 12],
]);

const GENERIC_LATIN_LINES = new Set([
  "SARL", "SARLAU", "SARL AU", "S.A.R.L", "S.A.R.L.AU", "SA", "S.A", "SAS",
  "RC", "ICE", "MAROC", "MOROCCO",
]);

const SUSPECT_FONT_TERMS = [
  "وذشريك", "وذوحي", "مسواذيه", "مسؤلو", "محاذ", "شريكوذ", "وحيوذ",
];

export class ExtractionCancelledError extends Error {
  constructor() {
    super("Extraction cancelled");
    this.name = "ExtractionCancelledError";
  }
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[٠-٩۰-۹]/gu, (digit) => ARABIC_DIGITS.get(digit) ?? digit)
    .replace(/[\u00a0\u200e\u200f]/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .trim();
}

export function foldArabic(value) {
  return normalizeText(value)
    .replace(ARABIC_DIACRITICS_RE, "")
    .replaceAll("ـ", "")
    .replace(/[إأآٱ]/gu, "ا")
    .replaceAll("ى", "ي")
    .replaceAll("ؤ", "و")
    .replaceAll("ئ", "ي")
    .replaceAll("ة", "ه")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function textContentToText(content) {
  let text = "";
  for (const item of content.items ?? []) {
    if (typeof item.str !== "string") continue;
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return normalizeText(text);
}

export function inferIssueNumber(filename) {
  return String(filename ?? "").match(/BOAL[_-](\d+(?:-bis)?)/i)?.[1] ?? null;
}

export function pdfDateToIso(value) {
  const match = String(value ?? "").match(/(?:D:)?(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

export async function extractGazetteFile(file, options, pdfjs, callbacks = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    stopAtErrors: false,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const issueNumber =
    options.issueNumber ||
    inferIssueNumber(file.name) ||
    inferIssueNumber(options.sourceUrl);
  let publicationDate = options.publicationDate || null;
  if (!publicationDate) {
    try {
      const metadata = await document.getMetadata();
      publicationDate = pdfDateToIso(
        metadata?.info?.CreationDate ||
        metadata?.info?.ModDate ||
        metadata?.metadata?.get?.("dc:date"),
      );
    } catch {
      publicationDate = null;
    }
  }
  if (!publicationDate) {
    publicationDate = options.fallbackPublicationDate || null;
  }
  const records = [];
  let segmentCount = 0;
  let pendingLines = [];
  let pendingLayoutLines = [];
  let pendingPages = [];
  let pendingPrintedPages = [];

  const flushSegment = (reference) => {
    const text = pendingLines.join("\n").trim();
    if (text) {
      segmentCount += 1;
      const record = parseNotice({
        text,
        pdfPages: [...pendingPages],
        printedPages: [...pendingPrintedPages],
        reference,
        companyNameHint: boldCompanyName(pendingLayoutLines),
        sourceRegions: noticeRegions(pendingLayoutLines),
      }, {
        filename: file.name,
        issueNumber,
        publicationDate,
        sourceUrl: options.sourceUrl || null,
        includeRawText: options.includeRawText !== false,
      });
      if (record) {
        records.push(record);
      }
    }
    pendingLines = [];
    pendingLayoutLines = [];
    pendingPages = [];
    pendingPrintedPages = [];
  };

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (callbacks.shouldCancel?.()) throw new ExtractionCancelledError();
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const rawPageText = textContentToText(content);
      const printedPage = detectPrintedPage(rawPageText, issueNumber);
      const pageLines = pageContentToLines(content, {
        pageNumber,
        pageWidth: page.view?.[2] ?? 595.276,
        pageHeight: page.view?.[3] ?? 841.89,
      });

      for (const line of pageLines) {
        const reference = noticeReference(line.text);
        if (reference) {
          flushSegment(reference);
          continue;
        }
        if (!line.text.trim()) continue;
        pendingLines.push(line.readingText);
        pendingLayoutLines.push(line);
        if (pendingPages.at(-1) !== pageNumber) pendingPages.push(pageNumber);
        if (printedPage && pendingPrintedPages.at(-1) !== printedPage) {
          pendingPrintedPages.push(printedPage);
        }
      }

      callbacks.onProgress?.({
        page: pageNumber,
        totalPages: document.numPages,
        segments: segmentCount,
        records: records.length,
      });
      page.cleanup();
      if (pageNumber % 4 === 0) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
  } finally {
    await document.destroy();
  }

  return {
    schema_version: SCHEMA_VERSION,
    summary: {
      records: records.length,
      records_all_cities: records.length,
      segments_examined: segmentCount,
      document_pages: document.numPages,
      records_needing_review: records.filter((record) => record.needs_review).length,
      city_filter: null,
      publication_date: publicationDate,
      filename: file.name,
    },
    records,
  };
}

function detectPrintedPage(text, issueNumber) {
  const header = text.split("\n").slice(0, 5).join("\n");
  const candidates = [...header.matchAll(/\b\d{3,6}\b/g)]
    .map((match) => match[0])
    .filter((value) => {
      const number = Number(value);
      return value !== issueNumber && !(number >= 1300 && number <= 2100) && number < 100000;
    })
    .map(Number);
  return candidates.length ? String(Math.max(...candidates)) : null;
}

export function parseNotice(segment, metadata = {}) {
  let text = normalizeText(segment.text);
  let truncated = false;
  if (text.length > 20000) {
    text = text.slice(-20000);
    truncated = true;
  }
  const folded = foldArabic(text);
  const eventTypes = detectEventTypes(folded);
  if (!eventTypes.length) return null;

  const lines = compactLines(text);
  const companyName = segment.companyNameHint || detectCompanyName(text);
  const legalForm = detectLegalForm(text);
  const registerNumber = detectRegisterNumber(lines, companyName);
  const dates = detectDates(text);
  const cities = detectCities(folded);
  const registeredAddress = fieldBlock(
    lines,
    (line) => /(?:اجتماعي|جتماعي)/i.test(line),
    3,
  );
  const purpose = fieldBlock(
    lines,
    (line) => /غرض.{0,30}(?:شرك|ايجاز|إيجاز)/i.test(line),
    8,
  );
  const branchAddress = eventTypes.includes("BRANCH_OPENING")
    ? detectBranchAddress(lines)
    : null;
  const manager = detectManagerOrLiquidator(lines);
  const filing = detectFiling(lines, dates);
  const capital = detectCapital(text);
  const suspectFontMapping = SUSPECT_FONT_TERMS.filter((term) => folded.includes(term)).length >= 2;

  const reviewReasons = [];
  if (truncated) reviewReasons.push("notice_text_trimmed_after_20000_characters");
  if (text.includes("\ufffd")) reviewReasons.push("source_text_has_unmapped_glyphs");
  if (suspectFontMapping) reviewReasons.push("source_text_has_suspect_font_mapping");
  if (!companyName) reviewReasons.push("company_name_missing");
  if (!registerNumber) reviewReasons.push("commercial_register_number_missing");
  if (!legalForm) reviewReasons.push("legal_form_missing");
  if (!dates.length) reviewReasons.push("event_date_missing");
  if (eventTypes.includes("BRANCH_OPENING") && !branchAddress) {
    reviewReasons.push("branch_address_missing");
  }
  if (
    eventTypes.some((event) => ["DISSOLUTION", "LIQUIDATION"].includes(event))
    && !manager
  ) {
    reviewReasons.push("liquidator_missing");
  }
  if (!cities.length) reviewReasons.push("city_not_detected");

  let confidence = 0.30;
  if (companyName) confidence += 0.25;
  if (registerNumber) confidence += 0.15;
  if (legalForm) confidence += 0.10;
  if (dates.length) confidence += 0.10;
  if (cities.length) confidence += 0.05;
  if (branchAddress || purpose || manager) confidence += 0.05;
  if (text.includes("\ufffd") || suspectFontMapping) confidence -= 0.10;
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));

  return {
    schema_version: SCHEMA_VERSION,
    source: {
      series: "BOAL",
      issue_number: metadata.issueNumber || null,
      publication_date: metadata.publicationDate || null,
      pdf_path: metadata.filename || null,
      source_url: metadata.sourceUrl || null,
      pdf_pages: segment.pdfPages ?? [],
      printed_pages: segment.printedPages ?? [],
      notice_reference: segment.reference ?? null,
      regions: segment.sourceRegions ?? [],
    },
    company: {
      name: companyName,
      legal_form: legalForm,
      commercial_register_number: registerNumber,
      registered_address: registeredAddress,
      cities_mentioned: cities,
    },
    event: {
      primary_type: eventTypes[0],
      types: eventTypes,
      decision_date: dates[0] ?? null,
      effective_date: dates[1] ?? null,
      business_purpose: purpose,
      capital_mad: capital,
      branch_address: branchAddress,
      manager_or_liquidator: manager,
      filing,
    },
    confidence,
    needs_review: reviewReasons.length > 0 || confidence < 0.85,
    review_reasons: reviewReasons,
    raw_text: metadata.includeRawText === false ? null : text,
  };
}

function compactLines(text) {
  return normalizeText(text).split("\n").map((line) => line.trim()).filter(Boolean);
}

function detectEventTypes(folded) {
  const found = EVENT_RULES
    .filter(([, rules]) => rules.some((rule) => rule.test(folded)))
    .map(([event]) => event);
  if (found.includes("CONTINUATION_AFTER_LOSSES")) {
    const dissolution = found.indexOf("DISSOLUTION");
    if (dissolution >= 0) found.splice(dissolution, 1);
  }
  return found;
}

function detectCompanyName(text) {
  const lines = compactLines(text);
  const candidates = [];
  lines.forEach((line, index) => {
    const cleaned = line.replace(/\s+/g, " ").replace(/^[ .,:;-]+|[ .,:;-]+$/g, "");
    if (cleaned.length < 2 || cleaned.length > 100) return;
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9&'()./+\- ]+$/.test(cleaned)) return;
    const letters = [...cleaned].filter((char) => /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(char));
    if (!letters.length) return;
    const uppercase = letters.filter((char) => char === char.toUpperCase()).length / letters.length;
    if (uppercase < 0.75 || GENERIC_LATIN_LINES.has(cleaned.toUpperCase())) return;
    if (/^\d+\s*[A-Z]$/.test(cleaned)) return;
    candidates.push({ value: cleaned, index });
  });

  if (candidates.length) {
    const counts = new Map();
    for (const candidate of candidates) {
      counts.set(candidate.value, (counts.get(candidate.value) ?? 0) + 1);
    }
    const score = (candidate) => {
      let value = (counts.get(candidate.value) ?? 0) * 2;
      if (detectLegalForm(lines[candidate.index])) value += 5;
      if (detectLegalForm(lines[candidate.index + 1] ?? "")) value += 7;
      if (candidate.index > 0 && detectEventTypes(foldArabic(lines[candidate.index - 1])).length) {
        value += 4;
      }
      if (detectEventTypes(foldArabic(lines[candidate.index + 1] ?? "")).length) value += 3;
      return value * 1000 + candidate.value.length;
    };
    return candidates.toSorted((left, right) => score(right) - score(left))[0].value;
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (!foldArabic(lines[index]).includes("تسميه")) continue;
    const afterColon = lines[index].split(":", 2)[1]?.trim() ?? "";
    if (validArabicName(afterColon)) return afterColon;
    if (validArabicName(lines[index + 1] ?? "")) return lines[index + 1].trim();
  }
  return null;
}

function validArabicName(value) {
  if (value.length < 2 || value.length > 100 || !/[\u0600-\u06ff]/u.test(value)) return false;
  const folded = foldArabic(value);
  return !["تسميتها", "تسميه", "مختصر", "الاقتضاء", "متبوعه"].some(
    (term) => folded.includes(term),
  );
}

function detectLegalForm(text) {
  const original = normalizeText(text).toUpperCase();
  const folded = foldArabic(text);
  if (/\bS\.?\s*A\.?\s*R\.?\s*L\.?\s*A\.?\s*U\.?\b|\bSARLAU\b|\bSARL\s+AU\b/i.test(original)) {
    return "SARL AU";
  }
  if (
    /(?:شركه|شركة).{0,140}(?:شريك).{0,35}(?:وحيد|وحي)/is.test(folded)
    || /(?:وحيد|وحي).{0,35}(?:شريك).{0,140}(?:شركه|شركة)/is.test(folded)
  ) {
    return "SARL AU";
  }
  if (/\bS\.?\s*A\.?\s*R\.?\s*L\.?\b|\bSARL\b/i.test(original)) return "SARL";
  if (/\bS\.?\s*A\.?\s*S\.?\b|\bSAS\b/i.test(original)) return "SAS";
  if (/\bS\.?\s*A\.?\b|\bSA\b/i.test(original)) return "SA";
  if (
    /شركه.{0,70}(?:مسووليه|مسؤوليه|مسؤلو|مسواذيه|محاذ)/is.test(folded)
    || /(?:مسووليه|مسؤوليه|مسؤلو|مسواذيه|محاذ).{0,70}شركه/is.test(folded)
  ) {
    return "SARL";
  }
  if (/شركه\s+مساهمه/is.test(folded)) return "SA";
  return null;
}

function detectRegisterNumber(lines, companyName) {
  const joined = lines.join("\n");
  const explicit = [
    /(?:السجل.{0,20}التجاري|التجاري.{0,20}السجل)[^\d]{0,45}(\d{2,10})/is,
    /(?:registre\s+de\s+commerce|registre\s+commercial|\bRC\b)[^\d]{0,20}(\d{2,10})/is,
  ];
  for (const pattern of explicit) {
    const value = joined.match(pattern)?.[1];
    if (validRegisterNumber(value)) return value;
  }
  if (!companyName) return null;
  const companyIndex = Math.max(0, lines.findIndex((line) => line.includes(companyName)));
  let dateIndex = lines.findIndex((line, index) => index > companyIndex && /20\d{2}/.test(line));
  if (dateIndex < 0) dateIndex = Math.min(lines.length, companyIndex + 30);
  const window = lines.slice(companyIndex + 1, dateIndex);
  const candidates = [];
  window.forEach((line, index) => {
    const value = line.match(/^\D*(\d{2,10})\D*$/)?.[1];
    if (!validRegisterNumber(value)) return;
    const context = window.slice(Math.max(0, index - 2), index + 1).map(foldArabic).join(" ");
    if (/رقم|سجل|registre/i.test(context)) candidates.push(value);
  });
  return candidates.toSorted((left, right) => Number(right) - Number(left))[0] ?? null;
}

function validRegisterNumber(value) {
  if (!value) return false;
  const number = Number(value);
  return number > 31 && !(number >= 1900 && number <= 2100) && number !== 26000;
}

function detectDates(text) {
  const normalized = normalizeText(text).replace(/\s*\/\s*/g, "/");
  const values = [];
  for (const match of normalized.matchAll(/20\d{2}\/\d{1,2}\/\d{1,2}/g)) {
    const value = normalizeDate(match[0]);
    if (value && !values.includes(value)) values.push(value);
  }
  const folded = foldArabic(text);
  const monthNames = [...MONTH_NUMBERS.keys()].toSorted((a, b) => b.length - a.length);
  const months = monthNames.map(escapeRegex).join("|");
  const patterns = [
    new RegExp(`\\b(20\\d{2})\\s*(${months})\\s*([0-3]?\\d)(?!\\d)`, "giu"),
    new RegExp(`\\b([0-3]?\\d)\\s*(${months})\\s*(20\\d{2})(?!\\d)`, "giu"),
  ];
  patterns.forEach((pattern, patternIndex) => {
    for (const match of folded.matchAll(pattern)) {
      const [year, monthName, day] = patternIndex === 0
        ? [match[1], match[2], match[3]]
        : [match[3], match[2], match[1]];
      const value = normalizeDate(`${year}/${MONTH_NUMBERS.get(monthName.toLowerCase())}/${day}`);
      if (value && !values.includes(value)) values.push(value);
    }
  });
  return values;
}

function normalizeDate(value) {
  const match = value.match(/^(20\d{2})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
    return null;
  }
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function detectCities(folded) {
  return [...CITY_PATTERNS.entries()]
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(folded)))
    .map(([city]) => city);
}

export function detectCitiesFromText(text) {
  return detectCities(foldArabic(text));
}

function fieldBlock(lines, matchesLabel, maxFollowing) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!matchesLabel(foldArabic(lines[index]))) continue;
    const values = [];
    const afterColon = lines[index].split(":", 2)[1]?.trim().replace(/^-+/, "").trim();
    if (afterColon) values.push(afterColon);
    for (const following of lines.slice(index + 1, index + 1 + maxFollowing)) {
      if (looksLikeLabel(following)) break;
      values.push(following);
    }
    return cleanField(values.join(" "));
  }
  return null;
}

function looksLikeLabel(line) {
  const folded = foldArabic(line);
  return folded.startsWith("رقم") || [
    "السجل التجاري", "تجاري", "غرض الشركه", "راس مال", "راسمال",
    "بمقتضي", "تم الايداع", "انشاء فرع", "تاسيس شركه", "حل الشركه", "حل شركه",
  ].some((term) => folded.includes(term));
}

function detectBranchAddress(lines) {
  const indexes = lines
    .map((line, index) => [foldArabic(line), index])
    .filter(([line]) => /انشاء\s+فرع|فتح\s+فرع/.test(line))
    .map(([, index]) => index);
  if (!indexes.length) return null;
  const start = indexes.at(-1);
  const values = [];
  let collecting = /كائن|كاين|عنوان\s+التالي|عنوان\s+تالي/.test(foldArabic(lines[start]));
  for (const line of lines.slice(start, start + 13)) {
    const folded = foldArabic(line);
    if (/مسير|ملسير|مصفي|تم\s+الايداع/.test(folded) && values.length) break;
    if (!collecting && /كائن|كاين|عنوان\s+التالي|عنوان\s+تالي/.test(folded)) {
      collecting = true;
    }
    if (!collecting) continue;
    const suffix = line.includes(":") ? line.split(":", 2)[1] : line;
    if (suffix.trim()) values.push(suffix.trim());
  }
  return cleanField(values.join(" "));
}

function detectManagerOrLiquidator(lines) {
  const stopwords = new Set([
    "المسير", "ملسير", "المصفي", "مصفي", "مصفية", "من", "طرف", "السيد", "السيدة",
    "تعيين", "وذ", "و",
  ]);
  for (let index = 0; index < lines.length; index += 1) {
    const folded = foldArabic(lines[index]);
    if (!/(?:المسير|ملسير|مصفي|مصفية)/.test(folded)) continue;
    const source = `${lines[index]} ${lines[index + 1] ?? ""}`;
    const words = source.match(/[\u0600-\u06ff]{2,}/gu) ?? [];
    const names = words.filter((word) => {
      const foldedWord = foldArabic(word);
      return !stopwords.has(foldedWord)
        && !["سي", "سيوذ"].includes(foldedWord)
        && !["مسير", "ملسير", "مصفي", "طرف", "سيد", "تعيين"].some(
          (term) => foldedWord.includes(term),
        );
    });
    const value = names.slice(-4).join(" ").replace(/[.,:;-]+$/g, "").trim();
    if (value.length >= 3 && !/\b\d{5}\b/.test(value)) return value;
  }
  return null;
}

function detectFiling(lines, dates) {
  let court = null;
  let filingIndex = -1;
  lines.forEach((line, index) => {
    const folded = foldArabic(line);
    if (/(?:محكم|ملحكم)/.test(folded)) {
      court = line.replace(/^[ .,:;-]+|[ .,:;-]+$/g, "");
    }
    if (
      /ايداع|اليداع|الي/.test(folded)
      || (/(?:محكم|ملحكم)/.test(folded) && /تم/.test(folded))
    ) {
      filingIndex = index;
    }
  });
  let number = null;
  if (filingIndex >= 0) {
    const tail = lines.slice(filingIndex, filingIndex + 6).join(" ");
    const beforeLabel = tail.match(/(\d{1,10})\s+تحت\s+رقم/i)?.[1] ?? null;
    const afterLabel = tail.match(/تحت\s+رقم\s*[:\-]?\s*(\d{1,10})/i)?.[1] ?? null;
    number = validFilingNumber(beforeLabel)
      ? beforeLabel
      : validFilingNumber(afterLabel)
        ? afterLabel
        : null;
  }
  return {
    court,
    date: dates.length > 1 ? dates.at(-1) : null,
    number,
  };
}

function detectCapital(text) {
  const normalized = normalizeText(text);
  const patterns = [
    /(?:رأس\s*مال|رأسمال|راسمال)[^\d]{0,30}([\d .]{3,20})\s*(?:درهم|د\.?\s*م)/i,
    /capital[^\d]{0,20}([\d .]{3,20})\s*(?:dhs?|mad)/i,
  ];
  for (const pattern of patterns) {
    const raw = normalized.match(pattern)?.[1];
    if (raw) {
      const digits = raw.replace(/\D/g, "");
      if (digits) return Number(digits);
    }
  }
  return null;
}

function cleanField(value) {
  const cleaned = value.replace(/\s+/g, " ").replace(/^[ .,:;-]+|[ .,:;-]+$/g, "");
  return cleaned || null;
}

function validFilingNumber(value) {
  if (!value) return false;
  const number = Number(value);
  return number > 0 && !(number >= 1900 && number <= 2100);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
