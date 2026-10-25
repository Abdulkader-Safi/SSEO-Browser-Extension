import { aggregate } from "./dist/scanner.js";
import { esc, getIndex, getReport, label, when } from "./lib.js";
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
    <h2 class="t-card-title section-title">Issues across the site</h2>
    ${siteIssues(pairs)}
    <h2 class="t-card-title section-title page-break-before">Pages</h2>
    <section class="card kv">${pairs
      .map(([e]) => {
        const u = new URL(e.url);
        return `<div class="kv-row" style="align-items:center">${pill(e.score)}<div><p class="t-strong">${esc(u.pathname + u.search)}</p><p class="t-meta">${e.fail} failing, ${plural(e.warn, "warning")} · ${esc(when(e.date))}</p></div></div>`;
      })
      .join("")}</section>
    <h2 class="t-card-title section-title page-break-before">Issues by page</h2>
    ${pageIssues(pairs)}`;
}

// A site report summarises: each failing or warning check once, with the pages
// it hits, then a one-line-per-issue list per page. Every page's full report
// (passed checks and data tables included) made a 200-page site PDF too big to
// preview; the full detail stays one click away in each page's own PDF.
// Declared, not const: the code at the top of this module runs before here.
function path(url) {
  const u = new URL(url);
  return u.pathname + u.search;
}

function siteIssues(pairs) {
  const PAGE_SAMPLE = 10; // pages named per issue
  const rules = new Map();
  for (const [e, r] of pairs) {
    for (const f of r.pages[0].findings) {
      if (f.status !== "fail" && f.status !== "warn") continue;
      let rule = rules.get(f.ruleId);
      if (!rule) rules.set(f.ruleId, (rule = { title: f.title, category: f.category, fix: f.fix, fail: 0, warn: 0, pages: [] }));
      rule[f.status]++;
      if (!rule.pages.includes(e.url)) rule.pages.push(e.url);
    }
  }
  if (!rules.size) return `<p class="t-body muted">No failing checks or warnings on any page.</p>`;
  const list = [...rules.values()].sort((a, b) => (b.fail > 0) - (a.fail > 0) || b.pages.length - a.pages.length);
  return `<div class="list">${list
    .map((r) => {
      const status = r.fail ? "fail" : "warning";
      const shown = r.pages.slice(0, PAGE_SAMPLE).map(path);
      const more = r.pages.length - shown.length;
      return `<section class="finding site-issue">
        <div class="site-issue-head"><i class="dot ${status}"></i>
          <div class="text"><span class="t-strong">${esc(r.title)}</span>
          <span class="t-meta">${esc(label(r.category))} · ${r.fail ? "Fails" : "Warning"} on ${plural(r.pages.length, "page")} of ${pairs.length}</span></div>
        </div>
        <div class="detail">
          ${r.fix ? `<p class="t-small">Fix: ${esc(r.fix)}</p>` : ""}
          <p class="t-meta">${shown.map(esc).join(", ")}${more ? ` and ${more} more` : ""}</p>
        </div>
      </section>`;
    })
    .join("")}</div>`;
}

function pageIssues(pairs) {
  const withIssues = pairs.filter(([e]) => e.fail || e.warn);
  if (!withIssues.length) return `<p class="t-body muted">Every page passed.</p>`;
  return `<div class="list">${withIssues
    .map(([e, r]) => {
      const issues = r.pages[0].findings
        .filter((f) => f.status === "fail" || f.status === "warn")
        .sort((a, b) => (a.status === "fail" ? -1 : 0) - (b.status === "fail" ? -1 : 0));
      return `<section class="card page-issues">
        <div class="page-issues-head">${pill(e.score)}<p class="t-strong one-line">${esc(path(e.url))}</p></div>
        <ul>${issues
          .map((f) => `<li><i class="dot ${f.status === "warn" ? "warning" : "fail"}"></i><span class="t-small"><b>${esc(f.title)}</b> <span class="muted">${esc(f.message)}</span></span></li>`)
          .join("")}</ul>
      </section>`;
    })
    .join("")}</div>`;
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
