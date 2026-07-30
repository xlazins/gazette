const NOTICE_REFERENCE_RE = /^\s*(\d{1,7})\s*([A-Z])\s*$/;
const LATIN_RE = /\p{Script=Latin}/u;
const ARABIC_RE = /\p{Script=Arabic}/u;
const COMPANY_NAME_RE = /^[\p{Script=Latin}\d][\p{Script=Latin}\d '&()./+\-]+$/u;
const LEFT_MARGIN_RATIO = 0.042;
const COLUMN_PITCH_RATIO = 0.2333;
const BODY_TOP_RATIO = 0.91;
const BODY_BOTTOM_RATIO = 0.045;

export function pageContentToLines(content, {
  pageNumber,
  pageWidth,
  pageHeight,
}) {
  const sourceItems = (content.items ?? []).filter(
    (item) => typeof item.str === "string",
  );
  if (!sourceItems.some(hasCoordinates)) {
    return fallbackLines(sourceItems, pageNumber);
  }

  const leftMargin = pageWidth * LEFT_MARGIN_RATIO;
  const columnPitch = pageWidth * COLUMN_PITCH_RATIO;
  const bodyTop = pageHeight * BODY_TOP_RATIO;
  const bodyBottom = pageHeight * BODY_BOTTOM_RATIO;
  const columns = [[], [], [], []];

  sourceItems.forEach((item, sourceIndex) => {
    if (!item.str.trim() || !hasCoordinates(item)) return;
    const x = item.transform[4];
    const y = item.transform[5];
    if (y >= bodyTop || y < bodyBottom) return;
    const column = Math.max(
      0,
      Math.min(3, Math.floor((x - leftMargin + 0.5) / columnPitch)),
    );
    columns[column].push({
      sourceIndex,
      text: item.str,
      x,
      y,
      width: item.width ?? 0,
      height: item.height ?? Math.abs(item.transform[3] ?? 0),
      dir: item.dir ?? "ltr",
      fontName: item.fontName ?? null,
    });
  });

  const lines = [];
  for (let column = 3; column >= 0; column -= 1) {
    const groups = groupColumnLines(columns[column]);
    for (const group of groups) {
      const sourceOrder = [...group.items].sort(
        (left, right) => left.sourceIndex - right.sourceIndex,
      );
      const text = joinItems(sourceOrder);
      if (!text) continue;
      const readingOrder = [...group.items].sort((left, right) => {
        if (group.isRtl) return right.x - left.x;
        return left.x - right.x;
      });
      lines.push({
        page: pageNumber,
        column,
        pageWidth,
        pageHeight,
        y: group.y,
        xMin: Math.min(...group.items.map((item) => item.x)),
        xMax: Math.max(...group.items.map((item) => item.x + item.width)),
        text,
        readingText: joinItems(readingOrder),
        fontNames: [...new Set(group.items.map((item) => item.fontName).filter(Boolean))],
        maxHeight: Math.max(...group.items.map((item) => item.height || 0)),
        isBoldCompanyName: isBoldCompanyLine(group.items, text),
      });
    }
  }
  return lines;
}

export function noticeReference(value) {
  const match = String(value ?? "").match(NOTICE_REFERENCE_RE);
  return match ? `${match[1]}${match[2]}` : null;
}

export function boldCompanyName(lines) {
  let block = [];
  for (const line of lines) {
    if (line.isBoldCompanyName) {
      if (
        block.length &&
        (
          line.page !== block.at(-1).page ||
          line.column !== block.at(-1).column ||
          Math.abs(block.at(-1).y - line.y) > 24
        )
      ) {
        return normalizeCompanyName(block);
      }
      block.push(line);
      continue;
    }
    if (block.length) return normalizeCompanyName(block);
  }
  return block.length ? normalizeCompanyName(block) : null;
}

export function noticeRegions(lines) {
  const positioned = lines.filter(
    (line) => Number.isInteger(line.column) &&
      Number.isFinite(line.pageWidth) &&
      Number.isFinite(line.pageHeight),
  );
  const groups = [];
  for (const line of positioned) {
    const current = groups.at(-1);
    if (
      !current ||
      current.page !== line.page ||
      current.column !== line.column
    ) {
      groups.push({
        page: line.page,
        column: line.column,
        pageWidth: line.pageWidth,
        pageHeight: line.pageHeight,
        lines: [line],
      });
    } else {
      current.lines.push(line);
    }
  }

  return groups.map((group) => {
    const columnLeft = (
      group.pageWidth * (
        LEFT_MARGIN_RATIO + group.column * COLUMN_PITCH_RATIO
      )
    );
    const top = Math.min(
      group.pageHeight * BODY_TOP_RATIO,
      Math.max(...group.lines.map(
        (line) => line.y + Math.max(line.maxHeight || 0, 10) * 1.05,
      )),
    );
    const bottom = Math.max(
      group.pageHeight * BODY_BOTTOM_RATIO,
      Math.min(...group.lines.map(
        (line) => line.y - Math.max(line.maxHeight || 0, 10) * 0.45,
      )),
    );
    return {
      page: group.page,
      column: group.column,
      left: roundCoordinate(Math.max(0, columnLeft - 5)),
      right: roundCoordinate(Math.min(
        group.pageWidth,
        columnLeft + group.pageWidth * COLUMN_PITCH_RATIO - 5,
      )),
      top: roundCoordinate(top),
      bottom: roundCoordinate(bottom),
      line_count: group.lines.length,
    };
  });
}

function hasCoordinates(item) {
  return (
    Array.isArray(item.transform) &&
    item.transform.length >= 6 &&
    Number.isFinite(item.transform[4]) &&
    Number.isFinite(item.transform[5])
  );
}

function fallbackLines(items, pageNumber) {
  let text = "";
  for (const item of items) {
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => ({
      page: pageNumber,
      column: null,
      pageWidth: null,
      pageHeight: null,
      y: -index,
      xMin: null,
      xMax: null,
      text: value,
      readingText: value,
      fontNames: [],
      maxHeight: 0,
      isBoldCompanyName: false,
    }));
}

function groupColumnLines(items) {
  const sorted = [...items].sort((left, right) => (
    right.y - left.y || left.x - right.x
  ));
  const groups = [];
  for (const item of sorted) {
    const current = groups.at(-1);
    if (!current || Math.abs(current.y - item.y) > 2) {
      groups.push({
        y: item.y,
        items: [item],
        isRtl: ARABIC_RE.test(item.text),
      });
      continue;
    }
    current.items.push(item);
    current.y = (
      current.y * (current.items.length - 1) + item.y
    ) / current.items.length;
    current.isRtl ||= ARABIC_RE.test(item.text);
  }
  return groups;
}

function joinItems(items) {
  return items
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isBoldCompanyLine(items, text) {
  if (
    !LATIN_RE.test(text) ||
    ARABIC_RE.test(text) ||
    !COMPANY_NAME_RE.test(text) ||
    Math.max(...items.map((item) => item.height || 0)) < 13.5
  ) {
    return false;
  }
  const letters = [...text].filter((character) => LATIN_RE.test(character));
  if (!letters.length) return false;
  const uppercaseRatio = letters.filter(
    (character) => character === character.toLocaleUpperCase(),
  ).length / letters.length;
  return uppercaseRatio >= 0.8;
}

function normalizeCompanyName(lines) {
  return lines
    .map((line) => line.text)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function roundCoordinate(value) {
  return Math.round(value * 10) / 10;
}
