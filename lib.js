// Shared by the service worker, popup, dashboard and report page.
//
// Storage layout (chrome.storage.local):
//   index           array of run summaries, newest first
//   report:<id>     the scanner's full AuditReport for one run
// Live progress sits in chrome.storage.session under run:<url>.

export const runKey = (url) => `run:${url}`;
export const reportKey = (id) => `report:${id}`;

/** Page address without the #fragment, so one page maps to one history entry. */
export function pageUrl(u) {
  const x = new URL(u);
  x.hash = "";
  return x.toString();
}

export async function getIndex() {
  const { index = [] } = await chrome.storage.local.get("index");
  return index;
}

export async function getReport(id) {
  const key = reportKey(id);
  return (await chrome.storage.local.get(key))[key];
}

export async function deleteRuns(ids) {
  const drop = new Set(ids);
  const index = (await getIndex()).filter((e) => !drop.has(e.id));
  await chrome.storage.local.remove(ids.map(reportKey));
  await chrome.storage.local.set({ index });
}

/** Ask the service worker to audit a URL. Resolves once the run has started. */
export function startAudit(url, title = "") {
  return chrome.runtime.sendMessage({ type: "audit", url, title });
}

export const tone = (score) => (score >= 90 ? "good" : score >= 50 ? "ok" : "bad");

export function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function when(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function label(category) {
  return category.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
}
