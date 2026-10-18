import { esc, getIndex, getReport, pageUrl, runKey, startAudit } from "./lib.js";
import { mount } from "./view.js";

// A page audited this recently shows its last run instead of re-auditing.
const REUSE_MS = 10 * 60_000;

const view = document.getElementById("view");
const urlEl = document.getElementById("url");
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
  urlEl.textContent = url ?? "";
  rerun.hidden = !url;
  if (!url) {
    view.innerHTML = `<p class="empty">Open a website to audit it. Browser pages like this one can't be checked.</p>`;
    return;
  }

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
  view.innerHTML = `<div class="empty"><p>This page hasn't been audited yet.</p>
    <button id="go" class="btn primary">Audit this page</button></div>`;
  view.querySelector("#go").addEventListener("click", () => run());
}

async function run() {
  if (!url) return;
  view.innerHTML = progress("Starting", 0, 0);
  const state = await startAudit(url, title);
  if (state?.state === "error") onRun(state);
}

async function onRun(s) {
  if (s.state === "running") view.innerHTML = progress(s.phase, s.done, s.total);
  else if (s.state === "done") await show(s.id);
  else if (s.state === "error") view.innerHTML = `<p class="empty">The audit failed: ${esc(s.error)}</p>`;
}

function progress(phase, done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="progress">
    <p>${esc(phase)}${total ? ` (${done} of ${total})` : ""}</p>
    <div class="track"><div class="fill" style="width:${pct}%"></div></div>
  </div>`;
}

async function show(id) {
  const showing = url;
  const report = await getReport(id);
  if (showing !== url) return; // the user moved to another tab meanwhile
  if (!report) {
    view.innerHTML = `<p class="empty">That report is gone. Run it again.</p>`;
    return;
  }
  mount(view, report);
}
