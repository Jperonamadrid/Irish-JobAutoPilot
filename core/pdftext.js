// Text and page count from PDF/DOCX files, in pure JavaScript (no system tools needed).
const fs = require('fs');

let pdfjs;
async function loadPdf(file) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  return pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
}

async function pdfPages(file) { const doc = await loadPdf(file); const n = doc.numPages; await (doc.destroy?.() ?? doc.cleanup?.()); return n; }

// Rebuilds lines from text items using their vertical position, so bullets stay on their own lines.
async function pdfText(file) {
  const doc = await loadPdf(file);
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const { items } = await page.getTextContent();
    let lastY = null, line = '';
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ''; }
      line += (line && !line.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
      lastY = y;
    }
    if (line) out.push(line);
  }
  await (doc.destroy?.() ?? doc.cleanup?.());
  return out.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

async function docxText(file) {
  const mammoth = require('mammoth');
  return (await mammoth.extractRawText({ path: file })).value;
}

async function fileText(file) {
  if (/\.pdf$/i.test(file)) return pdfText(file);
  if (/\.docx$/i.test(file)) return docxText(file);
  if (/\.(txt|md)$/i.test(file)) return fs.readFileSync(file, 'utf8');
  throw new Error('Unsupported CV format. Use PDF, DOCX or TXT.');
}

module.exports = { pdfText, pdfPages, docxText, fileText };
