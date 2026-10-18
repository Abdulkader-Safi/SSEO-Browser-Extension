import { aggregate, render } from "./dist/scanner.js";
import { getIndex, getReport } from "./lib.js";

// report.html?id=<run>        one page audit
// report.html?site=<origin>   the latest audit of every page on a site, merged
// &print=1                    opens the print dialog (Save as PDF) once loaded

const params = new URLSearchParams(location.search);
const frame = document.getElementById("frame");
const titleEl = document.getElementById("title");

const report = params.has("site") ? await siteReport(params.get("site")) : await getReport(params.get("id"));

if (!report) {
  titleEl.textContent = "This report no longer exists.";
} else {
  const name = params.has("site") ? new URL(report.startUrl).host : report.startUrl;
  titleEl.textContent = `${name} · ${report.pagesScanned} page${report.pagesScanned === 1 ? "" : "s"}`;
  // The scanner's HTML is self-contained: inline styles, no scripts.
  frame.srcdoc = render(report, "html");
  await new Promise((r) => frame.addEventListener("load", r, { once: true }));

  // Name the PDF after the page; Chrome uses the printed document's title.
  const stamp = report.generatedAt.slice(0, 10);
  document.title = frame.contentDocument.title = `SSEO ${name.replace(/^https?:\/\//, "")} ${stamp}`;

  document.getElementById("pdf").addEventListener("click", printReport);
  document.getElementById("json").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    a.download = `${frame.contentDocument.title}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  if (params.get("print") === "1") printReport();
}

function printReport() {
  // Collapsed sections would print empty, so open everything first.
  frame.contentDocument.querySelectorAll("details").forEach((d) => (d.open = true));
  frame.contentWindow.print();
}

async function siteReport(origin) {
  const latest = new Map();
  for (const e of await getIndex()) if (e.origin === origin && !latest.has(e.url)) latest.set(e.url, e);
  const reports = (await Promise.all([...latest.values()].map((e) => getReport(e.id)))).filter(Boolean);
  if (!reports.length) return null;
  const newest = reports.map((r) => r.generatedAt).sort().at(-1);
  return aggregate(origin, newest, reports.flatMap((r) => r.pages));
}
