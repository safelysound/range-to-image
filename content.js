/*
 * Sheets Range to Image — content script.
 *
 * Responsibilities:
 *   1. Inject a "Sheets Range to Image" item into the native Google Sheets
 *      "Extensions" menu, with a hover sub-item "Convert Selected Range to Image".
 *   2. On click: reconstruct an image of the current selection from Google
 *      Sheets' styled-HTML clipboard data, rendered to a high-resolution canvas,
 *      and show it in an in-page modal with Download / Copy-to-clipboard buttons.
 *
 * Rebuilding from the clipboard's HTML table (rather than screenshotting pixels)
 * gives crisp output bounded exactly to the selection, covers the whole range
 * even when scrolled off screen, and preserves emoji and cell formatting.
 */
(function () {
  "use strict";

  const EXT_NAME = "Sheets Range to Image";
  const SUB_LABEL = "Convert Selected Range to Image";

  // ---------------------------------------------------------------------------
  // 1. Menu injection
  // ---------------------------------------------------------------------------

  let submenuEl = null;
  let hideSubmenuTimer = null;

  // Google Sheets creates each top-level menu element ONCE and then just
  // repopulates / re-shows it. So we can't rely on a whole menu being *added*
  // to the DOM — instead, whenever anything changes inside any menu, we rescan
  // every existing menu and inject into the Extensions one.
  let scanScheduled = false;
  function requestScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scanMenus();
    }, 40);
  }

  const menuObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (mutationTouchesMenu(m)) {
        requestScan();
        return;
      }
    }
  });
  menuObserver.observe(document.documentElement, { childList: true, subtree: true });
  requestScan(); // in case a menu element already exists at load time

  function mutationTouchesMenu(m) {
    const t = m.target;
    if (t && t.closest && t.closest(".goog-menu")) return true;
    for (const n of m.addedNodes) {
      if (
        n instanceof HTMLElement &&
        (/goog-menu/.test(n.className || "") ||
          (n.querySelector && n.querySelector(".goog-menu, .goog-menuitem")))
      ) {
        return true;
      }
    }
    return false;
  }

  function scanMenus() {
    document.querySelectorAll(".goog-menu").forEach((menu) => {
      if (menu.querySelector(".szi-menuitem")) return; // already injected
      if (isExtensionsMenu(menu)) injectMenuItem(menu);
    });
  }

  // Identify the TOP-LEVEL Extensions menu by its menu items. It contains
  // "Apps Script" and "Macros". The "Add-ons" fly-out submenu instead contains
  // "Get add-ons" / "Manage add-ons", so we explicitly exclude that one (its
  // auto-close would otherwise take our item with it).
  function isExtensionsMenu(menu) {
    const items = menu.querySelectorAll(".goog-menuitem");
    if (!items.length) return false;
    let hasAppsScript = false;
    let hasMacros = false;
    let hasAddonsFlyoutItem = false;
    items.forEach((it) => {
      const t = (it.textContent || "").trim();
      if (/Apps\s*Script/i.test(t)) hasAppsScript = true;
      if (/\bMacros\b/i.test(t)) hasMacros = true;
      if (/(Get|Manage|Document)\s+add[-\s]?ons/i.test(t)) hasAddonsFlyoutItem = true;
    });
    return (hasAppsScript || hasMacros) && !hasAddonsFlyoutItem;
  }

  function injectMenuItem(menu) {
    if (menu.querySelector(".szi-menuitem")) return;

    const item = document.createElement("div");
    item.className = "goog-menuitem szi-menuitem";
    item.setAttribute("role", "menuitem");
    item.innerHTML =
      '<div class="goog-menuitem-content szi-menuitem-content">' +
      '<span class="szi-label"></span>' +
      '<span class="szi-arrow">▸</span>' +
      "</div>";
    item.querySelector(".szi-label").textContent = EXT_NAME;

    item.addEventListener("mouseenter", () => {
      cancelHideSubmenu();
      item.classList.add("goog-menuitem-highlight");
      showSubmenu(item);
    });
    item.addEventListener("mouseleave", () => {
      item.classList.remove("goog-menuitem-highlight");
      scheduleHideSubmenu();
    });

    menu.insertBefore(item, menu.firstChild);
  }

  function showSubmenu(anchor) {
    hideSubmenu();
    const rect = anchor.getBoundingClientRect();

    const sub = document.createElement("div");
    sub.className = "goog-menu goog-menu-vertical szi-submenu";
    sub.innerHTML =
      '<div class="goog-menuitem szi-subitem" role="menuitem">' +
      '<div class="goog-menuitem-content szi-subitem-content"></div>' +
      "</div>";
    sub.querySelector(".szi-subitem-content").textContent = SUB_LABEL;

    sub.style.position = "fixed";
    sub.style.top = rect.top + "px";
    sub.style.left = rect.right - 2 + "px";

    document.body.appendChild(sub);
    submenuEl = sub;

    // Keep the submenu open while the pointer is over it, and keep its hover
    // events from reaching Google's menu code (which could otherwise react to
    // the pointer "leaving" the menu and close it).
    sub.addEventListener("mouseenter", cancelHideSubmenu);
    sub.addEventListener("mouseleave", scheduleHideSubmenu);
    sub.addEventListener("mouseover", (e) => e.stopPropagation());
    sub.addEventListener("mousemove", (e) => e.stopPropagation());

    const subitem = sub.querySelector(".szi-subitem");
    subitem.addEventListener("mouseenter", () => subitem.classList.add("goog-menuitem-highlight"));
    subitem.addEventListener("mouseleave", () => subitem.classList.remove("goog-menuitem-highlight"));
    subitem.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeNativeMenus();
      hideSubmenu();
      convertSelectionToImage();
    });

    // If the submenu would run off the right edge, flip it to the left.
    const subRect = sub.getBoundingClientRect();
    if (subRect.right > window.innerWidth) {
      sub.style.left = Math.max(0, rect.left - subRect.width + 2) + "px";
    }
  }

  function hideSubmenu() {
    if (submenuEl && submenuEl.parentNode) submenuEl.parentNode.removeChild(submenuEl);
    submenuEl = null;
  }
  function scheduleHideSubmenu() {
    cancelHideSubmenu();
    // Generous grace period so moving the pointer from the menu item across to
    // the submenu never drops the hover.
    hideSubmenuTimer = setTimeout(hideSubmenu, 600);
  }
  function cancelHideSubmenu() {
    if (hideSubmenuTimer) {
      clearTimeout(hideSubmenuTimer);
      hideSubmenuTimer = null;
    }
  }

  // Close Google's Closure menus by simulating Escape. Unlike an outside
  // mousedown/click, Escape is how Sheets natively dismisses a menu AND returns
  // keyboard focus + the cell selection to the grid — which is exactly what the
  // copy command below needs in order to capture the selected range.
  function closeNativeMenus() {
    try {
      for (const type of ["keydown", "keyup"]) {
        document.dispatchEvent(
          new KeyboardEvent(type, {
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
      }
    } catch (e) {
      /* best effort */
    }
  }

  // Try to return keyboard focus to the Sheets grid so the copy command picks
  // up the active cell selection. Sheets renders its grid on a canvas, so we
  // focus the nearest focusable grid container we can find.
  function focusSheetsGrid() {
    const sel =
      ".grid-table-container, #waffle-grid-container, .grid-scrollable-wrapper, .waffle";
    const grid = document.querySelector(sel);
    if (grid) {
      try {
        grid.focus({ preventScroll: true });
      } catch (e) {
        /* not focusable; fall through */
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Convert: reconstruct the selection from clipboard HTML -> high-res PNG
  // ---------------------------------------------------------------------------

  async function convertSelectionToImage() {
    showLoading("Converting Range to Image…");

    try {
      const html = await getSelectionHtml();
      if (!html) {
        throw new Error("Couldn’t read the selection. Select a range of cells and try again.");
      }

      const result = await renderHtmlTableToImage(html);
      hideLoading();
      if (!result) throw new Error("Couldn’t build the image from the selection.");
      openResultModal(result);
    } catch (err) {
      hideLoading();
      showLoading("Failed: " + (err && err.message ? err.message : err), true);
      setTimeout(hideLoading, 3500);
      console.error("[Sheets Range to Image]", err);
    }
  }

  // Ask Google Sheets to copy the current selection, then read the rich HTML
  // table it places on the clipboard. The HTML covers the entire selection
  // (including rows/columns scrolled out of view) with full cell styling.
  async function getSelectionHtml() {
    // Make sure the grid (not our menu) holds focus, then let the just-closed
    // native menu fully dismiss before asking Sheets to copy.
    window.focus();
    focusSheetsGrid();
    await new Promise((r) => setTimeout(r, 120));

    try {
      document.execCommand("copy");
    } catch (e) {
      /* Sheets' own copy handler still runs on the dispatched event */
    }
    await new Promise((r) => setTimeout(r, 120)); // let the clipboard settle

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          const text = await blob.text();
          if (text && /<table/i.test(text)) return text;
        }
      }
      console.warn("[Sheets Range to Image] no valid HTML table found in clipboard");
    } catch (e) {
      console.warn("[Sheets Range to Image] clipboard read failed:", e);
    }
    return null;
  }

  // Render a Google Sheets clipboard HTML table to a high-resolution PNG by
  // laying it out off-screen and rasterizing it through an SVG <foreignObject>.
  async function renderHtmlTableToImage(html) {
    const SCALE = 3; // supersample for crisp, high-quality output

    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const table = tpl.content.querySelector("table");
    if (!table) return null;

    // Build an off-screen wrapper: any <style> blocks from Sheets + the table.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrapper.style.cssText =
      "position:fixed;left:-100000px;top:0;display:inline-block;margin:0;padding:0;background:#ffffff;";

    tpl.content.querySelectorAll("style").forEach((s) => wrapper.appendChild(s.cloneNode(true)));

    const tableClone = table.cloneNode(true);
    tableClone.style.borderCollapse = "collapse";
    tableClone.style.background = "#ffffff";
    tableClone.setAttribute("cellspacing", "0");
    tableClone.setAttribute("cellpadding", "0");
    // Drop any embedded images — they would taint the canvas and block export.
    tableClone.querySelectorAll("img").forEach((im) => im.remove());
    wrapper.appendChild(tableClone);

    document.body.appendChild(wrapper);

    let W, H;
    try {
      const r = tableClone.getBoundingClientRect();
      W = Math.ceil(r.width);
      H = Math.ceil(r.height);
      if (!W || !H) return null;

      // Switch the wrapper to its on-canvas form: no off-screen offset, scaled.
      wrapper.style.cssText =
        "display:inline-block;margin:0;padding:0;background:#ffffff;transform:scale(" +
        SCALE +
        ");transform-origin:top left;";

      const xml = new XMLSerializer().serializeToString(wrapper);
      const Wd = Math.ceil(W * SCALE);
      const Hd = Math.ceil(H * SCALE);

      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        Wd +
        '" height="' +
        Hd +
        '">' +
        '<foreignObject x="0" y="0" width="' +
        Wd +
        '" height="' +
        Hd +
        '">' +
        xml +
        "</foreignObject></svg>";

      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const img = await loadImage(url);

      const canvas = document.createElement("canvas");
      canvas.width = Wd;
      canvas.height = Hd;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, Wd, Hd);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      // The canvas height/width come from measuring the table in the live Sheets
      // page, but the SVG <foreignObject> often renders the table slightly
      // shorter/narrower (isolated styling context / font fallback). That leaves
      // white padding on the bottom and right. Trim back to the real content.
      const { width: cw, height: ch } = trimWhitespace(ctx, Wd, Hd, SCALE);

      let outCanvas = canvas;
      if (cw < Wd || ch < Hd) {
        outCanvas = document.createElement("canvas");
        outCanvas.width = cw;
        outCanvas.height = ch;
        const octx = outCanvas.getContext("2d");
        octx.fillStyle = "#ffffff";
        octx.fillRect(0, 0, cw, ch);
        octx.drawImage(canvas, 0, 0); // top-left anchored; extra bottom/right clipped
      }

      const outBlob = await new Promise((res) => outCanvas.toBlob(res, "image/png"));
      if (!outBlob) return null;
      return {
        blob: outBlob,
        dataUrl: outCanvas.toDataURL("image/png"),
        width: outCanvas.width,
        height: outCanvas.height,
      };
    } finally {
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    }
  }

  // Find the real content bounds of a white-backed canvas and return the cropped
  // width/height (top-left anchored). Scans inward from the bottom and right
  // edges, so it only reads the few blank rows/cols it needs to trim.
  function trimWhitespace(ctx, w, h, scale) {
    const NEAR_WHITE = 248; // treat >=248 on all channels as background
    const pad = Math.max(1, Math.round(scale)); // keep a hair of breathing room

    const rowIsBlank = (y) => {
      const d = ctx.getImageData(0, y, w, 1).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < NEAR_WHITE || d[i + 1] < NEAR_WHITE || d[i + 2] < NEAR_WHITE) return false;
      }
      return true;
    };
    const colIsBlank = (x) => {
      const d = ctx.getImageData(x, 0, 1, h).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < NEAR_WHITE || d[i + 1] < NEAR_WHITE || d[i + 2] < NEAR_WHITE) return false;
      }
      return true;
    };

    let bottom = h - 1;
    while (bottom > 0 && rowIsBlank(bottom)) bottom--;
    let right = w - 1;
    while (right > 0 && colIsBlank(right)) right--;

    // bottom/right are now the last content row/col; +1 to convert to a size.
    return {
      width: Math.min(w, right + 1 + pad),
      height: Math.min(h, bottom + 1 + pad),
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not rasterize the cell layout."));
      img.src = src;
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Loading toast (bottom-right, in-page only)
  // ---------------------------------------------------------------------------

  let loadingEl = null;

  function showLoading(text, isError) {
    hideLoading();
    const el = document.createElement("div");
    el.className = "szi-toast" + (isError ? " szi-toast-error" : "");
    if (!isError) {
      const spin = document.createElement("span");
      spin.className = "szi-spinner";
      el.appendChild(spin);
    }
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);
    document.body.appendChild(el);
    loadingEl = el;
  }

  function hideLoading() {
    if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
    loadingEl = null;
  }

  // ---------------------------------------------------------------------------
  // 4. Result modal (in-page "window", with Download / Copy)
  // ---------------------------------------------------------------------------

  function openResultModal(result) {
    closeResultModal();

    const overlay = document.createElement("div");
    overlay.className = "szi-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeResultModal();
    });

    const dialog = document.createElement("div");
    dialog.className = "szi-dialog";

    const header = document.createElement("div");
    header.className = "szi-dialog-header";
    const title = document.createElement("div");
    title.className = "szi-dialog-title";
    title.textContent = "Range Image";
    const close = document.createElement("button");
    close.className = "szi-icon-btn";
    close.title = "Close";
    close.textContent = "✕";
    close.addEventListener("click", closeResultModal);
    header.appendChild(title);
    header.appendChild(close);

    const body = document.createElement("div");
    body.className = "szi-dialog-body";
    const img = document.createElement("img");
    img.className = "szi-preview";
    img.src = result.dataUrl;
    img.alt = "Selected range";
    body.appendChild(img);

    const footer = document.createElement("div");
    footer.className = "szi-dialog-footer";

    const status = document.createElement("div");
    status.className = "szi-status";

    const btnDownload = document.createElement("button");
    btnDownload.className = "szi-btn szi-btn-primary";
    btnDownload.textContent = "Download PNG";
    btnDownload.addEventListener("click", () => downloadBlob(result.blob, status));

    const btnCopy = document.createElement("button");
    btnCopy.className = "szi-btn";
    btnCopy.textContent = "Copy to Clipboard";
    btnCopy.addEventListener("click", () => copyBlob(result.blob, status));

    footer.appendChild(status);
    footer.appendChild(btnCopy);
    footer.appendChild(btnDownload);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    resultOverlay = overlay;

    document.addEventListener("keydown", escToClose, true);
  }

  let resultOverlay = null;

  function escToClose(e) {
    if (e.key === "Escape") closeResultModal();
  }

  function closeResultModal() {
    if (resultOverlay && resultOverlay.parentNode) resultOverlay.parentNode.removeChild(resultOverlay);
    resultOverlay = null;
    document.removeEventListener("keydown", escToClose, true);
  }

  function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      "-" +
      p(d.getHours()) +
      p(d.getMinutes()) +
      p(d.getSeconds())
    );
  }

  function downloadBlob(blob, status) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sheets-range-" + timestamp() + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    flash(status, "Downloaded.");
  }

  async function copyBlob(blob, status) {
    try {
      if (!navigator.clipboard || !window.ClipboardItem) {
        throw new Error("Clipboard images not supported by this browser.");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash(status, "Copied to clipboard.");
    } catch (err) {
      flash(status, "Copy failed: " + (err && err.message ? err.message : err), true);
      console.error("[Sheets Range to Image] copy failed", err);
    }
  }

  function flash(status, text, isError) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("szi-status-error", !!isError);
    clearTimeout(status._t);
    status._t = setTimeout(() => {
      status.textContent = "";
      status.classList.remove("szi-status-error");
    }, 3000);
  }
})();
