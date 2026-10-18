# SSEO

A Chrome extension that audits the SEO of the page you are on with [Safi Studio Scanner](https://github.com/Abdulkader-Safi/Safi-Studio-Scanner) and keeps a history of every page you checked.

- Click the toolbar icon to open the side panel, which audits the current page only. It shows the score, a score per category (click one to filter), failing checks first with the evidence and the fix, and the raw page data. The panel follows the tab you are on: a page audited in the last 10 minutes shows its last result, any other page gets an "Audit this page" button.
- The dashboard lists every audited site and page, with each page's past runs. You can re-audit, delete, or paste any address to audit it.
- Every run opens as a full-page report in the same layout as the panel, saved as PDF through Chrome's print dialog. "Site PDF" merges the latest audit of every page on a site into one report.
- Open the dashboard from the side panel, or type `sseo` and a space in the address bar, then Enter.

## Install

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick this folder. After changing code, run `npm run build` again if you touched `scanner-entry.js`, then click the reload arrow on the extension card.

## Limits

- Chrome does not let extensions add new `chrome://` pages. Only bookmarks, history and the new tab page can be replaced, so the dashboard lives at the extension's own address.
- The page is fetched fresh without your cookies, the same way a search crawler sees it. Pages behind a login are audited logged out, and pages that build their content with JavaScript show only their initial HTML.
- Accessibility and Core Web Vitals checks need a headless browser in the scanner, so they don't run here.

## Files

```
manifest.json      Permissions, side panel and the sseo address-bar keyword
background.js      Runs audits, saves history
panel.html/.js/.css Side panel: the audit of the current page
tokens.css         Design tokens, fonts and icon classes from the Figma file
icons/             Reicon SVGs (CSS masks), logo.svg and the app icon PNGs rendered from it
ui.js              Markup shared by the panel, dashboard and reports
pagereport.js      Page report body used by the dashboard and PDFs
components.css     Shared component styles
dashboard.html/.js/.css History of sites and pages, and the page report
report.html/.js    Full report, PDF and JSON export
lib.js             Storage and small helpers shared by all pages
scanner-entry.js   What gets bundled from the scanner into dist/scanner.js
```
