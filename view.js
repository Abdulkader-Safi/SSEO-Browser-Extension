// The audit UI, shared by the side panel and the full report page.
// A report with one page renders that page; a merged site report renders the
// site summary, then one section per page.

import { esc, label, tone, when } from "./lib.js";

/** Render a report into `el`. Category chips filter everything below them. */
export function mount(el, report) {
  let filter = null;
  const draw = () => {
    el.innerHTML = reportHtml(report, filter);
    el.querySelectorAll(".cat").forEach((b) =>
      b.addEventListener("click", () => {
        filter = filter === b.dataset.cat ? null : b.dataset.cat;
        draw();
      }),
    );
    el.querySelector("#clear")?.addEventListener("click", (e) => {
      e.preventDefault();
      filter = null;
      draw();
    });
  };
  draw();
}

function reportHtml(report, filter) {
  const all = report.pages.flatMap((p) => p.findings);
  const n = (s) => all.filter((f) => f.status === s).length;
  const single = report.pages.length === 1;
  const meta = single
    ? `HTTP ${report.pages[0].status || "error"} · ${esc(when(report.generatedAt))}`
    : `${report.pages.length} pages · latest audit ${esc(when(report.generatedAt))}`;

  return `
    <section class="summary">
      <div class="score ${tone(report.score)}"><b>${report.score}</b><small>/100</small></div>
      <div class="facts">
        <p><b>${n("fail")}</b> failing, <b>${n("warn")}</b> warnings, <b>${n("pass")}</b> passed</p>
        <p class="muted">${meta}</p>
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
    ${
      single
        ? pageHtml(report.pages[0], filter)
        : report.pages
            .map(
              (p) => `<section class="page-sec">
                <h2><b class="pill ${tone(p.score)}">${p.score}</b>
                  <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></h2>
                ${pageHtml(p, filter)}
              </section>`,
            )
            .join("")
    }`;
}

function pageHtml(page, filter) {
  const inCat = (x) => !filter || x.category === filter;
  const findings = page.findings.filter(inCat);
  const order = { fail: 0, warn: 1 };
  const issues = findings
    .filter((f) => f.status === "fail" || f.status === "warn")
    .sort((a, b) => order[a.status] - order[b.status]);
  return `
    ${group("Issues", issues, true)}
    ${group("Notes", findings.filter((f) => f.status === "info"), false)}
    ${group("Passed", findings.filter((f) => f.status === "pass"), false)}
    ${metricsHtml(page.metrics.filter(inCat))}`;
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

function metricsHtml(metrics) {
  if (!metrics.length) return "";
  const values = metrics.filter((m) => m.kind === "value");
  const tables = metrics.filter((m) => m.kind === "table");
  return `<details class="group">
    <summary>Page data <span class="count">${metrics.length}</span></summary>
    <table class="kv">${values
      .map(
        (m) => `<tr><th>${esc(m.label)}</th>
          <td class="${esc(m.status ?? "")}">${esc(m.value ?? "missing")}${m.unit ? ` ${esc(m.unit)}` : ""}
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
