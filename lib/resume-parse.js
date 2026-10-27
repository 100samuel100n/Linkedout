// Extracts plain text from an uploaded resume so it can be sent to the AI
// roast prompt (see lib/ai.js's roastResume).
//
// PDFs: we pin pdf-parse@1.1.1 and import its inner module directly. Newer
// pdf-parse (2.x) is built on a pdf.js that needs browser-only globals
// (DOMMatrix, Path2D, ImageData) and crashes on a plain Node server with
// "DOMMatrix is not defined". The 1.x line bundles an older pdf.js that is
// pure Node. The package root `pdf-parse` is NOT imported on purpose: its
// index.js runs a debug routine that reads a test PDF from disk and fails in
// bundled builds. If a 2.x install ever sneaks back in, the fallback below
// installs tiny stand-ins for those globals so text extraction still works.
//
// DOC/DOCX are not parsed (would need another library); the user is told to
// paste the text instead.

const MAX_BYTES = 8 * 1024 * 1024;

function userError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function installBrowserStubs() {
  const g = globalThis;
  if (!g.DOMMatrix) {
    g.DOMMatrix = class DOMMatrix {
      constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
      multiplySelf() { return this; } preMultiplySelf() { return this; }
      translate() { return this; } scale() { return this; } rotate() { return this; }
      invertSelf() { return this; } inverse() { return this; } transformPoint(p) { return p; }
    };
  }
  if (!g.Path2D) g.Path2D = class Path2D {};
  if (!g.ImageData) g.ImageData = class ImageData {};
}

async function pdfToText(buffer) {
  // Preferred: pdf-parse 1.x inner module (pure Node).
  try {
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    const parse = mod.default || mod;
    if (typeof parse === "function") {
      const data = await parse(buffer);
      return data.text || "";
    }
  } catch (e) {
    if (!/Cannot find module|ERR_MODULE_NOT_FOUND|Package subpath/i.test(String(e?.message || e))) throw e;
  }
  // Fallback: pdf-parse 2.x class API.
  installBrowserStubs();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const out = await parser.getText();
    return out?.text || "";
  } finally {
    await parser.destroy?.().catch(() => {});
  }
}

export async function extractResumeText(file) {
  if (file.size > MAX_BYTES) throw userError("That file is too large. Upload a PDF or .txt under 8 MB, or paste your resume text instead.", "TOO_LARGE");
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  const isPdf = type === "application/pdf" || name.endsWith(".pdf") || buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  const isTxt = type.startsWith("text/") || name.endsWith(".txt");

  if (isPdf) {
    let text = "";
    try {
      text = await pdfToText(buffer);
    } catch (e) {
      console.error("[resume-parse] PDF read failed:", e);
      throw userError("We couldn't read that PDF. Try exporting it again, or paste your resume text instead.", "PDF_UNREADABLE");
    }
    text = text.replace(/\u0000/g, "").trim();
    if (text.length < 20) throw userError("That PDF has no readable text (it may be a scan or image). Paste your resume text instead.", "PDF_NO_TEXT");
    return text;
  }
  if (isTxt) return buffer.toString("utf-8");

  throw userError("Couldn't read that file type. Upload a PDF or .txt, or paste your resume text instead.", "UNSUPPORTED_TYPE");
}
