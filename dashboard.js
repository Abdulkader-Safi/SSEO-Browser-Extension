import { deleteRuns, esc, getIndex, getReport, pageUrl, startAudit, when } from "./lib.js";
import { pill, plural, short } from "./ui.js";
import { mountPageReport } from "./pagereport.js";

// Routes live in the hash: #site=<origin>, #run=<id>, plus &q=<search>.

const main = document.getElementById("main");
const sitesEl = document.getElementById("sites");
const q = document.getElementById("q");

let index = [];
let running = new Set(); // urls with an audit in flight
let rerunning = null; // page url re-audited from its report, to follow the new run
const expanded = new Set(); // page urls showing their run history

q.value = params().get("q") ?? "";
q.addEventListener("input", () => {
  const h = params();
  q.value ? h.set("q", q.value) : h.delete("q");
  history.replaceState(null, "", `#${h}`);
  sidebar(sites(), currentOrigin);
});

document.getElementById("clear-all").addEventListener("click", async () => {
  if (index.length && confirm(`Delete all ${index.length} saved audits?`)) await deleteRuns(index.map((e) => e.id));
});

window.addEventListener("hashchange", render);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.index) load();
  // Progress ticks rewrite session state often; only a start or finish matters here.
  if (area === "session" && Object.values(changes).some((c) => c.oldValue?.state !== c.newValue?.state)) load();
});

load();

function params() {
  return new URLSearchParams(location.hash.slice(1));
}

function go(key, value) {
  const h = new URLSearchParams();
  h.set(key, value);
  if (q.value) h.set("q", q.value);
  location.hash = `#${h}`;
}

async function load() {
  index = await getIndex();
  const session = await chrome.storage.session.get(null);
  running = new Set(
    Object.entries(session)
      .filter(([k, v]) => k.startsWith("run:") && v.state === "running")
      .map(([k]) => k.slice(4)),
  );
  // After "Re-audit" on a page report, move to the new run once it lands.
  if (rerunning && !running.has(rerunning)) {
    const latest = index.find((e) => e.url === rerunning);
    rerunning = null;
    if (latest && params().get("run") !== latest.id) return go("run", latest.id);
  }
  render();
}

/** origin -> url -> runs, newest first. Sites are ordered by their latest audit. */
function sites() {
  const bySite = new Map();
  for (const e of index) {
    if (!bySite.has(e.origin)) bySite.set(e.origin, new Map());
    const pages = bySite.get(e.origin);
    if (!pages.has(e.url)) pages.set(e.url, []);
    pages.get(e.url).push(e);
  }
  return bySite;
}

const latestOf = (pages) => [...pages.values()].map((runs) => runs[0]);
const average = (list) => Math.round(list.reduce((n, e) => n + e.score, 0) / list.length);

let currentOrigin = null;
let renderToken = 0;

function render() {
  const bySite = sites();
  const h = params();
  const token = ++renderToken;

  const run = h.get("run") && index.find((e) => e.id === h.get("run"));
  if (run) {
    currentOrigin = run.origin;
    sidebar(bySite, run.origin);
    return pageView(run, bySite.get(run.origin).get(run.url), token);
  }
  if (!bySite.size) {
    currentOrigin = null;
    sidebar(bySite, null);
    return emptyView();
  }
  currentOrigin = bySite.has(h.get("site")) ? h.get("site") : bySite.keys().next().value;
  sidebar(bySite, currentOrigin);
  siteView(currentOrigin, bySite.get(currentOrigin));
}

// ---- Sidebar --------------------------------------------------------------

function sidebar(bySite, active) {
  const term = q.value.trim().toLowerCase();
  const shown = [...bySite].filter(
    ([origin, pages]) =>
      !term ||
      origin.toLowerCase().includes(term) ||
      [...pages.values()].some((runs) => `${runs[0].url} ${runs[0].title}`.toLowerCase().includes(term)),
  );
  document.getElementById("site-count").textContent = bySite.size || "";
  sitesEl.innerHTML = shown.length
    ? shown
        .map(([origin, pages]) => {
          const host = new URL(origin).host;
          return `<a class="site" href="#site=${encodeURIComponent(origin)}" aria-current="${origin === active}">
            <span class="site-mark"><i class="icon i-globe"></i></span>
            <span class="site-text"><span class="t-strong">${esc(host)}</span><span class="t-meta">${plural(pages.size, "page")}</span></span>
            ${pill(average(latestOf(pages)))}
          </a>`;
        })
        .join("")
    : `<div class="no-sites">
        <p class="t-strong">${term ? "No matches" : "No sites yet"}</p>
        <p class="t-meta">${term ? "Try a different address or page title." : "Sites show up here after their first audit."}</p>
      </div>`;
  document.getElementById("storage-text").textContent = index.length
    ? `${plural(index.length, "audit")} across ${plural(bySite.size, "site")}`
    : "Nothing saved yet";
  document.getElementById("clear-all").hidden = !index.length;
}

// ---- Views ----------------------------------------------------------------

/** Re-renders keep whatever the person was typing into the audit field. */
function paint(html) {
  const field = main.querySelector("#audit-url");
  const typed = field?.value;
  const focused = document.activeElement === field;
  main.innerHTML = html;
  const next = main.querySelector("#audit-url");
  if (next && typed) next.value = typed;
  if (next && focused) next.focus();
  main.querySelector("#audit-form")?.addEventListener("submit", submitAudit);
}

function auditField(placeholder) {
  return `<form id="audit-form" class="audit-field no-print">
    <i class="icon i-globe"></i>
    <input id="audit-url" type="text" inputmode="url" required placeholder="${esc(placeholder)}" aria-label="Page address to audit">
    <button class="btn btn-primary">Audit page</button>
  </form>`;
}

async function submitAudit(ev) {
  ev.preventDefault();
  const raw = ev.target.querySelector("input").value;
  let url;
  try {
    url = pageUrl(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return;
  }
  ev.target.querySelector("input").value = "";
  running.add(url);
  go("site", new URL(url).origin);
  render();
  await startAudit(url);
}

function emptyView() {
  const pending = [...running];
  paint(`<div class="empty-wrap">
    <section class="empty-card">
      <span class="empty-mark"><i class="icon i-dashboard"></i></span>
      <h1 class="t-section">Your audit history lives here</h1>
      <p class="t-lead muted">Open the side panel on any website to audit the page you are on, or paste an address below. Every run is kept by site, each with its own PDF.</p>
      ${auditField("Paste a page address to audit it")}
      ${pending.map((u) => `<p class="t-meta">Auditing ${esc(u)}</p>`).join("")}
    </section>
  </div>`);
}

function siteView(origin, pages) {
  const host = new URL(origin).host;
  const latest = latestOf(pages);
  const runs = [...pages.values()].reduce((n, r) => n + r.length, 0);
  const last = latest.reduce((a, b) => (a.date > b.date ? a : b));
  const pending = [...running].filter((u) => u.startsWith(origin + "/") && !pages.has(u));
  const site = encodeURIComponent(origin);

  paint(`
    <header class="head">
      <div class="head-text">
        <p class="t-strong t-brand">Website</p>
        <h1 class="t-section">${esc(host)}</h1>
        <p class="t-body muted">${plural(pages.size, "page")} audited · last audit ${esc(when(last.date))}</p>
      </div>
      <div class="actions">
        <a class="btn btn-secondary" href="report.html?site=${site}" target="_blank"><i class="icon i-arrow-up-right"></i>Site report</a>
        <a class="btn btn-primary" href="report.html?site=${site}&print=1" target="_blank"><i class="icon i-file-pdf"></i>Save site PDF</a>
        <button class="icon-btn" data-act="delete-site" title="Delete this site's history" aria-label="Delete this site's history"><i class="icon i-trash"></i></button>
      </div>
    </header>
    <section class="stats">
      <div class="stat brand"><p class="t-label">Site score</p><p class="t-metric">${average(latest)}</p></div>
      <div class="stat"><p class="t-label">Pages audited</p><p class="t-metric">${pages.size}</p></div>
      <div class="stat"><p class="t-label">Failing checks</p><p class="t-metric">${latest.reduce((n, e) => n + e.fail, 0)}</p></div>
      <div class="stat"><p class="t-label">Audits run</p><p class="t-metric">${runs}</p></div>
    </section>
    ${auditField(`Audit another page, for example ${host}/about`)}
    <div class="list-head"><p class="t-strong">Pages</p><p class="t-meta">Sorted by path</p></div>
    <div class="pages">
      ${pending
        .map((u) => {
          const p = new URL(u);
          return `<div class="page-row" style="grid-template-columns:auto minmax(0,1fr);grid-template-areas:none">
            <span class="site-mark"><i class="icon i-refresh"></i></span>
            <div class="page-cell"><span class="t-strong">${esc(p.pathname + p.search)}</span><span class="t-meta">Auditing now</span></div>
          </div>`;
        })
        .join("")}
      ${[...pages]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([url, list]) => pageRow(url, list))
        .join("")}
    </div>`);
}

function pageRow(url, runs) {
  const e = runs[0];
  const u = new URL(url);
  const path = u.pathname + u.search;
  const busy = running.has(url);
  return `<div class="page-row">
      ${pill(e.score)}
      <div class="page-cell">
        <a class="t-strong" href="#run=${e.id}" title="${esc(url)}">${esc(path)}</a>
        <span class="t-meta">${esc(e.title || u.host)}</span>
      </div>
      <div class="issues t-label"><span class="${e.fail ? "has-fail" : ""}">${e.fail} failing</span><span>${plural(e.warn, "warning")}</span></div>
      <div class="when">
        <span class="t-label">${esc(short(e.date))}</span>
        <button class="link t-meta" style="color:var(--text-brand);text-align:left" data-act="toggle" data-url="${esc(url)}" aria-expanded="${expanded.has(url)}">${busy ? "Auditing now" : plural(runs.length, "run")}</button>
      </div>
      <div class="actions">
        <a class="btn btn-quiet" href="#run=${e.id}"><i class="icon i-arrow-up-right"></i>Report</a>
        <a class="icon-btn quiet" href="report.html?id=${e.id}&print=1" target="_blank" title="Save PDF" aria-label="Save PDF of ${esc(path)}"><i class="icon i-file-pdf"></i></a>
        <button class="icon-btn quiet" data-act="rerun" data-url="${esc(url)}" title="Re-audit" aria-label="Re-audit ${esc(path)}" ${busy ? "disabled" : ""}><i class="icon i-refresh"></i></button>
        <button class="icon-btn quiet" data-act="delete-page" data-url="${esc(url)}" title="Delete" aria-label="Delete ${esc(path)}"><i class="icon i-trash"></i></button>
      </div>
    </div>
    ${
      expanded.has(url)
        ? `<div class="history">
            <div class="history-head"><i class="icon i-history"></i><p class="t-strong">Run history for ${esc(path)}</p></div>
            ${runs
              .map(
                (r) => `<div class="run-row">
                  ${pill(r.score)}
                  <span class="t-label grow">${esc(when(r.date))}</span>
                  <span class="t-meta">${r.fail} failing, ${plural(r.warn, "warning")}</span>
                  <a class="btn btn-quiet" href="#run=${r.id}">View</a>
                  <a class="icon-btn quiet" href="report.html?id=${r.id}&print=1" target="_blank" title="Save PDF" aria-label="Save PDF of this run"><i class="icon i-file-pdf"></i></a>
                </div>`,
              )
              .join("")}
          </div>`
        : ""
    }`;
}

async function pageView(e, runs, token) {
  const report = await getReport(e.id);
  if (token !== renderToken) return; // a newer render started meanwhile
  const u = new URL(e.url);
  const path = u.pathname + u.search;
  const site = encodeURIComponent(e.origin);
  const busy = running.has(e.url);
  if (!report) {
    return paint(`<p class="t-body muted">This run's report is missing. <a class="link" href="#site=${site}">Back to ${esc(u.host)}</a></p>`);
  }

  paint(`
    <div class="pr-top">
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="#site=${site}">${esc(u.host)}</a><i class="icon i-chevron-right"></i>
      <a href="#site=${site}">Pages</a><i class="icon i-chevron-right"></i>
      <span class="t-label muted">${esc(path)}</span>
    </nav>
    <header class="head">
      <div class="head-text">
        <h1 class="t-section one-line" title="${esc(path)}">${esc(path)}</h1>
        <p class="t-body muted one-line">${e.title ? `${esc(e.title)} · ` : ""}HTTP ${e.status || "error"} · ${esc(when(e.date))}</p>
      </div>
      <div class="actions">
        <label class="run-picker"><i class="icon i-history"></i>
          <select id="run-select" aria-label="Choose a run">${runs
            .map((r, i) => `<option value="${r.id}" ${r.id === e.id ? "selected" : ""}>${esc(when(r.date))}${i === 0 ? ", latest" : ""} · ${r.score}</option>`)
            .join("")}</select>
          <i class="icon i-chevron-down"></i></label>
        <a class="btn btn-secondary" href="${esc(e.url)}" target="_blank" rel="noopener"><i class="icon i-arrow-up-right"></i>Open page</a>
        <button class="btn btn-secondary" id="rerun" ${busy ? "disabled" : ""}><i class="icon i-refresh"></i>${busy ? "Auditing" : "Re-audit"}</button>
        <a class="btn btn-primary" href="report.html?id=${e.id}&print=1" target="_blank"><i class="icon i-file-pdf"></i>Save PDF</a>
      </div>
    </header>
    </div>
    <div id="pr"></div>`);

  mountPageReport(main.querySelector("#pr"), { report, runs });
  // The pinned header's height sets where the tabs and the score column stick.
  const top = main.querySelector(".pr-top");
  new ResizeObserver(() => main.style.setProperty("--top-h", `${top.offsetHeight}px`)).observe(top);
  main.querySelector("#run-select").addEventListener("change", (ev) => go("run", ev.target.value));
  main.querySelector("#rerun").addEventListener("click", async () => {
    rerunning = e.url;
    running.add(e.url);
    render();
    await startAudit(e.url, e.title);
  });
}

// ---- Row actions ----------------------------------------------------------

main.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const { act, url } = b.dataset;
  if (act === "toggle") {
    expanded.has(url) ? expanded.delete(url) : expanded.add(url);
    render();
  } else if (act === "rerun") {
    running.add(url);
    render();
    await startAudit(url, index.find((e) => e.url === url)?.title);
  } else if (act === "delete-page") {
    const ids = index.filter((e) => e.url === url).map((e) => e.id);
    if (confirm(`Delete ${plural(ids.length, "audit")} of this page?`)) await deleteRuns(ids);
  } else if (act === "delete-site") {
    const ids = index.filter((e) => e.origin === currentOrigin).map((e) => e.id);
    if (confirm(`Delete all ${ids.length} audits for ${new URL(currentOrigin).host}?`)) await deleteRuns(ids);
  }
});
