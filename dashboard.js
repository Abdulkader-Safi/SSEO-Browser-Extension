import { deleteRuns, esc, getIndex, pageUrl, startAudit, tone, when } from "./lib.js";

const sitesEl = document.getElementById("sites");
const main = document.getElementById("main");
const q = document.getElementById("q");

let index = [];
let running = new Set(); // urls with an audit in flight
let site = null;
const expanded = new Set(); // page urls showing their run history

// Address-bar state: #site=<origin>&q=<search>, so a reload keeps the view.
const hash = new URLSearchParams(location.hash.slice(1));
site = hash.get("site");
q.value = hash.get("q") ?? "";

function syncHash() {
  const h = new URLSearchParams();
  if (site) h.set("site", site);
  if (q.value) h.set("q", q.value);
  history.replaceState(null, "", `#${h}`);
}

async function load() {
  index = await getIndex();
  const session = await chrome.storage.session.get(null);
  running = new Set(
    Object.entries(session)
      .filter(([k, v]) => k.startsWith("run:") && v.state === "running")
      .map(([k]) => k.slice(4)),
  );
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.index) load();
  // Progress ticks rewrite session state often; only a start or finish matters here.
  if (area === "session" && Object.values(changes).some((c) => c.oldValue?.state !== c.newValue?.state)) load();
});

q.addEventListener("input", () => {
  syncHash();
  render();
});

document.getElementById("clear-all").addEventListener("click", async () => {
  if (!index.length || !confirm(`Delete all ${index.length} saved audits?`)) return;
  await deleteRuns(index.map((e) => e.id));
});

/** Latest run per page, grouped by site. */
function sites() {
  const term = q.value.trim().toLowerCase();
  const bySite = new Map();
  for (const e of index) {
    if (term && !`${e.url} ${e.title}`.toLowerCase().includes(term)) continue;
    if (!bySite.has(e.origin)) bySite.set(e.origin, new Map());
    const pages = bySite.get(e.origin);
    if (!pages.has(e.url)) pages.set(e.url, []);
    pages.get(e.url).push(e); // index is newest first, so runs stay newest first
  }
  return bySite;
}

function render() {
  const bySite = sites();
  if (!site || !bySite.has(site)) site = bySite.keys().next().value ?? null;

  sitesEl.innerHTML = [...bySite]
    .map(([origin, pages]) => {
      const latest = [...pages.values()].map((runs) => runs[0]);
      const avg = Math.round(latest.reduce((n, e) => n + e.score, 0) / latest.length);
      return `<button class="site ${origin === site ? "on" : ""}" data-site="${esc(origin)}">
        <span class="host">${esc(new URL(origin).host)}</span>
        <span class="muted">${pages.size} page${pages.size === 1 ? "" : "s"}</span>
        <b class="pill ${tone(avg)}">${avg}</b>
      </button>`;
    })
    .join("") || `<p class="muted">${q.value ? "No matches." : "No audits yet."}</p>`;

  sitesEl.querySelectorAll(".site").forEach((b) =>
    b.addEventListener("click", () => {
      site = b.dataset.site;
      syncHash();
      render();
    }),
  );

  main.innerHTML = site ? siteView(site, bySite.get(site)) : emptyView();
  wire();
}

function emptyView() {
  return `<div class="empty big">
    <h1>No audits yet</h1>
    <p>Click the SSEO icon on any website to audit that page, or paste an address below.</p>
    ${auditForm()}
  </div>`;
}

function auditForm(prefill = "") {
  return `<form id="audit-form" class="audit-form">
    <input name="url" type="url" required placeholder="https://example.com/page" value="${esc(prefill)}">
    <button class="btn primary">Audit page</button>
  </form>`;
}

function siteView(origin, pages) {
  const rows = [...pages]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([url, runs]) => pageRow(url, runs))
    .join("");
  const pending = [...running].filter((u) => u.startsWith(origin) && !pages.has(u));
  return `<header class="site-head">
      <div>
        <h1>${esc(new URL(origin).host)}</h1>
        <p class="muted">${pages.size} page${pages.size === 1 ? "" : "s"} audited</p>
      </div>
      <span class="grow"></span>
      <a class="btn" href="report.html?site=${encodeURIComponent(origin)}" target="_blank">Site report</a>
      <a class="btn" href="report.html?site=${encodeURIComponent(origin)}&print=1" target="_blank">Site PDF</a>
      <button class="btn danger" data-act="delete-site">Delete site</button>
    </header>
    ${auditForm(origin + "/")}
    ${pending.map((u) => `<p class="muted">Auditing ${esc(u)}</p>`).join("")}
    <table class="pages">
      <thead><tr><th>Score</th><th>Page</th><th>Issues</th><th>Last audit</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function pageRow(url, runs) {
  const e = runs[0];
  const u = new URL(url);
  const busy = running.has(url);
  const history = expanded.has(url)
    ? `<tr class="history"><td></td><td colspan="4"><ul>${runs
        .map(
          (r) => `<li><b class="pill ${tone(r.score)}">${r.score}</b> ${esc(when(r.date))}
            · ${r.fail} failing, ${r.warn} warnings
            <a href="report.html?id=${r.id}" target="_blank">View</a>
            <a href="report.html?id=${r.id}&print=1" target="_blank">PDF</a>
            <button class="link" data-act="delete-run" data-id="${r.id}">Delete</button></li>`,
        )
        .join("")}</ul></td></tr>`
    : "";
  return `<tr>
      <td><b class="pill ${tone(e.score)}">${e.score}</b></td>
      <td class="page-cell">
        <a href="${esc(url)}" target="_blank" rel="noopener">${esc(u.pathname + u.search)}</a>
        ${e.title ? `<br><span class="muted">${esc(e.title)}</span>` : ""}
      </td>
      <td>${e.fail ? `<span class="bad-text">${e.fail} failing</span>` : "None failing"}${e.warn ? `, ${e.warn} warnings` : ""}</td>
      <td>${esc(when(e.date))}
        ${runs.length > 1 ? `<br><button class="link" data-act="toggle" data-url="${esc(url)}">${expanded.has(url) ? "Hide" : "Show"} ${runs.length} runs</button>` : ""}</td>
      <td class="actions">
        <a class="btn" href="report.html?id=${e.id}" target="_blank">Report</a>
        <a class="btn" href="report.html?id=${e.id}&print=1" target="_blank">PDF</a>
        <button class="btn" data-act="rerun" data-url="${esc(url)}" ${busy ? "disabled" : ""}>${busy ? "Auditing" : "Re-audit"}</button>
        <button class="btn danger" data-act="delete-page" data-url="${esc(url)}">Delete</button>
      </td>
    </tr>${history}`;
}

function wire() {
  main.querySelector("#audit-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const raw = new FormData(ev.target).get("url");
    let url;
    try {
      url = pageUrl(raw);
    } catch {
      return;
    }
    if (!/^https?:/.test(url)) return;
    site = new URL(url).origin;
    syncHash();
    await startAudit(url);
  });

  main.querySelectorAll("[data-act]").forEach((b) =>
    b.addEventListener("click", async () => {
      const { act, url, id } = b.dataset;
      if (act === "rerun") {
        const title = index.find((e) => e.url === url)?.title;
        await startAudit(url, title);
      } else if (act === "toggle") {
        expanded.has(url) ? expanded.delete(url) : expanded.add(url);
        render();
      } else if (act === "delete-run") {
        await deleteRuns([id]);
      } else if (act === "delete-page") {
        const ids = index.filter((e) => e.url === url).map((e) => e.id);
        if (confirm(`Delete ${ids.length} audit${ids.length === 1 ? "" : "s"} of this page?`)) await deleteRuns(ids);
      } else if (act === "delete-site") {
        const ids = index.filter((e) => e.origin === site).map((e) => e.id);
        if (confirm(`Delete all ${ids.length} audits for ${new URL(site).host}?`)) await deleteRuns(ids);
      }
    }),
  );
}

load();
