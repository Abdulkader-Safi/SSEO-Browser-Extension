// Multi-page audits, shared by the side panel and the dashboard: the form with
// its modes (one page, a list of pages, a whole site) and the progress card for
// the running job. The job itself runs in background.js.

import { JOB_KEY, esc, normalizeUrl } from "./lib.js";
import { plural } from "./ui.js";

export const MAX_LIST = 100;
export const MAX_CRAWL = 200;
const DEFAULT_CRAWL = 25;
// Matches background.js: a job that has not reported in this long died.
const STALE_MS = 60_000;

const MODES = [
  { id: "one", label: "One page" },
  { id: "list", label: "List of pages" },
  { id: "crawl", label: "Whole site" },
];

/**
 * @param one     markup for the "One page" mode, or null to leave that mode out
 * @param site    address to prefill the whole-site field with
 * @param mode    the mode to show
 */
export function bulkHtml({ one = null, site = "", mode = "list" }) {
  const modes = MODES.filter((m) => m.id !== "one" || one);
  if (!modes.some((m) => m.id === mode)) mode = modes[0].id;
  return `<section class="card bulk" data-bulk>
    <nav class="tabs seg" role="tablist" aria-label="What to audit">${modes
      .map((m) => `<button type="button" class="tab" role="tab" data-mode="${m.id}" aria-selected="${m.id === mode}">${m.label}</button>`)
      .join("")}</nav>
    ${one ? `<div class="bulk-mode" data-panel="one" ${mode === "one" ? "" : "hidden"}>${one}</div>` : ""}
    <form class="bulk-mode" data-panel="list" ${mode === "list" ? "" : "hidden"}>
      <textarea id="bulk-list" data-keep rows="5" spellcheck="false" placeholder="example.com/&#10;example.com/pricing&#10;example.com/blog" aria-label="Pages to audit, one per line"></textarea>
      <div class="bulk-foot">
        <p class="t-meta">One address per line, up to ${MAX_LIST}. Pages are audited one after another.</p>
        <button class="btn btn-primary">Audit pages</button>
      </div>
    </form>
    <form class="bulk-mode" data-panel="crawl" ${mode === "crawl" ? "" : "hidden"}>
      <label class="field"><i class="icon i-globe"></i>
        <input id="bulk-site" data-keep type="text" inputmode="url" value="${esc(site)}" placeholder="example.com" aria-label="Website to audit">
      </label>
      <div class="bulk-foot">
        <label class="limit t-label">Up to
          <input id="bulk-max" data-keep type="number" min="1" max="${MAX_CRAWL}" value="${DEFAULT_CRAWL}" aria-label="Most pages to audit">
          pages</label>
        <button class="btn btn-primary">Audit site</button>
      </div>
      <p class="t-meta">Starts at this address and follows links on the same site. Larger sites take a few minutes.</p>
    </form>
    <p class="bulk-error t-meta" role="alert" hidden></p>
  </section>`;
}

/** Wires a rendered bulkHtml. onMode remembers the chosen mode across re-renders. */
export function wireBulk(root, { onMode = () => {}, onStarted = () => {} } = {}) {
  const box = root.querySelector("[data-bulk]");
  if (!box) return;
  const error = box.querySelector(".bulk-error");
  const fail = (msg) => {
    error.textContent = msg;
    error.hidden = !msg;
  };

  box.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      box.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      box.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.mode));
      fail("");
      onMode(b.dataset.mode);
    }),
  );

  /** Resolves to true once the background accepted the job. */
  const send = async (msg, form) => {
    const button = form.querySelector("button");
    const text = button.textContent;
    button.disabled = true;
    button.textContent = "Starting";
    let res;
    try {
      res = await chrome.runtime.sendMessage(msg);
    } catch {
      res = undefined;
    } finally {
      button.disabled = false;
      button.textContent = text;
    }
    // No answer means the background is an older copy that doesn't know this job.
    if (!res) return fail("SSEO was just updated. Reload it on the extensions page, then try again."), false;
    if (res.state === "busy") return fail("Another multi-page audit is running. Wait for it to finish or stop it."), false;
    if (res.state === "error") return fail(res.error), false;
    fail("");
    onStarted(msg);
    return true;
  };

  box.querySelector('[data-panel="list"]').addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const field = box.querySelector("#bulk-list");
    const lines = field.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const urls = lines.map(normalizeUrl);
    const bad = lines.filter((_, i) => !urls[i]);
    if (!lines.length) return fail("Paste at least one address.");
    if (bad.length) return fail(`Not a web address: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ` and ${bad.length - 3} more` : ""}.`);
    const unique = [...new Set(urls)];
    if (unique.length > MAX_LIST) return fail(`That's ${unique.length} pages. The limit is ${MAX_LIST} per list.`);
    if (await send({ type: "list", urls: unique }, ev.target)) field.value = "";
  });

  box.querySelector('[data-panel="crawl"]').addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const url = normalizeUrl(box.querySelector("#bulk-site").value);
    if (!url) return fail("Enter the website's address, for example example.com.");
    const max = Math.min(MAX_CRAWL, Math.max(1, Math.round(Number(box.querySelector("#bulk-max").value) || DEFAULT_CRAWL)));
    await send({ type: "crawl", url, max }, ev.target);
  });
}

// ---- Progress card ---------------------------------------------------------

export async function getJob() {
  return (await chrome.storage.session.get(JOB_KEY))[JOB_KEY] ?? null;
}

export function jobHtml(job, { openLink = false } = {}) {
  if (!job) return "";
  const live = ["running", "stopping"].includes(job.state);
  const dead = live && Date.now() - job.at > STALE_MS;
  const what = job.kind === "crawl" ? `${esc(new URL(job.origin).host)} site audit` : "Page list audit";

  if (job.state === "error" || dead) {
    return card(`<p class="t-strong">${what} stopped</p>
      <p class="t-small muted">${esc(dead ? "The browser ended it before it finished. Start it again." : job.error)}</p>`, true);
  }
  if (job.state === "done") {
    const msg = job.stopped
      ? job.kind === "crawl"
        ? "Stopped. Nothing was saved."
        : `Stopped after ${plural(job.saved, "page")}.`
      : `${plural(job.saved, "page")} saved${job.saved < job.total ? `, ${job.total - job.saved} failed` : ""}.`;
    const open = openLink && job.saved
      ? `<a class="btn btn-quiet" href="dashboard.html#site=${encodeURIComponent(job.origin)}" target="_blank"><i class="icon i-dashboard"></i>Open in dashboard</a>`
      : "";
    return card(`<p class="t-strong">${what} finished</p><p class="t-small muted">${msg}</p>${open}`, true);
  }

  const checks = job.phase === "Running checks";
  const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const count = checks ? `${job.done} of ${job.total} checks` : `${job.done} of ${job.total}${job.kind === "crawl" && job.phase === "Finding pages" ? " pages max" : ""}`;
  const title = job.state === "stopping" ? "Stopping after the current step" : job.kind === "crawl" ? `${job.phase}` : "Auditing pages";
  let current = "";
  try {
    if (job.current) current = new URL(job.current).pathname || "/";
  } catch {
    /* not a URL */
  }
  return card(`<div class="progress-head"><p class="t-strong">${esc(title)}</p><p class="t-meta">${count}</p></div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>
    <div class="job-foot">
      <p class="t-meta one-line">${esc(what)}${current ? ` · ${esc(current)}` : ""}</p>
      <button class="btn btn-quiet" data-job="stop" ${job.state === "stopping" ? "disabled" : ""}>Stop</button>
    </div>`);
}

function card(body, dismissable = false) {
  return `<section class="card job" aria-live="polite">${body}${
    dismissable ? `<button class="icon-btn quiet job-close" data-job="dismiss" title="Dismiss" aria-label="Dismiss"><i class="icon i-check"></i></button>` : ""
  }</section>`;
}

export function wireJob(root) {
  root.querySelector('[data-job="stop"]')?.addEventListener("click", () => chrome.runtime.sendMessage({ type: "stop" }));
  root.querySelector('[data-job="dismiss"]')?.addEventListener("click", () => chrome.storage.session.remove(JOB_KEY));
}
