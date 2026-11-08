// lib/image-validator.js
// Binary magic-byte detection, header structural decoding, and dimension validation for uploaded images.
// NOTE ON DECODING SCOPE:
// This module performs binary magic-byte inspection and parses structural header chunks
// (JPEG SOF0-SOF3, PNG IHDR, WebP VP8/VP8L/VP8X) to extract declared image dimensions and enforce bounds.
// It does NOT perform full raster pixel decompression/rendering into uncompressed RGB buffers,
// avoiding heavy C++ / WebAssembly graphics runtime dependencies and cold-start latency.

export const IMAGE_BOUNDS = {
  MIN_WIDTH: 16,
  MAX_WIDTH: 4096,
  MIN_HEIGHT: 16,
  MAX_HEIGHT: 4096,
  MAX_PIXELS: 4096 * 4096, // 16.7 megapixels max to prevent decompression bombs
};

/**
 * Validates the raw buffer against standard binary image signatures:
 * - JPEG: FF D8 FF
 * - PNG:  89 50 4E 47 0D 0A 1A 0A
 * - WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
 *
 * Returns detected MIME type if valid, or null if buffer does not match.
 */
export function validateImageMagicBytes(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  // 1. JPEG signature: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }

  // 2. PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return 'image/png';
  }

  // 3. WebP signature: RIFF .... WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && // 'RIFF'
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50    // 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Parses dimensions from JPEG SOF markers (SOF0 - SOF3).
 */
export function parseJpegDimensions(buffer) {
  if (!buffer || buffer.length < 4) return null;
  let offset = 2;
  while (offset < buffer.length - 8) {
    if (buffer[offset] !== 0xFF) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];
    // Start of Frame markers SOF0 (0xC0) through SOF3 (0xC3)
    if (marker >= 0xC0 && marker <= 0xC3) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }
    // Skip other variable-length markers (APPn, DQT, DHT, etc.)
    if (offset + 4 <= buffer.length) {
      const len = buffer.readUInt16BE(offset + 2);
      offset += 2 + len;
    } else {
      break;
    }
  }
  return null;
}

/**
 * Parses dimensions from PNG IHDR chunk.
 */
export function parsePngDimensions(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

/**
 * Parses dimensions from WebP (VP8, VP8L, VP8X chunks).
 */
export function parseWebpDimensions(buffer) {
  if (!buffer || buffer.length < 30) return null;
  const chunkType = buffer.subarray(12, 16).toString('ascii');

  // Extended WebP format
  if (chunkType === 'VP8X') {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }

  // Simple lossy WebP format
  if (chunkType === 'VP8 ') {
    if (buffer.length < 30) return null;
    const width = buffer.readUInt16LE(26) & 0x3FFF;
    const height = buffer.readUInt16LE(28) & 0x3FFF;
    return { width, height };
  }

  // Lossless WebP format
  if (chunkType === 'VP8L') {
    if (buffer.length < 26 || buffer[21] !== 0x2F) return null;
    const b22 = buffer[22], b23 = buffer[23], b24 = buffer[24], b25 = buffer[25];
    const width = 1 + (b22 | ((b23 & 0x3F) << 8));
    const height = 1 + (((b23 >> 6) | (b24 << 2) | ((b25 & 0x0F) << 10)));
    return { width, height };
  }

  return null;
}

/**
 * Decodes image dimensions based on MIME type.
 */
export function parseImageDimensions(buffer, mimeType) {
  if (mimeType === 'image/jpeg') return parseJpegDimensions(buffer);
  if (mimeType === 'image/png') return parsePngDimensions(buffer);
  if (mimeType === 'image/webp') return parseWebpDimensions(buffer);
  return null;
}

/**
 * Comprehensive image verification:
 * 1. Binary magic-byte validation
 * 2. Header parsing & dimension extraction
 * 3. Bounded dimension & pixel limits to prevent decompression bombs
 */
export function validateImage(buffer) {
  const mimeType = validateImageMagicBytes(buffer);
  if (!mimeType) {
    return {
      valid: false,
      code: 'INVALID_IMAGE_MAGIC_BYTES',
      error: 'File magic bytes do not match a valid JPEG, PNG, or WebP image.',
    };
  }

  const dimensions = parseImageDimensions(buffer, mimeType);
  if (!dimensions || !dimensions.width || !dimensions.height) {
    return {
      valid: false,
      code: 'IMAGE_DECODE_FAILED',
      error: 'Failed to decode valid image dimensions from file header.',
    };
  }

  const { width, height } = dimensions;

  if (
    width < IMAGE_BOUNDS.MIN_WIDTH ||
    width > IMAGE_BOUNDS.MAX_WIDTH ||
    height < IMAGE_BOUNDS.MIN_HEIGHT ||
    height > IMAGE_BOUNDS.MAX_HEIGHT
  ) {
    return {
      valid: false,
      code: 'INVALID_IMAGE_DIMENSIONS',
      error: `Image dimensions (${width}x${height}) exceed allowed limits (${IMAGE_BOUNDS.MIN_WIDTH}x${IMAGE_BOUNDS.MIN_HEIGHT} to ${IMAGE_BOUNDS.MAX_WIDTH}x${IMAGE_BOUNDS.MAX_HEIGHT} px).`,
      dimensions,
    };
  }

  if (width * height > IMAGE_BOUNDS.MAX_PIXELS) {
    return {
      valid: false,
      code: 'IMAGE_TOO_LARGE_PIXELS',
      error: `Image pixel count (${width * height}) exceeds maximum allowed limit (${IMAGE_BOUNDS.MAX_PIXELS}).`,
      dimensions,
    };
  }

  return {
    valid: true,
    mimeType,
    dimensions,
  };
}
