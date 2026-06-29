# Sheets Range to Image (Firefox extension)

Export a selected range of cells in **Google Sheets** as a high‑quality PNG —
with full **emoji** support. The image is shown in an in‑page dialog where you
can **download** it or **copy it to the clipboard**. Nothing is downloaded
automatically.

## How it works

1. Adds **Sheets Range to Image** to the native Google Sheets **Extensions** menu.
   Hovering it reveals **Convert Selected Range to Image**.
2. On click, a *Converting Range to Image…* pill appears at the bottom‑right of
   the page (in‑page only — not a Windows notification).
3. The extension **reconstructs the image from the cell data**. Google Sheets'
   copy data is a fully‑styled HTML table (fonts, colors, backgrounds, borders,
   alignment, merged cells and the real text incl. emoji) covering the *whole*
   selection — even rows/columns scrolled off screen. The extension renders that
   table to a high‑resolution canvas (3× supersampled), so the output is crisp
   and bounded exactly to the selected cells.
4. The PNG opens in an in‑Sheets dialog with **Download PNG** and
   **Copy to Clipboard** buttons.

> Note: generating the image briefly uses the clipboard to obtain the selection
> data, so your clipboard will contain the copied cells afterwards.

## Install (temporary, for development/testing)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add‑on…**.
3. Select the `manifest.json` file in this folder.
4. Open any Google Sheet and use **Extensions → Sheets Range to Image →
   Convert Selected Range to Image**.

> Temporary add‑ons are removed when Firefox restarts. To install permanently,
> publish to AMO — see [PUBLISHING.md](PUBLISHING.md).

## Permissions

| Permission | Why |
|---|---|
| `clipboardRead` | Read the selection's styled‑HTML (the copied cell data) to reconstruct the image. |
| `clipboardWrite` | Trigger the copy of the selection, and write the result on **Copy to Clipboard**. |
| Host access to `docs.google.com/spreadsheets/*` | The content script runs only on Google Sheets. |

The extension is only ever active on `https://docs.google.com/spreadsheets/*`,
requests no broad host permissions, and **never sends data anywhere** — all
processing happens locally in your browser.

## Notes & limitations

- The image is rebuilt from the copied cell data, so it is **not** limited to the
  visible viewport — the entire selection is rendered, at any size.
- Rendering uses the browser's own fonts. Standard Sheets fonts (Arial, etc.)
  match exactly; an unusual custom font not installed locally would fall back to
  a similar system font.
- Images/charts placed *over* cells aren't part of the copied cell data and are
  omitted (they would also taint the canvas and block export).

## Files

- `manifest.json` — Firefox MV2 manifest.
- `content.js` — menu injection, clipboard reconstruction, toast, and modal.
- `content.css` — styling for the menu item, toast, and dialog.
- `icons/icon.svg` — extension icon.
- `LICENSE` — MIT license.
- `PUBLISHING.md` — how to package and publish to addons.mozilla.org.
- `PRIVACY.md` — privacy policy (no data collected).
