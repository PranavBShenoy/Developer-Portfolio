// api/public/media/[id].js
// Controlled private media delivery with immediate revocation on unpublish/tombstone.
// Evaluates published state in PostgreSQL on every request with zero stale CDN leakage.

import { queryServiceRole, getSupabaseConfig } from '../../supabase.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  // Consistent private no-store headers to prevent edge CDN and browser caching of unvetted/stale assets
  res.setHeader('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const id = req.query?.id || req.url.split('/').pop().split('?')[0];
  if (!id) {
    return res.status(400).json({ error: 'Media asset ID is required.' });
  }

  const { url, serviceRoleKey } = getSupabaseConfig();

  // Local development fallback when Supabase is not configured
  if (!url || !serviceRoleKey) {
    if (id === '50000000-0000-0000-0000-000000000001' || id === 'pranav-shenoy.jpg') {
      try {
        const localPath = path.resolve(process.cwd(), 'assets/pranav-shenoy.jpg');
        const buffer = await readFile(localPath);
        const hash = 'initial-portrait-hash';
        res.setHeader('ETag', `"${hash}"`);
        if (req.headers['if-none-match'] === `"${hash}"`) {
          return res.status(304).end();
        }
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', buffer.length);
        return res.status(200).send(buffer);
      } catch {
        return res.status(404).json({ error: 'Asset not found or not published.', code: 'ASSET_NOT_FOUND' });
      }
    }
    return res.status(404).json({ error: 'Asset not found or not published.', code: 'ASSET_NOT_FOUND' });
  }

  // 1. Query PostgreSQL: Must be currently published, public, and not tombstoned
  let records;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const filter = isUuid
    ? `or=(entity_id.eq.${id},id.eq.${id},storage_path.eq.${id})`
    : `storage_path=eq.${encodeURIComponent(id)}`;

  try {
    records = await queryServiceRole(
      `media_assets?${filter}&is_current_published=eq.true&is_public=eq.true&is_tombstone=eq.false&limit=2`
    );
  } catch (err) {
    return res.status(500).json({ error: 'Database verification failed.', code: 'DATABASE_ERROR' });
  }

  if (!records || records.length === 0) {
    // Immediate revocation: Unpublished, archived, or tombstoned assets return 404 instantly
    return res.status(404).json({ error: 'Asset not found or not published.', code: 'ASSET_NOT_FOUND' });
  }

  if (records.length > 1) {
    return res.status(500).json({ error: 'Inconsistent state: Multiple active assets match identifier.', code: 'INCONSISTENT_MEDIA_STATE' });
  }

  const asset = records[0];

  // 2. Conditional Revalidation: If-None-Match matches published hash
  const clientEtag = req.headers['if-none-match'];
  const assetEtag = `"${asset.hash_sha256}"`;
  res.setHeader('ETag', assetEtag);

  if (clientEtag && clientEtag === assetEtag) {
    return res.status(304).end();
  }

  // 3. Fetch binary stream from private bucket 'portfolio-storage' using service credentials
  const fileUrl = `${url}/storage/v1/object/portfolio-storage/${asset.storage_path}`;

  try {
    const storageRes = await fetch(fileUrl, {
      method: 'GET',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
    });

    if (!storageRes.ok) {
      return res.status(404).json({ error: 'Stored asset file missing from private storage.', code: 'FILE_NOT_FOUND' });
    }

    const buffer = Buffer.from(await storageRes.arrayBuffer());

    res.setHeader('Content-Type', asset.mime_type);
    res.setHeader('Content-Length', buffer.length);

    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to stream media asset.', code: 'STREAM_ERROR' });
  }
}
