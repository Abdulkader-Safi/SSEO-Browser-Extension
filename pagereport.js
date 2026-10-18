// The body of a page report (Figma frame "Dashboard / Page report", node 13:856):
// score and categories on the left, findings grouped by category on the right.
// The dashboard shows one tab at a time; print shows every tab, fully open.

import { esc, label } from "./lib.js";
import { counts, day, finding, metricsHtml, pill, plural, ring, tally, verdict } from "./ui.js";

const TABS = [
  { id: "issues", label: "Issues", pick: (f) => f.status === "fail" || f.status === "warn" },
  { id: "notes", label: "Notes", pick: (f) => f.status === "info" },
  { id: "passed", label: "Passed", pick: (f) => f.status === "pass" },
  { id: "data", label: "Page data" },
];
const ORDER = { fail: 0, warn: 1, info: 2, pass: 3 };

/**
 * @param el      container
 * @param report  an AuditReport holding one page
 * @param runs    index entries for this page, any order (for the trend)
 * @param print   render every tab, expanded, without controls
 */
export function mountPageReport(el, { report, runs = [], print = false }) {
  const page = report.pages[0];
  const state = { filter: null, tab: "issues" };

  const draw = () => {
    const inCat = (x) => !state.filter || x.category === state.filter;
    const findings = page.findings.filter(inCat);
    const metrics = page.metrics.filter(inCat);
    const n = Object.fromEntries(TABS.map((t) => [t.id, t.pick ? findings.filter(t.pick).length : metrics.length]));

    el.innerHTML = `<div class="pr-body">
      <aside class="pr-side">
        <section class="card pr-score">
          <div class="pr-score-top">${ring(report.score)}
            <div><p class="t-card-title">${verdict(report.score)}</p>${tally(counts(page.findings))}</div>
          </div>
          ${trend(runs)}
        </section>
        <section class="card pr-cats">
          <div class="trend-head"><p class="t-strong">Categories</p><p class="t-meta no-print">Pick one to filter</p></div>
          <div class="tiles">${report.categories
            .map(
              (c) => `<button class="tile" data-cat="${esc(c.category)}" aria-pressed="${state.filter === c.category}" ${print ? "disabled" : ""}>
                <span>${esc(label(c.category))}</span>${pill(c.score)}</button>`,
            )
            .join("")}</div>
        </section>
      </aside>
      <div class="pr-main">
        <div class="tabs-bar"><nav class="tabs" role="tablist">${TABS.map(
          (t) => `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === state.tab}">${t.label}<small>${n[t.id]}</small></button>`,
        ).join("")}</nav></div>
        ${state.filter ? `<p class="t-small filtering muted">Showing ${esc(label(state.filter))} only. <button class="link" id="clear">Show all categories</button></p>` : ""}
        ${TABS.map(
          (t) => `<section class="tab-panel" data-panel="${t.id}" ${!print && t.id !== state.tab ? "hidden" : ""}>
            <h2 class="print-title t-card-title">${t.label}</h2>
            ${t.pick ? groups(findings.filter(t.pick), page.findings, report.categories, print) : metricsHtml(metrics)}
          </section>`,
        ).join("")}
      </div>
    </div>`;

    if (print) {
      el.querySelectorAll("details").forEach((d) => (d.open = true));
      return;
    }
    el.querySelectorAll(".tile").forEach((b) =>
      b.addEventListener("click", () => {
        state.filter = state.filter === b.dataset.cat ? null : b.dataset.cat;
        draw();
      }),
    );
    el.querySelector("#clear")?.addEventListener("click", () => {
      state.filter = null;
      draw();
    });
    el.querySelectorAll(".tab").forEach((b) =>
      b.addEventListener("click", () => {
        state.tab = b.dataset.tab;
        draw();
      }),
    );
  };
  draw();
}

function groups(list, all, categories, print) {
  if (!list.length) return `<p class="t-small muted none">Nothing here.</p>`;
  const score = Object.fromEntries(categories.map((c) => [c.category, c.score]));
  const byCat = new Map();
  for (const f of [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status])) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category).push(f);
  }
  return [...byCat]
    .sort(([a], [b]) => (score[a] ?? 100) - (score[b] ?? 100))
    .map(([cat, items]) => {
      const c = counts(all.filter((f) => f.category === cat));
      return `<div class="group-head">
          <h3 class="t-small-title">${esc(label(cat))}</h3>${score[cat] != null ? pill(score[cat]) : ""}
          <p class="t-meta">${c.fail} failing, ${plural(c.warn, "warning")}, ${c.pass} passed</p>
        </div>
        <div class="list">${items.map((f) => finding(f, print || f.status === "fail")).join("")}</div>`;
    })
    .join("");
}

function trend(runs) {
  if (runs.length < 2) return "";
  const shown = [...runs].sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  const first = shown[0];
  const last = shown.at(-1);
  const delta = last.score - first.score;
  return `<div class="trend">
    <div class="trend-head">
      <p class="t-strong">Across ${shown.length} runs</p>
      <p class="t-strong ${delta < 0 ? "trend-down" : "t-brand"}">${delta >= 0 ? "+" : ""}${delta} since ${esc(day(first.date))}</p>
    </div>
    <div class="bars">${shown
      .map(
        (r) => `<div class="${r === last ? "latest" : ""}">
          <span class="t-strong">${r.score}</span>
          <i style="height:${Math.max(8, Math.round(r.score * 1.5))}px"></i>
          <span class="t-meta">${esc(day(r.date))}</span>
        </div>`,
      )
      .join("")}</div>
  </div>`;
}
