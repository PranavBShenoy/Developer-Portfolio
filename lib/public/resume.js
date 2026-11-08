// api/public/resume.js
// Controlled private resume PDF delivery with strict single designated asset selection and instant revocation.

import { queryServiceRole, getSupabaseConfig } from '../supabase.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  // Consistent private no-store delivery ensuring immediate revocation upon unpublish/replacement (0s delay)
  res.setHeader('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox;");

  const { url, serviceRoleKey } = getSupabaseConfig();

  // If Supabase credentials are missing (local dev mock mode), serve local static resume
  if (!url || !serviceRoleKey) {
    try {
      const fallbackPath = path.resolve(process.cwd(), 'assets/pranav-shenoy-resume.pdf');
      const fallbackBuffer = await readFile(fallbackPath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="Pranav-Shenoy-Resume.pdf"');
      res.setHeader('Content-Length', fallbackBuffer.length);
      return res.status(200).send(fallbackBuffer);
    } catch {
      return res.status(404).json({ error: 'Resume document currently unavailable.', code: 'RESUME_UNAVAILABLE' });
    }
  }

  // 1. Query explicitly designated published resume: Exactly one must exist
  let records;
  try {
    records = await queryServiceRole(
      'media_assets?is_primary_resume=eq.true&is_current_published=eq.true&is_tombstone=eq.false'
    );
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify published resume status.', code: 'DATABASE_ERROR' });
  }

  // Deterministic behavior when no resume is published
  if (!records || records.length === 0) {
    return res.status(404).json({
      error: 'No resume document is currently published.',
      code: 'RESUME_NOT_PUBLISHED'
    });
  }

  // Guard against inconsistent data: Throw error rather than arbitrarily choosing a record
  if (records.length > 1) {
    return res.status(500).json({
      error: 'Inconsistent state: Multiple assets designated as primary published resume.',
      code: 'INCONSISTENT_RESUME_STATE'
    });
  }

  const resumeAsset = records[0];

  // 2. Validate that the designated asset is a published PDF
  if (resumeAsset.mime_type !== 'application/pdf') {
    return res.status(500).json({
      error: 'Inconsistent data: Designated primary resume is not a PDF document.',
      code: 'INVALID_RESUME_MIME_TYPE'
    });
  }

  // 3. Conditional Revalidation: If-None-Match matches published hash
  const clientEtag = req.headers['if-none-match'];
  const assetEtag = `"${resumeAsset.hash_sha256}"`;
  res.setHeader('ETag', assetEtag);

  if (clientEtag && clientEtag === assetEtag) {
    return res.status(304).end();
  }

  // 4. Stream binary from private bucket 'portfolio-storage'
  const fileUrl = `${url}/storage/v1/object/portfolio-storage/${resumeAsset.storage_path}`;

  try {
    const storageRes = await fetch(fileUrl, {
      method: 'GET',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
    });

    if (!storageRes.ok) {
      return res.status(404).json({ error: 'Resume file missing from storage repository.', code: 'FILE_NOT_FOUND' });
    }

    const buffer = Buffer.from(await storageRes.arrayBuffer());

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${resumeAsset.filename || 'Pranav-Shenoy-Resume.pdf'}"`);
    res.setHeader('Content-Length', buffer.length);

    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to stream resume document.', code: 'STREAM_ERROR' });
  }
}
