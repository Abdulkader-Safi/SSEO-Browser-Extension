import { aggregate, allCollectors, audit, value } from "./dist/scanner.js";
import { JOB_KEY, getIndex, pageUrl, reportKey, runKey } from "./lib.js";

// The scanner follows redirects itself with redirect: "manual" and reads the
// Location header. Browsers hide both behind an opaque response, so for those
// calls we let fetch follow, then hand the scanner one synthetic 301 pointing
// at the final address and serve the real response when it asks for it.
// ponytail: a multi-hop chain reports as one hop; fine for SEO checks.
const realFetch = globalThis.fetch.bind(globalThis);
const parked = new Map();
globalThis.fetch = async (input, init = {}) => {
  if (init.redirect !== "manual") return realFetch(input, init);
  const method = init.method || "GET";
  const url = String(input);
  const hit = parked.get(`${method} ${url}`);
  if (hit) {
    parked.delete(`${method} ${url}`);
    return hit;
  }
  const res = await realFetch(input, { ...init, redirect: "follow" });
  if (!res.redirected || res.url === url) return res;
  parked.set(`${method} ${res.url}`, res);
  return new Response(null, { status: 301, headers: { location: res.url } });
};

// The toolbar icon opens the side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// A run that has not reported in this long died with a previous worker.
const STALE_MS = 60_000;

// The scanner keeps no page title, so record it as one more measurement. Pages
// found by a crawl or pasted in a list get their name from it.
const collectors = [
  ...allCollectors,
  {
    id: "sseo/page-title",
    category: "core-seo",
    collect: ({ page }) => [value("core-seo/page-title", "Page title", page.$("title").first().text().trim() || null)],
  },
];
const titleOf = (page) => page?.metrics.find((m) => m.id === "core-seo/page-title")?.value ?? "";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    audit: () => start(msg.url, msg.title),
    list: () => startJob(() => listJob(msg.urls)),
    crawl: () => startJob(() => crawlJob(msg.url, msg.max)),
    stop: () => {
      stopRequested = true;
      return { ok: true };
    },
  };
  const handler = handlers[msg?.type];
  if (!handler) return;
  (async () => {
    try {
      sendResponse(await handler());
    } catch (err) {
      sendResponse({ state: "error", error: err.message });
    }
  })();
  return true;
});

async function start(rawUrl, title) {
  const url = pageUrl(rawUrl);
  const key = runKey(url);
  const current = (await chrome.storage.session.get(key))[key];
  if (current?.state === "running" && Date.now() - current.at < STALE_MS) return current;
  run(url, title || "");
  return { state: "running" };
}

/** Audits one page and saves it. Resolves to the saved run id, or null on failure. */
async function run(url, title) {
  const key = runKey(url);
  // Every progress write also resets the worker's idle timer, which keeps it
  // alive for the length of the audit.
  const set = (v) => chrome.storage.session.set({ [key]: { ...v, at: Date.now() } });
  await set({ state: "running", phase: "Fetching the page", done: 0, total: 0 });

  try {
    const report = await audit(url, {
      maxPages: 1,
      maxDepth: 0,
      concurrency: 6,
      timeout: 10_000,
      collectors,
      onProgress(e) {
        if (e.type === "crawl_complete") {
          set({ state: "running", phase: "Running checks", done: 0, total: e.checksTotal });
        } else if (e.type === "check_complete") {
          set({ state: "running", phase: "Running checks", done: e.checksDone, total: e.checksTotal });
        }
      },
    });
    const id = await save(url, title || titleOf(report.pages[0]), report);
    await set({ state: "done", id });
    return id;
  } catch (err) {
    await set({ state: "error", error: err.message });
    return null;
  }
}

// ---- Multi-page jobs: a pasted list, or a crawl of one site ----------------
// One job at a time. Its state lives in session storage under JOB_KEY so the
// panel and dashboard can both show it.

let stopRequested = false;
const setJob = (v) => chrome.storage.session.set({ [JOB_KEY]: { ...v, at: Date.now() } });

async function startJob(body) {
  const current = (await chrome.storage.session.get(JOB_KEY))[JOB_KEY];
  if (current && ["running", "stopping"].includes(current.state) && Date.now() - current.at < STALE_MS) {
    return { state: "busy" };
  }
  stopRequested = false;
  body().catch((err) => setJob({ state: "error", error: err.message }));
  return { state: "running" };
}

async function listJob(raw) {
  const urls = [...new Set(raw.map(pageUrl))];
  if (!urls.length) return setJob({ kind: "list", state: "error", error: "No addresses to audit." });
  let saved = 0;
  for (const [i, url] of urls.entries()) {
    if (stopRequested) break;
    await setJob({ kind: "list", state: "running", done: i, total: urls.length, current: url, origin: new URL(urls[0]).origin });
    if (await run(url, "")) saved++;
  }
  await setJob({ kind: "list", state: "done", saved, total: urls.length, stopped: stopRequested, origin: new URL(urls[0]).origin });
}

async function crawlJob(rawUrl, max) {
  const url = pageUrl(rawUrl);
  const base = { kind: "crawl", url, origin: new URL(url).origin };
  const state = () => (stopRequested ? "stopping" : "running");
  await setJob({ ...base, state: "running", phase: "Finding pages", done: 0, total: max });

  // A crawl reports a check per rule per page, so progress writes are throttled.
  let last = 0;
  const tick = (v) => {
    if (Date.now() - last < 300) return;
    last = Date.now();
    setJob({ ...base, state: state(), ...v });
  };
  const report = await audit(url, {
    maxPages: max,
    maxDepth: 10,
    concurrency: 6,
    timeout: 10_000,
    collectors,
    onProgress(e) {
      if (e.type === "page_fetched") tick({ phase: "Finding pages", done: e.index, total: max, current: e.url });
      else if (e.type === "check_complete") tick({ phase: "Running checks", done: e.checksDone, total: e.checksTotal, current: e.url });
    },
  });
  // ponytail: the scanner can't be interrupted, so Stop on a crawl discards the result when it lands.
  if (stopRequested) return setJob({ ...base, state: "done", saved: 0, total: report.pages.length, stopped: true });

  await setJob({ ...base, state: "running", phase: "Saving", done: 0, total: report.pages.length });
  for (const page of report.pages) {
    const one = aggregate(page.url, report.generatedAt, [page]);
    await save(pageUrl(page.url), titleOf(page), one);
  }
  await setJob({ ...base, state: "done", saved: report.pages.length, total: report.pages.length });
}

// Serialize index writes so two runs finishing together don't drop one.
let saving = Promise.resolve();
function save(url, title, report) {
  const job = saving.then(async () => {
    const id = crypto.randomUUID();
    const page = report.pages[0];
    const count = (s) => page?.findings.filter((f) => f.status === s).length ?? 0;
    const entry = {
      id,
      url,
      origin: new URL(url).origin,
      title,
      score: report.score,
      status: page?.status ?? 0,
      fail: count("fail"),
      warn: count("warn"),
      date: report.generatedAt,
    };
    const index = [entry, ...(await getIndex())];
    await chrome.storage.local.set({ [reportKey(id)]: report, index });
    return id;
  });
  saving = job.catch(() => {});
  return job;
}

// Type "sseo" then a space in the address bar to open the dashboard.
chrome.omnibox.setDefaultSuggestion({ description: "Open the SSEO dashboard" });
chrome.omnibox.onInputEntered.addListener(async (text) => {
  const q = text.trim() ? `#q=${encodeURIComponent(text.trim())}` : "";
  await chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${q}`) });
});
