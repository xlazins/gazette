const ARABIC_DIACRITICS_RE = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/gu;
const DATE_RE = /\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b|\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/g;

export function parseOcrFields({
  ocrText,
  embeddedText = "",
  companyName = null,
}) {
  const lines = normalizeOcrText(ocrText).split("\n").filter(Boolean);
  const fullText = lines.join("\n");
  const dates = unique([
    ...findDates(embeddedText),
    ...findDates(fullText),
  ]).sort();
  const filing = extractFiling(lines);
  const filingDate = filing.date;
  const decisionDate = dates.find((date) => date !== filingDate) ?? null;

  return {
    company: {
      name: companyName,
      legal_form: detectLegalForm(fullText),
      commercial_register_number: detectRegisterNumber(lines, embeddedText),
      registered_address: extractRegisteredAddress(lines),
    },
    event: {
      primary_type: detectEventType(fullText),
      decision_date: decisionDate,
      business_purpose: extractPurpose(lines),
      capital_mad: detectCapital(lines),
      branch_address: extractBranchAddress(lines),
      manager_or_liquidator: extractManager(lines),
      filing,
    },
  };
}

export function normalizeOcrText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replaceAll("\u0640", "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function fold(value) {
  return normalizeOcrText(value)
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(/[إأآٱ]/gu, "ا")
    .replaceAll("ى", "ي")
    .replaceAll("ؤ", "و")
    .replaceAll("ئ", "ي")
    .replaceAll("ة", "ه")
    .toLowerCase();
}

function compact(value) {
  return fold(value).replace(/[^\p{Letter}\p{Number}]/gu, "");
}

function detectLegalForm(text) {
  const compacted = compact(text);
  if (
    compacted.includes("شركهذاتمسووليه") &&
    compacted.includes("الشريكالوحيد")
  ) {
    return "SARL AU";
  }
  if (/(?:sarlau|sarldau)/i.test(compacted)) return "SARL AU";
  if (compacted.includes("شركهذاتمسووليه") || compacted.includes("sarl")) {
    return "SARL";
  }
  if (compacted.includes("شركهمساهمه") || /\bsa\b/i.test(fold(text))) {
    return "SA";
  }
  return null;
}

function detectEventType(text) {
  const compacted = compact(text);
  if (
    compacted.includes("انشاءفرعتابع") ||
    compacted.includes("فتحفرع") ||
    compacted.includes("creationdunesuccursale")
  ) {
    return "BRANCH_OPENING";
  }
  if (
    compacted.includes("تاسيسشركه") ||
    compacted.includes("constitutiondesociete")
  ) {
    return "INCORPORATION";
  }
  if (
    /حل.{0,24}شركه/is.test(fold(text)) ||
    compacted.includes("dissolutiondelasociete")
  ) {
    return "DISSOLUTION";
  }
  if (
    compacted.includes("تفويتالحصص") ||
    compacted.includes("اعلانتفويتالحصص") ||
    compacted.includes("cessiondeparts")
  ) {
    return "SHARE_TRANSFER";
  }
  if (compacted.includes("تصفيهالشركه")) return "LIQUIDATION";
  return null;
}

function detectRegisterNumber(lines, embeddedText) {
  for (const sourceLines of [
    normalizeOcrText(embeddedText).split("\n").filter(Boolean),
    lines,
  ]) {
    for (let index = 0; index < sourceLines.length; index += 1) {
      const label = compact(sourceLines[index]);
      if (
        !label.includes("السجلالتجاري") &&
        !label.includes("registrecommercial")
      ) {
        continue;
      }
      const context = sourceLines.slice(index, index + 3).join(" ");
      const candidates = context.match(/\b\d{3,8}\b/g) ?? [];
      const registerNumber = candidates.find(
        (value) => !/^20\d{2}$/.test(value),
      );
      if (registerNumber) return registerNumber;
    }
  }
  return null;
}

function extractRegisteredAddress(lines) {
  const value = extractBlock(lines, {
    starts: [
      (line) => compact(line).includes("عنوانمقرهاالاجتماعي"),
      (line) => compact(line).startsWith("الموقع"),
      (line) => compact(line).startsWith("siegesocial"),
    ],
    ends: [
      (line) => compact(line).includes("السجلالتجاري"),
      (line) => compact(line).startsWith("الهدف"),
      (line) => compact(line).startsWith("اليدف"),
      (line) => compact(line).startsWith("الغرض"),
      (line) => compact(line).startsWith("راسالمال"),
    ],
  });
  return cleanValue(
    value?.replace(
      /^(?:وعنوان\s+)?مقرها\s+الاجتماعي\s*:?\s*|^عنوان\s+المقر\s+الاجتماعي\s*:?\s*|^الموقع\s*:?\s*|^si[eè]ge\s+social\s*:?\s*/iu,
      "",
    ),
  );
}

function extractPurpose(lines) {
  const value = extractBlock(lines, {
    starts: [
      (line) => compact(line).startsWith("الهدف"),
      (line) => compact(line).startsWith("اليدف"),
      (line) => compact(line).includes("غرضالشركه"),
      (line) => compact(line).startsWith("objetsocial"),
    ],
    ends: [
      (line) => compact(line).startsWith("المده"),
      (line) => compact(line).startsWith("راسالمال"),
      (line) => compact(line).startsWith("التسيير"),
      (line) => compact(line).startsWith("السنهالاجتماعيه"),
      (line) => compact(line).startsWith("تمالايداعالقانوني"),
    ],
  });
  return cleanValue(
    value?.replace(
      /^(?:الهدف|اليدف|غرض\s+الشركة(?:\s+بإيجاز)?|objet\s+social)\s*:?\s*/iu,
      "",
    ),
  );
}

function extractBranchAddress(lines) {
  const value = extractBlock(lines, {
    starts: [
      (line) => compact(line).includes("الكاينبالعنوانالتالي"),
      (line) => compact(line).includes("عنوانالفرع"),
    ],
    ends: [
      (line) => compact(line).startsWith("المسير"),
      (line) => compact(line).startsWith("التسيير"),
      (line) => compact(line).startsWith("تمالايداعالقانوني"),
    ],
  });
  return cleanValue(
    value?.replace(
      /^.*?(?:الكائن|الكاين|الكاثن)\s+بالعنوان\s+التالي\s*:?\s*|^عنوان\s+الفرع\s*:?\s*/iu,
      "",
    ),
  );
}

function extractManager(lines) {
  for (const line of lines) {
    const liquidator = line.match(
      /السيد(?:ة)?\s*\)?\s*([\p{Script=Arabic} ]{3,80}?)(?=\s+(?:و\s*)?عنوان|\s+بصفته|\s+كمصفي|\s+مصفيا|$)/u,
    )?.[1];
    if (liquidator && /مصفي/u.test(line)) {
      return cleanValue(liquidator);
    }
  }
  const start = lines.findIndex((line) => {
    const value = compact(line);
    return (
      value.startsWith("المسيرمنطرف") ||
      value.startsWith("التسييرعينكمسير") ||
      value.startsWith("عينكمسير")
    );
  });
  if (start < 0) return null;

  const selected = [];
  for (let index = start; index < lines.length; index += 1) {
    if (
      index > start &&
      (
        compact(lines[index]).startsWith("السنهالاجتماعيه") ||
        compact(lines[index]).startsWith("تمالايداعالقانوني")
      )
    ) {
      break;
    }
    selected.push(lines[index]);
  }
  return cleanValue(
    selected
      .join(" ")
      .replace(
        /^.*?(?:المسير\s+من\s+طرف|التسيير\s*:\s*عين\s+كمسير\s*للشركة|عين\s+كمسير\s*للشركة)\s*:?\s*/iu,
        "",
      )
      .replace(/^\s*السيد\s*\(?ة?\)?\s*/u, ""),
  );
}

function extractFiling(lines) {
  const start = lines.findIndex(
    (line) => compact(line).includes("تمالايداعالقانوني"),
  );
  if (start < 0) return { court: null, date: null, number: null };
  const text = lines.slice(start).join(" ");
  const dates = findDates(text);
  const beforeNumber = fold(text).match(
    /(?<![./\d])(\d{1,9})\s+تحت\s*رقم/u,
  )?.[1];
  const afterNumber = fold(text).match(
    /تحت\s*رقم\s*(\d{1,9}(?:[./-]\d{1,9})*)/u,
  )?.[1];
  const court = cleanValue(
    text
      .replace(/^.*?تم\s+الإيداع\s+القانوني\s*/u, "")
      .split(/بتاريخ|\b\d{1,2}[./-]\d{1,2}[./-]20\d{2}\b/u)[0],
  );
  return {
    court,
    date: dates[0] ?? null,
    number: beforeNumber ?? afterNumber ?? null,
  };
}

function detectCapital(lines) {
  const start = lines.findIndex(
    (line) => compact(line).startsWith("راسالمال"),
  );
  if (start < 0) return null;
  const block = lines.slice(start, start + 4).join(" ");
  const match = block.match(/(\d[\d., ]{1,18})\s*درهم/u);
  if (!match) return null;
  const digits = match[1].replace(/\D/gu, "");
  return digits ? Number(digits) : null;
}

function extractBlock(lines, { starts, ends }) {
  const start = lines.findIndex((line) => starts.some((test) => test(line)));
  if (start < 0) return null;
  const selected = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && ends.some((test) => test(lines[index]))) break;
    selected.push(lines[index]);
  }
  if (!selected.length) return null;
  selected[0] = selected[0].includes(":")
    ? selected[0].split(":").slice(1).join(":")
    : selected[0];
  return cleanValue(selected.join(" "));
}

function findDates(value) {
  const dates = [];
  for (const match of normalizeOcrText(value).matchAll(DATE_RE)) {
    const year = Number(match[1] ?? match[6]);
    const month = Number(match[2] ?? match[5]);
    const day = Number(match[3] ?? match[4]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    ) {
      dates.push(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
    }
  }
  return dates;
}

function cleanValue(value) {
  const cleaned = String(value ?? "")
    .replace(/\s+/gu, " ")
    .replace(/\s+([.,،:؛])/gu, "$1")
    .trim();
  return cleaned || null;
}

function unique(values) {
  return [...new Set(values)];
}
