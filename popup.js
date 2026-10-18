import { esc, getIndex, getReport, label, pageUrl, runKey, startAudit, tone, when } from "./lib.js";

// Reopening the popup within this window shows the last run instead of re-auditing.
const REUSE_MS = 10 * 60_000;

const view = document.getElementById("view");
const rerun = document.getElementById("rerun");

document.getElementById("open-dashboard").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  window.close();
});

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

if (!/^https?:/.test(tab?.url ?? "")) {
  view.innerHTML = `<p class="empty">Open a website to audit it. Browser pages like this one can't be checked.</p>`;
} else {
  const url = pageUrl(tab.url);
  document.getElementById("url").textContent = url;
  rerun.addEventListener("click", () => run(url));

  chrome.storage.session.onChanged.addListener((changes) => {
    const c = changes[runKey(url)];
    if (c?.newValue) onRun(c.newValue);
  });

  const recent = (await getIndex()).find(
    (e) => e.url === url && Date.now() - Date.parse(e.date) < REUSE_MS,
  );
  if (recent) await show(recent.id);
  else await run(url);
}

async function run(url) {
  rerun.hidden = true;
  view.innerHTML = progress("Starting", 0, 0);
  const state = await startAudit(url, tab.title);
  if (state?.state === "error") onRun(state);
}

async function onRun(s) {
  if (s.state === "running") view.innerHTML = progress(s.phase, s.done, s.total);
  else if (s.state === "done") await show(s.id);
  else if (s.state === "error") {
    rerun.hidden = false;
    view.innerHTML = `<p class="empty">The audit failed: ${esc(s.error)}</p>`;
  }
}

function progress(phase, done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="progress">
    <p>${esc(phase)}${total ? ` (${done} of ${total})` : ""}</p>
    <div class="track"><div class="fill" style="width:${pct}%"></div></div>
  </div>`;
}

let report;
let filter = null; // category name, or null for all

async function show(id) {
  report = await getReport(id);
  rerun.hidden = false;
  if (!report) {
    view.innerHTML = `<p class="empty">That report is gone. Run it again.</p>`;
    return;
  }
  render();
}

function render() {
  const page = report.pages[0];
  const inCat = (x) => !filter || x.category === filter;
  const findings = page.findings.filter(inCat);
  const order = { fail: 0, warn: 1 };
  const issues = findings
    .filter((f) => f.status === "fail" || f.status === "warn")
    .sort((a, b) => order[a.status] - order[b.status]);
  const passed = findings.filter((f) => f.status === "pass");
  const info = findings.filter((f) => f.status === "info");
  const metrics = page.metrics.filter(inCat);

  view.innerHTML = `
    <section class="summary">
      <div class="score ${tone(report.score)}"><b>${report.score}</b><small>/100</small></div>
      <div class="facts">
        <p><b>${issues.filter((f) => f.status === "fail").length}</b> failing,
           <b>${issues.filter((f) => f.status === "warn").length}</b> warnings,
           <b>${passed.length}</b> passed</p>
        <p class="muted">HTTP ${page.status || "error"} · ${esc(when(report.generatedAt))}</p>
      </div>
    </section>
    <nav class="cats">
      ${report.categories
        .map(
          (c) => `<button class="cat ${tone(c.score)} ${filter === c.category ? "on" : ""}" data-cat="${esc(c.category)}">
            <span>${esc(label(c.category))}</span><b>${c.score}</b></button>`,
        )
        .join("")}
    </nav>
    ${filter ? `<p class="filtering">Showing ${esc(label(filter))} only. <a href="#" id="clear">Show all</a></p>` : ""}
    ${group("Issues", issues, true)}
    ${group("Notes", info, false)}
    ${group("Passed", passed, false)}
    ${metricsBlock(metrics)}`;

  view.querySelectorAll(".cat").forEach((b) =>
    b.addEventListener("click", () => {
      filter = filter === b.dataset.cat ? null : b.dataset.cat;
      render();
    }),
  );
  view.querySelector("#clear")?.addEventListener("click", (e) => {
    e.preventDefault();
    filter = null;
    render();
  });
}

function group(title, list, open) {
  if (!list.length) return "";
  return `<details class="group" ${open ? "open" : ""}>
    <summary>${title} <span class="count">${list.length}</span></summary>
    ${list.map(finding).join("")}
  </details>`;
}

function finding(f) {
  const more = f.details || f.evidence || f.fix;
  return `<details class="finding">
    <summary><i class="dot ${f.status}"></i>
      <span><b>${esc(f.title)}</b><br><span class="muted">${esc(f.message)}</span></span></summary>
    ${more ? `<div class="more">
      ${f.details ? `<p>${esc(f.details)}</p>` : ""}
      ${f.evidence ? `<pre>${esc(f.evidence)}</pre>` : ""}
      ${f.fix ? `<p><b>Fix:</b> ${esc(f.fix)}</p>` : ""}
    </div>` : ""}
  </details>`;
}

function metricsBlock(metrics) {
  if (!metrics.length) return "";
  const values = metrics.filter((m) => m.kind === "value");
  const tables = metrics.filter((m) => m.kind === "table");
  return `<details class="group">
    <summary>Page data <span class="count">${metrics.length}</span></summary>
    <table class="kv">${values
      .map(
        (m) => `<tr><th>${esc(m.label)}</th>
          <td class="${m.status ?? ""}">${esc(m.value ?? "missing")}${m.unit ? ` ${esc(m.unit)}` : ""}
          ${m.note ? `<br><span class="muted">${esc(m.note)}</span>` : ""}</td></tr>`,
      )
      .join("")}</table>
    ${tables
      .map(
        (t) => `<details class="finding"><summary><span><b>${esc(t.label)}</b>
          <span class="muted">${t.total} rows</span></span></summary>
          <div class="more scroll"><table class="grid">
            <tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>
            ${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}
          </table>${t.total > t.rows.length ? `<p class="muted">First ${t.rows.length} of ${t.total}.</p>` : ""}</div>
        </details>`,
      )
      .join("")}
  </details>`;
}
