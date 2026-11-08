// lib/pdf-validator.js
// Multi-stage PDF validation pipeline with pre-parse byte bounds, AST checks, and execution timeout.

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PdfValidationError extends Error {
  constructor(message, code = 'INVALID_PDF') {
    super(message);
    this.code = code;
  }
}

/**
 * Validates an uploaded PDF buffer through pre-parse checks and an isolated worker.
 * 
 * @param {Buffer} buffer Uploaded file buffer
 * @returns {Promise<{ numPages: number, fileSize: number }>}
 */
export async function validatePdfResume(buffer) {
  // 1. Hard File Size Boundary: Maximum 5 MB
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new PdfValidationError('Invalid input: Expected a binary buffer.', 'INVALID_BUFFER');
  }

  if (buffer.length > 5 * 1024 * 1024) {
    throw new PdfValidationError('File size exceeds the 5MB maximum limit for resumes.', 'FILE_TOO_LARGE');
  }

  if (buffer.length < 50) {
    throw new PdfValidationError('File is too small to be a valid PDF document.', 'FILE_CORRUPTED');
  }

  // 2. Pre-Parse Header & Trailer Verification
  const headChunk = buffer.subarray(0, 1024).toString('binary');
  if (!headChunk.includes('%PDF-1.') && !headChunk.includes('%PDF-2.')) {
    throw new PdfValidationError('Invalid PDF format: Missing %PDF-1.x / %PDF-2.x signature in document header.', 'INVALID_HEADER');
  }

  const tailChunk = buffer.subarray(Math.max(0, buffer.length - 1024)).toString('binary');
  if (!tailChunk.includes('%%EOF')) {
    throw new PdfValidationError('Malformed PDF: Missing standard %%EOF terminator marker.', 'MISSING_EOF');
  }

  // 3. Fast ASCII scan of raw byte stream for uncompressed disallowed directives
  const rawContent = buffer.toString('binary');
  if (
    rawContent.includes('/JavaScript') ||
    rawContent.includes('/Launch') ||
    rawContent.includes('/EmbeddedFiles') ||
    rawContent.includes('/XFA') ||
    rawContent.includes('/RichMedia')
  ) {
    throw new PdfValidationError('Suspicious document content detected: Executable scripts or embedded binary files are prohibited.', 'UNSAFE_PDF_CONTENT');
  }

  // 4. Isolated Worker Execution (Enforcing 2500ms Execution Ceiling)
  const workerPath = path.join(__dirname, 'pdf-worker.mjs');

  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(workerPath, {
        workerData: { buffer },
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
    } catch (err) {
      return reject(new PdfValidationError(`Failed to spawn PDF validation worker: ${err.message}`, 'WORKER_SPAWN_ERROR'));
    }

    const timeout = setTimeout(async () => {
      try {
        await worker.terminate();
      } catch (termErr) {
        // Ignored
      }
      reject(new PdfValidationError('PDF processing timed out (2500ms ceiling exceeded). Document may be malformed or excessively complex.', 'PARSER_TIMEOUT'));
    }, 2500);

    worker.on('message', (msg) => {
      clearTimeout(timeout);
      worker.terminate().catch(() => {});
      if (msg.success) {
        resolve({
          numPages: msg.numPages,
          fileSize: buffer.length,
        });
      } else {
        reject(new PdfValidationError(msg.error || 'PDF failed validation.', msg.code || 'VALIDATION_FAILED'));
      }
    });

    worker.on('error', (err) => {
      clearTimeout(timeout);
      worker.terminate().catch(() => {});
      reject(new PdfValidationError(`PDF parser worker error: ${err.message}`, 'WORKER_ERROR'));
    });

    worker.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new PdfValidationError(`PDF worker exited unexpectedly with code ${code}.`, 'WORKER_EXIT_ERROR'));
      }
    });
  });
}
