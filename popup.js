const statusEl   = document.getElementById("status");
const statusDot  = document.getElementById("status-dot");
const errorEl    = document.getElementById("error");
const openBtn    = document.getElementById("open");
const fileInput  = document.getElementById("file-input");

// ─── Helper: get active tab ───────────────────────────────────────────────
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isPdfTab(url = "") {
  return url.startsWith("file://") && url.toLowerCase().split("?")[0].endsWith(".pdf");
}

// ─── On load: check current tab ──────────────────────────────────────────
(async () => {
  try {
    const tab = await activeTab();
    if (isPdfTab(tab?.url)) {
      statusEl.textContent  = "Local PDF detected — ready to edit.";
      statusDot.className   = "ready";
      openBtn.disabled      = false;
    } else {
      statusEl.textContent = "No PDF tab active. Upload one below.";
      statusDot.className  = "warn";
    }
  } catch {
    statusEl.textContent = "Open a local PDF or upload from device.";
    statusDot.className  = "warn";
  }
})();

// ─── Edit current PDF tab ─────────────────────────────────────────────────
openBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  try {
    const tab = await activeTab();
    if (!isPdfTab(tab?.url)) throw new Error("Open a local PDF file in Chrome first.");
    const url = chrome.runtime.getURL("editor.html") + "?source=" + encodeURIComponent(tab.url);
    await chrome.tabs.create({ url });
    window.close();
  } catch (e) {
    errorEl.textContent = e.message || "Could not open PDF. Enable 'Allow access to file URLs' in extension settings.";
  }
});

// ─── Upload PDF from device ───────────────────────────────────────────────
document.getElementById("upload-label").addEventListener("click", (e) => {
  // Let the hidden <input> handle it; prevent double-trigger from label
  if (e.target === fileInput) return;
});

fileInput.addEventListener("change", async () => {
  errorEl.textContent = "";
  const file = fileInput.files?.[0];
  if (!file) return;

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    errorEl.textContent = "Please select a valid PDF file.";
    return;
  }

  try {
    // Read the file as a data URL and pass it via session storage to the editor
    const reader = new FileReader();
    reader.onload = async (ev) => {
      await chrome.storage.session.set({
        pendingPdf: { dataUrl: ev.target.result, name: file.name }
      });
      const url = chrome.runtime.getURL("editor.html");
      await chrome.tabs.create({ url });
      window.close();
    };
    reader.onerror = () => { errorEl.textContent = "Could not read the file."; };
    reader.readAsDataURL(file);
  } catch (e) {
    errorEl.textContent = e.message || "Could not open the PDF.";
  }
});
