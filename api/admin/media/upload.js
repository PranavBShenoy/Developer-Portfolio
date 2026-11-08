// api/admin/media/upload.js
// Handles validated file uploads to private storage with format verification and PDF safety bounds.

import { verifyAdminSession, recordAuditLog } from '../../../lib/auth.js';
import { queryServiceRole, getSupabaseConfig } from '../../../lib/supabase.js';
import { checkRateLimit } from '../../../lib/rate-limit.js';
import { validatePdfResume } from '../../../lib/pdf-validator.js';
import { validateImage } from '../../../lib/image-validator.js';
import crypto from 'node:crypto';

export const config = {
  api: {
    bodyParser: false, // Handle binary upload stream directly
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  let session;
  try {
    session = await verifyAdminSession(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message });
  }

  const { adminRecord, user } = session;

  try {
    await checkRateLimit(`rl:upload:admin:${adminRecord.id}`, 10, 3600, true);
  } catch (rateErr) {
    return res.status(rateErr.statusCode || 429).json({ error: rateErr.message });
  }

  // Read incoming request stream into raw buffer
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > 6 * 1024 * 1024) {
      return res.status(413).json({ error: 'Payload too large: Max file size is 5MB.' });
    }
    chunks.push(chunk);
  }
  const rawBuffer = Buffer.concat(chunks);

  if (rawBuffer.length < 10) {
    return res.status(400).json({ error: 'Invalid or empty upload buffer.' });
  }

  let buffer = rawBuffer;
  let contentType = (req.headers['content-type'] || '').toLowerCase();
  let filenameHeader = req.headers['x-filename'] || 'upload.bin';
  let purpose = req.headers['x-purpose'] || '';

  // Support base64 JSON payload from Admin UI fetch
  if (contentType.includes('application/json')) {
    try {
      const jsonBody = JSON.parse(rawBuffer.toString('utf8'));
      if (jsonBody.data_base64) {
        buffer = Buffer.from(jsonBody.data_base64, 'base64');
      }
      if (jsonBody.filename) {
        filenameHeader = jsonBody.filename;
      }
      if (jsonBody.content_type) {
        contentType = jsonBody.content_type.toLowerCase();
      }
      if (jsonBody.purpose) {
        purpose = jsonBody.purpose;
      }
    } catch {
      return res.status(400).json({ error: 'Malformed JSON upload body.' });
    }
  }

  const extension = filenameHeader.split('.').pop().toLowerCase();

  // Explicitly reject SVG
  if (extension === 'svg' || contentType.includes('svg')) {
    return res.status(400).json({
      error: 'SVG format is disallowed due to script execution risks. Upload WebP, JPEG, PNG, or PDF only.',
      code: 'SVG_DISALLOWED',
    });
  }

  const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const isPdf = extension === 'pdf' || contentType.includes('pdf');
  const isImage = allowedImageTypes.some(t => contentType.includes(t)) || ['jpg', 'jpeg', 'png', 'webp'].includes(extension);

  if (!isPdf && !isImage) {
    return res.status(400).json({ error: 'Unsupported file type. Allowed: WebP, JPEG, PNG, PDF.' });
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const entityId = crypto.randomUUID();
  let mimeType = contentType;
  let targetPath = '';

  const isResume = isPdf && (purpose === 'resume' || purpose === 'primary_resume');

  if (isPdf) {
    // Validate PDF resume or document through isolated worker
    try {
      await validatePdfResume(buffer);
    } catch (pdfErr) {
      return res.status(400).json({ error: pdfErr.message, code: pdfErr.code });
    }
    mimeType = 'application/pdf';
    targetPath = isResume
      ? `resumes/${entityId}-${sha256.slice(0, 12)}.pdf`
      : `media/${entityId}-${sha256.slice(0, 12)}.pdf`;
  } else {
    // Validate image binary magic bytes, decode headers, and enforce dimension bounds
    const imageValidation = validateImage(buffer);
    if (!imageValidation.valid) {
      return res.status(400).json({
        error: imageValidation.error,
        code: imageValidation.code,
      });
    }
    mimeType = imageValidation.mimeType;
    const targetExt = mimeType === 'image/jpeg' ? 'jpeg' : mimeType === 'image/png' ? 'png' : 'webp';
    targetPath = `media/${entityId}-${sha256.slice(0, 12)}.${targetExt}`;
  }

  // Upload to private Supabase Storage bucket 'portfolio-storage'
  const { url, serviceRoleKey } = getSupabaseConfig();
  const storageUrl = `${url}/storage/v1/object/portfolio-storage/${targetPath}`;

  const uploadRes = await fetch(storageUrl, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': mimeType,
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const errorBody = await uploadRes.text();
    return res.status(500).json({ error: 'Storage upload failed: ' + errorBody });
  }

  // Create draft media_assets record in database
  try {
    if (isResume) {
      // Demote any existing unreleased draft resume so single primary draft index is maintained
      await queryServiceRole('media_assets?is_primary_resume=eq.true&status=eq.draft', {
        method: 'PATCH',
        body: { is_primary_resume: false }
      }).catch(() => {});
    }

    const mediaRecord = await queryServiceRole('media_assets', {
      method: 'POST',
      body: {
        entity_id: entityId,
        version: 1,
        status: 'draft',
        is_current_published: false,
        is_tombstone: false,
        is_primary_resume: isResume,
        filename: String(filenameHeader).replace(/[^a-zA-Z0-9.-]/g, '_'),
        storage_path: targetPath,
        bucket: 'portfolio-storage',
        mime_type: mimeType,
        size_bytes: buffer.length,
        hash_sha256: sha256,
        alt_text: isResume ? 'Pranav Shenoy Resume' : (purpose === 'experience_certificate' ? 'Experience Certificate Document' : 'Portfolio Media Asset'),
        is_public: false,
      },
    });

    await recordAuditLog({
      authUserId: user.id,
      action: 'UPLOAD',
      entityType: isResume ? 'resume' : (purpose === 'experience_certificate' ? 'experience_certificate' : 'media'),
      entityId,
      details: { path: targetPath, size: buffer.length, mimeType, purpose },
      req,
    });

    return res.status(201).json({
      success: true,
      media: mediaRecord?.[0] || mediaRecord,
      message: 'File uploaded safely to private storage in draft status.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to register media asset in database: ' + err.message });
  }
}
