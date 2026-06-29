# Publishing to addons.mozilla.org (AMO)

This guide walks through validating, packaging, and submitting **Sheets Range to
Image** to the Firefox Add-ons store.

---

## 1. Fill in your details first

These placeholders must be replaced before you publish:

- **`manifest.json`**
  - `author` — your name or organization (shown on the listing).
  - `homepage_url` — your site or the repo URL (or remove the line).
  - `browser_specific_settings.gecko.id` — change `sheets-range-to-image@local.extension`
    to an ID you control, e.g. `sheets-range-to-image@yourdomain.com`. This ID is
    permanent for the life of the add-on, so pick it carefully.
- **`LICENSE`** — replace `Your Name` with the copyright holder.
- **`PRIVACY.md`** — replace the contact email. You'll paste this policy (or a
  link to it) into the AMO listing.

> **Name / trademark note:** AMO may reject listings that imply official
> affiliation with Google. The internal name can stay "Sheets Range to Image,"
> but for the public listing title consider something like
> *"Range to Image for Google Sheets™"* and add a disclaimer in the description
> ("Not affiliated with or endorsed by Google"). Keep "Google Sheets" only as a
> descriptor.

---

## 2. Install the tooling

[`web-ext`](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)
is Mozilla's official CLI for linting and packaging.

```bash
npm install --global web-ext
```

---

## 3. Lint (catch problems before submitting)

From the extension folder:

```bash
web-ext lint
```

Fix any **errors** (warnings are usually fine). This catches manifest issues,
disallowed APIs, and packaging mistakes that would otherwise fail AMO review.

---

## 4. Test it live

```bash
web-ext run
```

This launches a temporary Firefox with the extension loaded. Open a Google Sheet
and confirm the menu item, conversion, download, and copy all work.

---

## 5. Build the package

```bash
web-ext build
```

This produces a signed-ready ZIP in `web-ext-artifacts/`
(e.g. `sheets_range_to_image-1.0.0.zip`).

> Manual alternative: zip the **contents** of the folder (not the folder itself)
> so that `manifest.json` is at the root of the archive. Exclude
> `web-ext-artifacts/`, `node_modules/`, and any `.git` files.

---

## 6. Submit to AMO

1. Create / sign in to a developer account at
   <https://addons.mozilla.org/developers/>.
2. Click **Submit a New Add-on** and upload the ZIP from step 5.
3. Choose distribution:
   - **On this site (listed)** — published publicly on AMO, searchable, auto-updates.
   - **On your own (self-distribution)** — Mozilla signs the file and you host it.
4. Upload completes an automated validation pass. Because this build uses only
   `clipboardRead` / `clipboardWrite` and a single host (`docs.google.com`), it
   avoids the broad-permission flags that trigger long manual reviews.
5. Fill in the listing:
   - **Summary / description** (you can adapt `README.md`).
   - **Categories** (e.g. *Productivity*).
   - **Screenshots** — a shot of the menu item and of the result dialog.
   - **Icon** — AMO uses `icons/icon.svg`; you may also upload a 128×128 PNG.
   - **Privacy policy** — paste `PRIVACY.md` or link to a hosted copy.
   - **Data collection disclosure** — select **does not collect data**.
6. Submit for review. Listed add-ons are typically reviewed within a few days.

---

## 7. Updating later

1. Bump `version` in `manifest.json` (e.g. `1.0.0` → `1.0.1`).
2. `web-ext build` again.
3. Upload the new ZIP as a new version on the add-on's **Manage** page.

---

## Notes

- The source code here is **not minified**, so no separate "source code upload"
  is required for review.
- Minimum supported Firefox is set to **127.0** in `manifest.json` because the
  reconstruction path relies on `navigator.clipboard.read()` reading `text/html`,
  which is enabled by default from Firefox 127.
