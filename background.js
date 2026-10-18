import { audit } from "./dist/scanner.js";
import { getIndex, pageUrl, reportKey, runKey } from "./lib.js";

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

// A run that has not reported in this long died with a previous worker.
const STALE_MS = 60_000;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "audit") return;
  (async () => {
    try {
      sendResponse(await start(msg.url, msg.title));
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
      onProgress(e) {
        if (e.type === "crawl_complete") {
          set({ state: "running", phase: "Running checks", done: 0, total: e.checksTotal });
        } else if (e.type === "check_complete") {
          set({ state: "running", phase: "Running checks", done: e.checksDone, total: e.checksTotal });
        }
      },
    });
    const id = await save(url, title, report);
    await set({ state: "done", id });
  } catch (err) {
    await set({ state: "error", error: err.message });
  }
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
