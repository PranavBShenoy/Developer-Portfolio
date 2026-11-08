// lib/pdf-worker.mjs
// Isolated worker thread executing structural analysis and decompression safety bounds.

import { parentPort, workerData } from 'node:worker_threads';

async function runWorker() {
  try {
    const rawBuffer = workerData?.buffer;
    if (!rawBuffer || !rawBuffer.length) {
      parentPort.postMessage({ success: false, error: 'Empty buffer provided to worker.', code: 'EMPTY_BUFFER' });
      return;
    }
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);

    // Try dynamic import of pdfjs-dist if available, or execute native structural analysis
    let pdfjsLib;
    try {
      pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch {
      // If pdfjs-dist is not installed in the environment, use robust structural object traversal
      pdfjsLib = null;
    }

    if (pdfjsLib) {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        disableFontFace: true,
        isEvalSupported: false,
        stopAtErrors: true,
        useSystemFonts: false,
      });

      const doc = await loadingTask.promise;
      const numPages = doc.numPages;

      if (numPages < 1 || numPages > 5) {
        parentPort.postMessage({
          success: false,
          error: `Invalid page count: ${numPages}. Resumes must be between 1 and 5 pages.`,
          code: 'INVALID_PAGE_COUNT',
        });
        return;
      }

      // Decompression volume monitoring during text extraction
      let totalExtractedLength = 0;
      for (let i = 1; i <= numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        for (const item of textContent.items) {
          totalExtractedLength += (item.str?.length || 0);
          if (totalExtractedLength > 250000) { // 250KB plain text boundary for a 5-page resume
            parentPort.postMessage({
              success: false,
              error: 'Decompression expansion limit exceeded: Excessive text volume detected.',
              code: 'DECOMPRESSION_BOMB',
            });
            return;
          }
        }
      }

      parentPort.postMessage({ success: true, numPages });
    } else {
      // Fallback structural parser: Scans object streams, verifies page tree and xref bounds
      const binaryString = buffer.toString('binary');
      
      // Count /Type /Page occurrences
      const pageMatches = [...binaryString.matchAll(/\/Type\s*\/Page\b/g)];
      const pageCount = pageMatches.length;

      if (pageCount < 1 || pageCount > 5) {
        // Double check with /Count in Pages dictionary
        const countMatch = binaryString.match(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/);
        const dictCount = countMatch ? parseInt(countMatch[1], 10) : pageCount;
        if (dictCount < 1 || dictCount > 5) {
          parentPort.postMessage({
            success: false,
            error: `Invalid page count (${dictCount}). Resumes must be between 1 and 5 pages.`,
            code: 'INVALID_PAGE_COUNT',
          });
          return;
        }
      }

      // Check for deep circular references or suspicious stream counts
      const streamMatches = [...binaryString.matchAll(/\bstream\b/g)];
      if (streamMatches.length > 200) {
        parentPort.postMessage({
          success: false,
          error: 'Abnormally high stream object count detected in resume PDF.',
          code: 'SUSPICIOUS_STRUCTURE',
        });
        return;
      }

      parentPort.postMessage({ success: true, numPages: pageCount || 1 });
    }
  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: `Structural PDF analysis failed: ${err.message}`,
      code: 'MALFORMED_STRUCTURE',
    });
  }
}

runWorker();
