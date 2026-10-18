import { esc, getIndex, getReport, label, pageUrl, runKey, startAudit } from "./lib.js";
import { ago, counts, day, finding, metricsHtml, pill, ring, tally, verdict } from "./ui.js";

// A page audited this recently shows its last run instead of re-auditing.
const REUSE_MS = 10 * 60_000;
// Findings shown before the "Show N more" button.
const FIRST = 6;

const view = document.getElementById("view");
const pageCard = document.getElementById("page");
const urlEl = document.getElementById("url");
const metaEl = document.getElementById("meta");
const rerun = document.getElementById("rerun");

let url = null;
let title = "";
let firstLoad = true;

document.getElementById("open-dashboard").addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }),
);
rerun.addEventListener("click", () => run());

chrome.storage.session.onChanged.addListener((changes) => {
  const c = url && changes[runKey(url)];
  if (c?.newValue) onRun(c.newValue);
});

// The panel stays open across tabs, so it follows whichever tab is in front.
chrome.tabs.onActivated.addListener(follow);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.url || info.status === "complete")) follow();
});

follow();

async function follow() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const next = /^https?:/.test(tab?.url ?? "") ? pageUrl(tab.url) : null;
  title = tab?.title ?? "";
  if (next === url && next) return;
  url = next;
  rerun.hidden = !url;
  pageCard.hidden = !url;
  if (!url) return browserPage();
  const u = new URL(url);
  urlEl.textContent = u.host + (u.pathname === "/" ? "" : u.pathname) + u.search;
  urlEl.title = url;

  const key = runKey(url);
  const live = (await chrome.storage.session.get(key))[key];
  if (live?.state === "running") return onRun(live);

  const last = (await getIndex()).find((e) => e.url === url);
  const auto = firstLoad;
  firstLoad = false;
  if (last && Date.now() - Date.parse(last.date) < REUSE_MS) return show(last.id);
  // Opening the panel audits the page; switching tabs only offers to, so
  // browsing with the panel open doesn't fire an audit per page.
  if (auto) return run();
  if (last) return show(last.id);
  notAudited();
}

async function run() {
  if (!url) return;
  rerun.disabled = true;
  running("Starting", 0, 0);
  const state = await startAudit(url, title);
  if (state?.state === "error") onRun(state);
}

async function onRun(s) {
  if (s.state === "running") return running(s.phase, s.done, s.total);
  rerun.disabled = false;
  if (s.state === "done") await show(s.id);
  else if (s.state === "error") failed(s.error);
}

// ---- States ---------------------------------------------------------------

function browserPage() {
  view.innerHTML = `<section class="card empty">
    <span class="empty-mark"><i class="icon i-globe"></i></span>
    <h1 class="t-card-title" style="margin:0">Open a website</h1>
    <p class="t-small muted">Browser pages like this one can't be audited. Switch to a tab with a website and the panel follows.</p>
  </section>`;
}

function running(phase, done, total) {
  metaEl.textContent = "Audit in progress";
  const pct = total ? Math.round((done / total) * 100) : 0;
  view.innerHTML = `<section class="card progress" aria-live="polite">
      <div class="progress-head">
        <p class="t-strong">${esc(phase)}</p>
        ${total ? `<p class="t-meta">${done} of ${total}</p>` : ""}
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>
      <p class="t-meta">Fetching the page, then checking links, images and headers.</p>
    </section>
    <div class="skeleton" style="height:148px"></div>
    <div class="skeleton" style="height:40px"></div>
    <div class="skeleton" style="height:60px;opacity:.8"></div>
    <div class="skeleton" style="height:60px;opacity:.6"></div>
    <div class="skeleton" style="height:60px;opacity:.4"></div>`;
}

async function notAudited() {
  metaEl.textContent = "Not audited yet";
  const origin = new URL(url).origin;
  const latest = new Map();
  for (const e of await getIndex()) if (e.origin === origin && !latest.has(e.url)) latest.set(e.url, e);
  const runs = [...latest.values()];
  const avg = runs.length ? Math.round(runs.reduce((n, e) => n + e.score, 0) / runs.length) : 0;

  view.innerHTML = `<section class="card empty">
      <span class="empty-mark"><i class="icon i-globe"></i></span>
      <h1 class="t-card-title" style="margin:0">Check this page</h1>
      <p class="t-small muted">The audit reads the page the way a search crawler does and takes about 20 seconds. Results are saved to your history.</p>
      <button id="go" class="btn btn-primary"><i class="icon i-refresh"></i>Audit this page</button>
    </section>
    ${
      runs.length
        ? `<section class="card history">
            <p class="t-strong">Earlier on ${esc(new URL(url).host)}</p>
            <div class="history-row">
              ${pill(avg)}
              <p class="t-small muted">${runs.length} page${runs.length === 1 ? "" : "s"} audited, last on ${esc(day(runs[0].date))}</p>
            </div>
          </section>`
        : ""
    }`;
  view.querySelector("#go").addEventListener("click", () => run());
}

function failed(error) {
  metaEl.textContent = "Audit failed";
  view.innerHTML = `<section class="card empty">
    <h1 class="t-card-title" style="margin:0">The audit didn't finish</h1>
    <p class="t-small muted">${esc(error)}</p>
    <button id="retry" class="btn btn-primary"><i class="icon i-refresh"></i>Try again</button>
  </section>`;
  view.querySelector("#retry").addEventListener("click", () => run());
}

async function show(id) {
  const showing = url;
  const report = await getReport(id);
  if (showing !== url) return; // the user moved to another tab meanwhile
  if (!report) return notAudited();
  const page = report.pages[0];
  metaEl.textContent = `HTTP ${page.status || "error"} · audited ${ago(report.generatedAt)}`;
  results(report, page);
}

// ---- Results --------------------------------------------------------------

const TABS = [
  { id: "issues", label: "Issues", noun: "issues", pick: (f) => f.status === "fail" || f.status === "warn" },
  { id: "notes", label: "Notes", noun: "notes", pick: (f) => f.status === "info" },
  { id: "passed", label: "Passed", noun: "checks", pick: (f) => f.status === "pass" },
  { id: "data", label: "Data", noun: "items" },
];

function results(report, page) {
  const state = { filter: null, tab: "issues", all: false };
  const c = counts(page.findings);

  const draw = () => {
    const inCat = (x) => !state.filter || x.category === state.filter;
    const findings = page.findings.filter(inCat);
    const metrics = page.metrics.filter(inCat);
    const tabCounts = Object.fromEntries(
      TABS.map((t) => [t.id, t.pick ? findings.filter(t.pick).length : metrics.length]),
    );
    const tab = TABS.find((t) => t.id === state.tab);

    view.innerHTML = `
      <section class="card summary">
        ${ring(report.score)}
        <div class="tally">
          <p class="t-card-title">${verdict(report.score)}</p>
          ${tally(c)}
        </div>
      </section>

      <section class="categories">
        <div class="section-head"><p class="t-strong">Categories</p><p class="t-meta">Pick one to filter</p></div>
        <div class="tiles">
          ${report.categories
            .map(
              (c) => `<button class="tile" data-cat="${esc(c.category)}" aria-pressed="${state.filter === c.category}">
                <span>${esc(label(c.category))}</span>${pill(c.score)}</button>`,
            )
            .join("")}
        </div>
        ${state.filter ? `<p class="t-small filtering">Showing ${esc(label(state.filter))} only. <button class="link" id="clear">Show all categories</button></p>` : ""}
      </section>

      <nav class="tabs" role="tablist">
        ${TABS.map(
          (t) => `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === state.tab}">
            ${t.label}<small>${tabCounts[t.id]}</small></button>`,
        ).join("")}
      </nav>

      ${tab.id === "data" ? metricsHtml(metrics) : findingsTab(findings.filter(tab.pick), tab, state)}`;

    view.querySelectorAll(".tile").forEach((b) =>
      b.addEventListener("click", () => {
        state.filter = state.filter === b.dataset.cat ? null : b.dataset.cat;
        state.all = false;
        draw();
      }),
    );
    view.querySelector("#clear")?.addEventListener("click", () => {
      state.filter = null;
      draw();
    });
    view.querySelectorAll(".tab").forEach((b) =>
      b.addEventListener("click", () => {
        state.tab = b.dataset.tab;
        state.all = false;
        draw();
      }),
    );
    view.querySelector("#more")?.addEventListener("click", () => {
      state.all = true;
      draw();
    });
  };
  draw();
}

function findingsTab(list, tab, state) {
  if (!list.length) return `<p class="t-small muted none">No ${tab.noun} here.</p>`;
  const order = { fail: 0, warn: 1 };
  const sorted = [...list].sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
  const shown = state.all ? sorted : sorted.slice(0, FIRST);
  const rest = sorted.length - shown.length;
  return `<div class="list">${shown.map((f, i) => finding(f, tab.id === "issues" && i === 0)).join("")}</div>
    ${rest ? `<button id="more" class="btn btn-secondary btn-block"><i class="icon i-chevron-down"></i>Show ${rest} more ${tab.noun}</button>` : ""}`;
}
