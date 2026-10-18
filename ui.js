// Markup for the pieces the side panel, dashboard and report page share. Every
// string from a report goes through esc().

import { esc, when } from "./lib.js";

export const tone = (score) => (score >= 90 ? "pass" : score >= 50 ? "warning" : "fail");

export const verdict = (score) =>
  score >= 90 ? "In good shape" : score >= 50 ? "Needs work" : "Needs attention";

export const pill = (score) => `<span class="pill ${tone(score)}">${score}</span>`;

export function counts(findings) {
  const n = (s) => findings.filter((f) => f.status === s).length;
  return { fail: n("fail"), warn: n("warn"), pass: n("pass"), info: n("info") };
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function tally(c) {
  return `<ul class="tally-list">
    <li><i class="dot fail"></i><span class="t-label">${c.fail} failing</span></li>
    <li><i class="dot warning"></i><span class="t-label">${plural(c.warn, "warning")}</span></li>
    <li><i class="dot pass"></i><span class="t-label">${c.pass} passed</span></li>
  </ul>`;
}

/** 128px score ring, 9px thick, from the Figma "Score ring" component. */
export function ring(score) {
  const r = 59.5;
  const c = 2 * Math.PI * r;
  return `<div class="ring ${tone(score)}" role="img" aria-label="Score ${score} out of 100">
    <svg width="128" height="128" viewBox="0 0 128 128" fill="none">
      <circle class="track" cx="64" cy="64" r="${r}" stroke-width="9"/>
      <circle class="arc" cx="64" cy="64" r="${r}" stroke-width="9" stroke-dasharray="${(c * score) / 100} ${c}"/>
    </svg>
    <span class="t-metric">${score}</span>
    <span class="t-meta">out of 100</span>
  </div>`;
}

export function finding(f, open = false) {
  const status = f.status === "warn" ? "warning" : f.status;
  const more = f.details || f.evidence || f.fix;
  return `<details class="finding" ${open && more ? "open" : ""}>
    <summary>
      <i class="dot ${status}"></i>
      <span class="text"><span class="t-strong">${esc(f.title)}</span><span class="t-small muted">${esc(f.message)}</span></span>
      <i class="icon i-chevron-down chev"></i>
    </summary>
    ${
      more
        ? `<div class="detail">
            ${f.details ? `<p class="t-small">${esc(f.details)}</p>` : ""}
            ${f.evidence ? `<pre class="evidence t-code">${esc(f.evidence)}</pre>` : ""}
            ${f.fix ? `<p class="t-small">Fix: ${esc(f.fix)}</p>` : ""}
          </div>`
        : ""
    }
  </details>`;
}

/** Measurements: a list of values, then each table as an expandable card. */
export function metricsHtml(metrics) {
  if (!metrics.length) return `<p class="t-small muted none">No data here.</p>`;
  const values = metrics.filter((m) => m.kind === "value");
  const tables = metrics.filter((m) => m.kind === "table");
  return `
    ${
      values.length
        ? `<section class="card kv">${values
            .map(
              (m) => `<div class="kv-row">
                <span class="t-label">${esc(m.label)}</span>
                <div><p class="t-strong v-${esc(m.status ?? "")}">${m.value == null ? "Missing" : `${esc(m.value)}${m.unit ? ` ${esc(m.unit)}` : ""}`}</p>
                ${m.note ? `<p class="t-meta">${esc(m.note)}</p>` : ""}</div>
              </div>`,
            )
            .join("")}</section>`
        : ""
    }
    ${
      tables.length
        ? `<div class="list">${tables
            .map(
              (t) => `<details class="finding">
                <summary><span class="text"><span class="t-strong">${esc(t.label)}</span><span class="t-meta">${plural(t.total, "row")}</span></span><i class="icon i-chevron-down chev"></i></summary>
                <div class="detail table-wrap">
                  <table class="data-table">
                    <tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>
                    ${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}
                  </table>
                  ${t.total > t.rows.length ? `<p class="t-meta">First ${t.rows.length} of ${t.total}.</p>` : ""}
                </div>
              </details>`,
            )
            .join("")}</div>`
        : ""
    }`;
}

export function ago(iso) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `on ${when(iso)}`;
}

export const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export const short = (iso) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
