import { aggregate } from "./dist/scanner.js";
import { getIndex, getReport } from "./lib.js";
import { mount } from "./view.js";

// report.html?id=<run>        one page audit
// report.html?site=<origin>   the latest audit of every page on a site, merged
// &print=1                    opens the print dialog (Save as PDF) once loaded

const params = new URLSearchParams(location.search);
const view = document.getElementById("view");
const titleEl = document.getElementById("title");

const report = params.has("site") ? await siteReport(params.get("site")) : await getReport(params.get("id"));

if (!report) {
  titleEl.textContent = "This report no longer exists.";
} else {
  const name = params.has("site") ? new URL(report.startUrl).host : report.startUrl;
  titleEl.textContent = name;
  // Chrome names the saved PDF after the page title.
  document.title = `SSEO ${name.replace(/^https?:\/\//, "")} ${report.generatedAt.slice(0, 10)}`;
  mount(view, report);

  document.getElementById("pdf").addEventListener("click", printReport);
  document.getElementById("json").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    a.download = `${document.title}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  if (params.get("print") === "1") printReport();
}

function printReport() {
  // Collapsed sections would print empty, so open everything first.
  view.querySelectorAll("details").forEach((d) => (d.open = true));
  print();
}

async function siteReport(origin) {
  const latest = new Map();
  for (const e of await getIndex()) if (e.origin === origin && !latest.has(e.url)) latest.set(e.url, e);
  const reports = (await Promise.all([...latest.values()].map((e) => getReport(e.id)))).filter(Boolean);
  if (!reports.length) return null;
  const newest = reports.map((r) => r.generatedAt).sort().at(-1);
  return aggregate(origin, newest, reports.flatMap((r) => r.pages));
}
