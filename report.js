import { aggregate } from "./dist/scanner.js";
import { esc, getIndex, getReport, when } from "./lib.js";
import { pill, plural } from "./ui.js";
import { mountPageReport } from "./pagereport.js";

// report.html?id=<run>        one page audit
// report.html?site=<origin>   the latest audit of every page on a site
// &print=1                    opens the print dialog (Save as PDF) once loaded

const params = new URLSearchParams(location.search);
const view = document.getElementById("view");
const index = await getIndex();

let data = null;
if (params.has("site")) await sitePage(params.get("site"));
else await runPage(params.get("id"));

document.getElementById("pdf").addEventListener("click", () => print());
document.getElementById("json").addEventListener("click", () => {
  if (!data) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `${document.title}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
if (params.get("print") === "1" && data) {
  await document.fonts.ready;
  print();
}

async function runPage(id) {
  const entry = index.find((e) => e.id === id);
  const report = await getReport(id);
  if (!report) return missing();
  data = report;
  const u = new URL(report.startUrl);
  // Chrome names the saved PDF after the page title.
  document.title = `SSEO ${u.host}${u.pathname === "/" ? "" : u.pathname} ${report.generatedAt.slice(0, 10)}`;
  view.innerHTML = `${heading(u, entry?.title, report.pages[0].status, report.generatedAt)}<div id="pr"></div>`;
  mountPageReport(view.querySelector("#pr"), {
    report,
    runs: index.filter((e) => e.url === entry?.url),
    print: true,
  });
}

async function sitePage(origin) {
  const latest = new Map();
  for (const e of index) if (e.origin === origin && !latest.has(e.url)) latest.set(e.url, e);
  const entries = [...latest.values()].sort((a, b) => a.url.localeCompare(b.url));
  const reports = await Promise.all(entries.map((e) => getReport(e.id)));
  const pairs = entries.map((e, i) => [e, reports[i]]).filter(([, r]) => r);
  if (!pairs.length) return missing();
  data = aggregate(origin, pairs.map(([e]) => e.date).sort().at(-1), pairs.map(([, r]) => r.pages[0]));
  const host = new URL(origin).host;
  document.title = `SSEO ${host} ${data.generatedAt.slice(0, 10)}`;
  const avg = Math.round(pairs.reduce((n, [e]) => n + e.score, 0) / pairs.length);

  view.innerHTML = `
    <header class="head">
      <div class="head-text">
        <p class="t-strong t-brand">Website report</p>
        <h1 class="t-section">${esc(host)}</h1>
        <p class="t-body muted">${plural(pairs.length, "page")} · latest audit ${esc(when(data.generatedAt))}</p>
      </div>
    </header>
    <section class="stats">
      <div class="stat brand"><p class="t-label">Site score</p><p class="t-metric">${avg}</p></div>
      <div class="stat"><p class="t-label">Pages audited</p><p class="t-metric">${pairs.length}</p></div>
      <div class="stat"><p class="t-label">Failing checks</p><p class="t-metric">${pairs.reduce((n, [e]) => n + e.fail, 0)}</p></div>
      <div class="stat"><p class="t-label">Warnings</p><p class="t-metric">${pairs.reduce((n, [e]) => n + e.warn, 0)}</p></div>
    </section>
    <section class="card kv">${pairs
      .map(([e]) => {
        const u = new URL(e.url);
        return `<div class="kv-row" style="align-items:center">${pill(e.score)}<div><p class="t-strong">${esc(u.pathname + u.search)}</p><p class="t-meta">${e.fail} failing, ${plural(e.warn, "warning")} · ${esc(when(e.date))}</p></div></div>`;
      })
      .join("")}</section>
    ${pairs.map((_, i) => `<div class="page-break" id="p${i}"></div>`).join("")}`;

  pairs.forEach(([e, r], i) => {
    const holder = view.querySelector(`#p${i}`);
    const u = new URL(e.url);
    holder.innerHTML = `${heading(u, e.title, r.pages[0].status, e.date)}<div class="pr"></div>`;
    // Per-page categories and score, so each section reads like its own report.
    const one = aggregate(e.url, r.generatedAt, r.pages);
    mountPageReport(holder.querySelector(".pr"), { report: one, runs: index.filter((x) => x.url === e.url), print: true });
  });
}

function heading(u, title, status, date) {
  return `<header class="head">
    <div class="head-text">
      <p class="t-strong t-brand">${esc(u.host)}</p>
      <h1 class="t-section">${esc(u.pathname + u.search)}</h1>
      <p class="t-body muted">${title ? `${esc(title)} · ` : ""}HTTP ${status || "error"} · ${esc(when(date))}</p>
    </div>
  </header>`;
}

function missing() {
  view.innerHTML = `<p class="t-body muted">This report no longer exists. <a class="link" href="dashboard.html">Open the dashboard</a></p>`;
}
