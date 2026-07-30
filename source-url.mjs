const SGG_HOSTS = new Set(["sgg.gov.ma", "www.sgg.gov.ma"]);

export function officialPdfSource(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("Enter a valid official SGG PDF link.");
  }

  if (url.protocol !== "https:" || !SGG_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("The link must use the official sgg.gov.ma website.");
  }

  const match = url.pathname.match(
    /^\/BO\/AR\/([^/]+)\/(\d{4})\/([^/]+\.pdf)$/i,
  );
  if (!match) {
    throw new Error("Paste a direct SGG BOAL link ending in .pdf.");
  }

  const [, collection, year, encodedFilename] = match;
  const filename = decodeURIComponent(encodedFilename);
  return {
    originalUrl: url.href,
    filename,
    fetchUrl: [
      "/sgg-pdf",
      encodeURIComponent(collection),
      encodeURIComponent(year),
      encodeURIComponent(filename),
    ].join("/"),
  };
}

export function httpDateToIso(value) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function parseContentRange(value) {
  const match = String(value ?? "").match(
    /^bytes\s+(\d+)-(\d+)\/(\d+)$/i,
  );
  if (!match) return null;
  const [, startText, endText, totalText] = match;
  const start = Number(startText);
  const end = Number(endText);
  const total = Number(totalText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    return null;
  }
  return { start, end, total };
}
