import * as pdfjsLib from "./vendor/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

const { PDFDocument, rgb, StandardFonts } = PDFLib;
const pagesEl   = document.getElementById("pages");
const filenameEl = document.getElementById("filename");
const notice    = document.getElementById("notice");
const deleteBtn = document.getElementById("delete");
const saveBtn   = document.getElementById("save");
const undoBtn   = document.getElementById("undo");
const redoBtn   = document.getElementById("redo");

let sourceBytes;
let sourceName = "edited.pdf";
let pdfDoc;
let busy = false;

// ---------- Delete-mode toggle ----------
let deleteMode = false;
deleteBtn.addEventListener("click", () => {
  deleteMode = !deleteMode;
  deleteBtn.classList.toggle("active", deleteMode);
  deleteBtn.textContent = deleteMode ? "Delete mode: ON" : "Delete mode";
  setNotice(deleteMode
    ? "Delete mode ON — click any text to remove it instantly."
    : "Click a text line to select and edit it inline. Toggle Delete mode to remove text.");
});

// ---------- History (undo / redo) ----------
const undoStack = [];
const redoStack = [];

function pushHistory(entry) {
  undoStack.push(entry);
  redoStack.length = 0;
  refreshHistoryButtons();
}

function refreshHistoryButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

undoBtn.addEventListener("click", () => {
  if (!undoStack.length) return;
  const entry = undoStack.pop();
  for (const m of entry.spans) {
    if (m.type === "delete") {
      // Restore: remove red deleted state
      m.el.classList.remove("deleted");
    } else if (m.type === "edit") {
      m.el.textContent  = m.oldText;
      m.el.dataset.text = m.oldText;
      // If restored to original text → remove green edited badge
      if (m.oldText === m.el.dataset.origText) {
        m.el.classList.remove("edited");
      } else {
        m.el.classList.add("edited");
      }
    }
  }
  redoStack.push(entry);
  refreshHistoryButtons();
  setNotice("Undo applied.");
});

redoBtn.addEventListener("click", () => {
  if (!redoStack.length) return;
  const entry = redoStack.pop();
  for (const m of entry.spans) {
    if (m.type === "delete") {
      // Re-apply red deleted state
      m.el.classList.add("deleted");
    } else if (m.type === "edit") {
      m.el.textContent  = m.newText;
      m.el.dataset.text = m.newText;
      m.el.classList.add("edited");
    }
  }
  undoStack.push(entry);
  refreshHistoryButtons();
  setNotice("Redo applied.");
});

// ---------- Notice bar ----------
function setNotice(msg) { notice.textContent = msg; }

// ---------- Load & render ----------
async function loadSource() {
  const params    = new URLSearchParams(location.search);
  const sourceUrl = params.get("source");
  if (sourceUrl) {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error("Could not read the local PDF. Enable 'Allow access to file URLs' in extension details.");
    sourceBytes = new Uint8Array(await response.arrayBuffer());
    sourceName  = decodeURIComponent(sourceUrl.split("/").pop().split("?")[0] || "document.pdf");
  } else {
    const pending = await chrome.storage.session.get("pendingPdf");
    if (pending.pendingPdf?.dataUrl) {
      const blob  = await (await fetch(pending.pendingPdf.dataUrl)).blob();
      sourceBytes = new Uint8Array(await blob.arrayBuffer());
      sourceName  = pending.pendingPdf.name || "document.pdf";
      await chrome.storage.session.remove("pendingPdf");
    } else {
      throw new Error("No PDF was supplied. Open a local PDF in Chrome and click the extension.");
    }
  }
  filenameEl.textContent = sourceName;
  pdfDoc = await pdfjsLib.getDocument({ data: sourceBytes.slice() }).promise;
  await renderAllPages();
  saveBtn.disabled = false;
  setNotice("Click a text line to edit it inline. Toggle Delete mode to remove text.");
}

async function renderAllPages() {
  pagesEl.innerHTML = "";
  for (let pageNo = 1; pageNo <= pdfDoc.numPages; pageNo++) {
    const page     = await pdfDoc.getPage(pageNo);
    const scale    = Math.min(1.55, Math.max(0.85, (window.innerWidth - 80) / page.getViewport({scale:1}).width));
    const viewport = page.getViewport({ scale });

    const wrapper  = document.createElement("section");
    wrapper.className    = "page";
    wrapper.dataset.page = String(pageNo);
    wrapper.style.width  = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;

    const canvas  = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
});
    const outputScale = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(viewport.width  * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width  = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    wrapper.appendChild(canvas);

    const layer = document.createElement("div");
    layer.className = "text-layer";
    wrapper.appendChild(layer);
    pagesEl.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport,
      transform: outputScale !== 1 ? [outputScale,0,0,outputScale,0,0] : null
    }).promise;

    // ── Canvas pixel sampler ──────────────────────────────────────────────
    // After the page is fully painted, sample the RENDERED canvas pixels to
    // get the true displayed colour of each text run.  This is far more
    // reliable than item.color (which is often wrong / black for many PDFs).
  
function sampleCanvasColor(cssX, cssY, cssW, cssH) {
  try {
    const ctx2d = canvas.getContext("2d", {
      willReadFrequently: true
    });

    // Vertical centre of the glyph
    const py = Math.round((cssY + cssH * 0.45) * outputScale);
    if (py < 0 || py >= canvas.height) return null;

    const x0 = Math.max(0, Math.round(cssX * outputScale) + 1);
    const x1 = Math.min(
      canvas.width - 1,
      Math.round((cssX + cssW * 0.7) * outputScale)
    );

    if (x1 < x0) return null;

    // Read the entire horizontal row only once
    const imageData = ctx2d.getImageData(
      x0,
      py,
      x1 - x0 + 1,
      1
    );

    const pixels = imageData.data;
    const step = Math.max(1, Math.round((x1 - x0) / 30));

    for (let px = x0; px <= x1; px += step) {
      const index = (px - x0) * 4;

      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const a = pixels[index + 3];

      // Skip transparent and near-white pixels
      if (a < 50) continue;
      if (r > 238 && g > 238 && b > 238) continue;

      return `${r},${g},${b}`;
    }

    return null;
  } catch (error) {
    console.warn("Canvas color sampling failed:", error);
    return null;
  }
}


    const text = await page.getTextContent();
    for (const item of text.items) {
      if (!item.str?.trim()) continue;
      const tx         = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const span       = document.createElement("span");
      span.className        = "text-item";
      span.textContent      = item.str;
      span.dataset.page     = String(pageNo);
      span.dataset.text     = item.str;
      span.dataset.origText = item.str;
      span.dataset.fontSize = String(fontHeight / scale);
      span.dataset.scale    = String(scale);
      span.dataset.origWidth = String(Math.max(2, item.width * scale));

      // ── Capture original text colour ──────────────────────────────────
      // Priority 1: sample from the already-rendered canvas (catches ALL
      //             colour spaces — RGB, CMYK, spot, etc.)
      // Priority 2: item.color from pdf.js (works on simple PDFs)
      // Priority 3: fallback black
      const cssItemX = tx[4];
      const cssItemY = tx[5] - fontHeight;
      const cssItemW = Math.max(2, item.width * scale);
      const sampled  = sampleCanvasColor(cssItemX, cssItemY, cssItemW, fontHeight);
      if (sampled) {
        span.dataset.pdfColor = sampled;
      } else if (item.color && item.color.length >= 3) {
        span.dataset.pdfColor = `${item.color[0]},${item.color[1]},${item.color[2]}`;
      } else {
        span.dataset.pdfColor = "0,0,0";
      }
      span.style.left       = `${tx[4]}px`;
      span.style.top        = `${tx[5] - fontHeight}px`;
      span.style.fontSize   = `${fontHeight}px`;
      span.style.fontFamily = "sans-serif";
      span.style.height     = `${fontHeight * 1.2}px`;
      span.style.minWidth   = `${Math.max(2, item.width * scale)}px`;
      span.style.transform  = `scaleX(${item.width ? (item.width * scale) / Math.max(1, span.getBoundingClientRect().width || item.width * scale) : 1})`;

      span._viewport = viewport;

      span.addEventListener("click", (e) => {
        e.stopPropagation();
        if (deleteMode) {
          deleteSpan(span);
        } else {
          activateInlineEdit(span);
        }
      });
      layer.appendChild(span);
    }
  }
}

// ---------- Delete mode ----------
function deleteSpan(span) {
  // Already marked for deletion — clicking again toggles it back (deselect)
  if (span.classList.contains("deleted")) {
    span.classList.remove("deleted");
    // Remove from undo stack the last delete entry for this span
    const idx = [...undoStack].reverse().findIndex(e => e.spans.some(m => m.type === "delete" && m.el === span));
    if (idx !== -1) undoStack.splice(undoStack.length - 1 - idx, 1);
    refreshHistoryButtons();
    setNotice("Deletion cancelled. Click Save & download when ready.");
    return;
  }
  // Also skip if span is currently being edited
  if (span.classList.contains("editing")) return;

  span.classList.add("deleted");
  pushHistory({ spans: [{ type: "delete", el: span }] });
  setNotice("Text marked for deletion (shown in red). Undo to restore. Save & download to export.");
}

// ---------- Inline editing ----------
let activeSpan = null;

function activateInlineEdit(span) {
  // Cannot edit a span marked for deletion
  if (span.classList.contains("deleted")) return;
  if (activeSpan && activeSpan !== span) commitEdit(activeSpan);

  activeSpan = span;
  span.classList.add("editing");
  span.contentEditable = "true";
  span.style.transform = "scaleX(1)";
  span.focus();

  const sel   = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(span);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  setNotice("Editing — type to replace text. Press Enter or click elsewhere to confirm.");
}

function commitEdit(span) {
  if (!span) return;
  const oldText = span.dataset.text;
  const newText = span.textContent;

  span.classList.remove("editing");
  span.contentEditable = "false";

  if (newText.trim() === "") {
    // User cleared the field — revert to last saved text, don't record
    span.textContent  = oldText;
    span.dataset.text = oldText;
  } else if (newText !== oldText) {
    span.dataset.text = newText;
    // ✅ Add green "edited" badge so user can see the change in the preview
    span.classList.add("edited");
    pushHistory({ spans: [{ type: "edit", el: span, oldText, newText }] });
    setNotice("✓ Edit saved — green highlight shows changed text. Click Save & download to export.");
  } else {
    setNotice("Click a text line to edit it inline. Toggle Delete mode to remove text.");
  }

  // Re-apply horizontal scale so text fits original column width
  const origW = Number(span.dataset.origWidth) || 0;
  if (origW) {
    const currentW = span.getBoundingClientRect().width || origW;
    span.style.transform = `scaleX(${origW / Math.max(1, currentW)})`;
  } else {
    span.style.transform = "scaleX(1)";
  }

  if (span === activeSpan) activeSpan = null;
}

// Commit when clicking outside any span
document.addEventListener("click", (e) => {
  if (activeSpan && !e.target.closest(".text-item")) {
    commitEdit(activeSpan);
  }
});

// Keyboard shortcuts inside an editable span
document.addEventListener("keydown", (e) => {
  if (!activeSpan) return;
  if (e.key === "Enter") {
    e.preventDefault();
    commitEdit(activeSpan);
  }
  if (e.key === "Escape") {
    // Revert to last-committed text
    activeSpan.textContent = activeSpan.dataset.text;
    commitEdit(activeSpan);
  }
}, true);

// ---------- Export / Save ----------
function parseColor(value) {
  const m = value.match(/\d+/g);
  if (!m || m.length < 3) return rgb(0, 0, 0);
  return rgb(Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255);
}

async function exportPdf() {
  if (busy) return;
  if (activeSpan) commitEdit(activeSpan);

  busy = true;
  saveBtn.disabled = true;
  setNotice("Applying changes and preparing your download…");

  let downloadUrl = null;
  try {
    const out  = await PDFDocument.load(sourceBytes);
    const font = await out.embedFont(StandardFonts.Helvetica);

    const allSpans = document.querySelectorAll(".text-item");
    for (const span of allSpans) {
      const origText  = span.dataset.origText;
      const curText   = span.dataset.text;
      const isDeleted = span.classList.contains("deleted");
      const isEdited  = !isDeleted && curText !== origText;

      if (!isDeleted && !isEdited) continue;

      const pageNo   = Number(span.dataset.page);
      const pageEl   = out.getPage(pageNo - 1);
      const viewport = span._viewport;

      const wrapper   = span.closest(".page");
      const spanRect  = span.getBoundingClientRect();
      const pageRect  = wrapper.getBoundingClientRect();
      const topLeft     = viewport.convertToPdfPoint(spanRect.left - pageRect.left, spanRect.top    - pageRect.top);
      const bottomRight = viewport.convertToPdfPoint(spanRect.right - pageRect.left, spanRect.bottom - pageRect.top);
      const pdfRect = {
        x:      Math.min(topLeft[0], bottomRight[0]),
        y:      Math.min(topLeft[1], bottomRight[1]),
        width:  Math.abs(bottomRight[0] - topLeft[0]),
        height: Math.abs(bottomRight[1] - topLeft[1])
      };

      const pad = Math.max(0.5, pdfRect.height * 0.04);
      pageEl.drawRectangle({
        x:      Math.max(0, pdfRect.x - pad),
        y:      Math.max(0, pdfRect.y - pad),
        width:  pdfRect.width  + pad * 2,
        height: pdfRect.height + pad * 2,
        color:  rgb(1, 1, 1),
        borderWidth: 0
      });

      if (isEdited && curText) {
        const fontSize = Number(span.dataset.fontSize) || 12;
        const size     = Math.max(4, Math.min(fontSize, pdfRect.height * 0.92));
        let drawSize   = size;
        while (drawSize > 4 && font.widthOfTextAtSize(curText, drawSize) > pdfRect.width + 1) drawSize -= 0.5;

        // Restore original PDF colour (stored during render, so green/red UI badges don't bleed in)
        const [cr, cg, cb] = (span.dataset.pdfColor || "0,0,0").split(",").map(Number);
        pageEl.drawText(curText, {
          x:    pdfRect.x,
          y:    pdfRect.y + Math.max(0, (pdfRect.height - drawSize) * 0.18),
          size: drawSize,
          font,
          color: rgb(cr / 255, cg / 255, cb / 255)
        });
      }
    }

    const bytes = await out.save();
    const blob  = new Blob([bytes], { type: "application/pdf" });
    downloadUrl = URL.createObjectURL(blob);
    const cleanName = sourceName.replace(/\.pdf$/i, "");
    await chrome.downloads.download({
      url:      downloadUrl,
      filename: `${cleanName}-edited.pdf`,
      saveAs:   true
    });
    setNotice("Download started. Your original PDF was not changed.");
  } catch (e) {
    console.error(e);
    setNotice("Could not export this PDF: " + (e.message || "unknown error"));
  } finally {
    busy = false;
    saveBtn.disabled = false;
    if (downloadUrl) setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);
  }
}

saveBtn.addEventListener("click", exportPdf);

// ---------- Bootstrap ----------
loadSource().catch(error => {
  setNotice(error.message || "Could not load PDF.");
  filenameEl.textContent = "PDF not loaded";
});

refreshHistoryButtons();
