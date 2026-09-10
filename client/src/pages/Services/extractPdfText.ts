/**
 * Extract plain text from a local PDF for Planning Center plan import.
 * Reconstructs lines from text-item positions so duration rows stay intact.
 *
 * pdfjs is loaded only when a PDF is imported. Keep it out of the module graph
 * for Jest — pdfjs-dist's ESM build uses `import.meta`, which Node/Jest reject.
 */
import { reconstructPdfPageText } from "./pdfTextLayout";

type PdfjsModule = typeof import("pdfjs-dist");
type TextItem = import("pdfjs-dist").TextItem;

let workerConfigured = false;

const ensurePdfWorker = async (pdfjs: PdfjsModule): Promise<void> => {
  if (workerConfigured) return;
  // Vite resolves `?url` to a worker asset URL; keep this lazy so tests can mock
  // the whole module without loading pdfjs.
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  workerConfigured = true;
};

export const extractTextFromPdfFile = async (file: File): Promise<string> => {
  const name = file.name?.toLowerCase() || "";
  const looksLikePdf =
    file.type === "application/pdf" ||
    file.type === "application/x-pdf" ||
    name.endsWith(".pdf");
  if (!looksLikePdf) {
    throw new Error("Choose a PDF file from Planning Center.");
  }

  const pdfjs = await import("pdfjs-dist");
  await ensurePdfWorker(pdfjs);
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(reconstructPdfPageText(content.items as TextItem[]));
  }

  const text = pages.filter(Boolean).join("\n").trim();
  if (!text) {
    throw new Error(
      "No readable text found in that PDF. Try exporting the order of service again from Planning Center.",
    );
  }
  return text;
};
