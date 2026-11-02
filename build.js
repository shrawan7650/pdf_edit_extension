const fs = require("fs");
const path = require("path");

const root = __dirname;
const vendor = path.join(root, "vendor");
fs.mkdirSync(vendor, { recursive: true });

function copy(from, to) {
  if (!fs.existsSync(from)) throw new Error("Missing dependency file: " + from);
  fs.copyFileSync(from, path.join(vendor, to));
}

const pdfjs = path.join(root, "node_modules", "pdfjs-dist", "build");
const pdflib = path.join(root, "node_modules", "pdf-lib", "dist");

copy(path.join(pdfjs, "pdf.min.mjs"), "pdf.min.mjs");
copy(path.join(pdfjs, "pdf.worker.min.mjs"), "pdf.worker.min.mjs");
copy(path.join(pdflib, "pdf-lib.min.js"), "pdf-lib.min.js");

console.log("Vendor libraries copied. Load this folder with chrome://extensions.");
