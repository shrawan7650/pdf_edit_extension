# PDF Text Edit - Local Chrome Extension

A minimal Manifest V3 extension that opens a local PDF in an extension-owned editing view. It does not upload files.

## Install dependencies (one-time, requires internet)

```bash
npm install
npm run build
```

The build copies PDF.js and pdf-lib into `vendor/`. After this setup, the extension works offline.

## Load in Chrome

1. Extract this folder.
2. Run the two commands above in this folder.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select this folder.
6. Open extension **Details** and enable **Allow access to file URLs**.
7. Open a local PDF in Chrome (`file:///...pdf`).
8. Click the extension icon, then **Edit current PDF**.
9. Click a text line. Use **Delete text** or edit the selected text in the prompt.
10. The modified PDF downloads as a new `*-edited.pdf` file.

## Important limitations

- Chrome's built-in PDF viewer is not modified. The extension opens the same local file in its own extension tab so it can render and edit it.
- This first version selects text runs/lines exposed by PDF.js. It is not a full character-level text editor.
- Export currently covers selected text with a white rectangle and redraws replacement text using Helvetica. It preserves approximate position, size, and color, but **does not guarantee the original embedded font, exact kerning, or background appearance**.
- Deletion is a visual cover, not secure redaction. The original text may remain recoverable from the PDF's underlying content.
- Scanned/image-only PDFs have no selectable text and need OCR, which is not included.
- Complex PDFs with rotated and , vertical, transparent, or overlapping text may not edit accurately.
- A download is generated after each applied edit/delete. Use Save & download to export accumulated changes.

## Privacy

All PDF rendering and modification happens in the browser. No backend or upload endpoint is included.
