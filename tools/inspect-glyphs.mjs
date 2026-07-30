import fs from "node:fs";
import { pathToFileURL } from "node:url";

const [pdfPath, pageText, needle = "KLEAT"] = process.argv.slice(2);
const pdfjsPath = process.env.PDFJS_PATH;

if (!pdfPath || !pageText || !pdfjsPath) {
  console.error(
    "Usage: PDFJS_PATH=... node tools/inspect-glyphs.mjs issue.pdf PAGE [TEXT]",
  );
  process.exitCode = 1;
} else {
  const pdfjs = await import(pathToFileURL(pdfjsPath).href);
  const bytes = fs.readFileSync(pdfPath);
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    stopAtErrors: false,
    useSystemFonts: true,
  }).promise;
  const page = await document.getPage(Number(pageText));
  const operations = await page.getOperatorList();
  const textRuns = [];
  let font = null;

  operations.fnArray.forEach((operation, index) => {
    if (operation === pdfjs.OPS.setFont) {
      font = operations.argsArray[index]?.[0] ?? null;
      return;
    }
    if (operation !== pdfjs.OPS.showText) return;
    const glyphs = operations.argsArray[index]?.[0] ?? [];
    const decoded = glyphs
      .filter((glyph) => typeof glyph !== "number")
      .map((glyph) => glyph.unicode ?? "")
      .join("");
    textRuns.push({
      index,
      font,
      decoded,
      glyphs: glyphs.map((glyph) => (
        typeof glyph === "number"
          ? { adjustment: glyph }
          : {
              unicode: glyph.unicode,
              fontChar: glyph.fontChar,
              originalCharCode: glyph.originalCharCode,
              width: glyph.width,
            }
      )),
    });
  });

  const matchIndex = textRuns.findIndex((run) => run.decoded.includes(needle));
  console.log(JSON.stringify({
    textRunCount: textRuns.length,
    matchIndex,
    runs: matchIndex >= 0
      ? textRuns.slice(Math.max(0, matchIndex - 8), matchIndex + 12)
      : [],
  }, null, 2));
  page.cleanup();
  await document.destroy();
}
