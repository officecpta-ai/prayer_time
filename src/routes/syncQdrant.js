const crypto = require('crypto');
const { getConfig } = require('../config');
const { runSyncRagicToQdrant } = require('../syncRagicToQdrant');

let inFlight = false;

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * POST /internal/sync-ragic-to-qdrant
 * Header: Authorization: Bearer <SYNC_QDRANT_SECRET>（或 X-Sync-Secret: 同值）
 * 供本機／Cloud Scheduler 等排程觸發，勿暴露於公開 OpenAPI。
 */
async function postInternalSyncRagicToQdrant(req, res) {
  const { syncQdrantSecret } = getConfig();
  if (!syncQdrantSecret) {
    return res.status(404).json({ error: 'not found' });
  }
  const token =
    getBearerToken(req) || String(req.headers['x-sync-secret'] || '').trim();
  if (!timingSafeEqualStr(token, syncQdrantSecret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (inFlight) {
    return res.status(409).json({ error: 'sync_already_in_progress' });
  }
  inFlight = true;
  try {
    const stats = await runSyncRagicToQdrant();
    return res.json({ ok: true, ...stats });
  } catch (err) {
    console.error('[internal/sync-ragic-to-qdrant]', err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  } finally {
    inFlight = false;
  }
}

module.exports = { postInternalSyncRagicToQdrant };
