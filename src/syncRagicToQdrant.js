const { ragicGet, rowsToArray, getContentSheetField } = require('./ragic');
const { splitIntoChunks } = require('./chunking');
const { embedBatch, l2Normalize } = require('./openai');
const {
  getQdrantClient,
  pointIdFromChunkId,
  ensureChunksCollection,
} = require('./qdrant');
const { getConfig } = require('./config');

const UPSERT_BATCH = 64;

function buildChunkId({ bookId, day, chunkIndex }) {
  return `${bookId}__${day}__${chunkIndex}`;
}

async function scrollAllChunkKeys(collection) {
  const client = getQdrantClient();
  const keys = [];
  let offset = undefined;
  for (;;) {
    const page = await client.scroll(collection, {
      limit: 256,
      offset,
      with_payload: ['id'],
      with_vector: false,
    });
    const points = page.points || [];
    for (const pt of points) {
      const id = pt.payload && pt.payload.id;
      if (id) keys.push(String(id));
    }
    offset = page.next_page_offset;
    if (offset == null || points.length === 0) break;
  }
  return keys;
}

/**
 * 將 Ragic gpt/3 同步至 Qdrant（與 scripts/sync-ragic-to-qdrant.js 相同邏輯）
 * @returns {Promise<{ totalChunks: number, rowCount: number, deletedOrphans: number }>}
 */
async function runSyncRagicToQdrant() {
  const cfg = getConfig();
  if (!cfg.qdrantUrl) {
    throw new Error('QDRANT_URL 未設定');
  }
  if (!cfg.openaiApiKey) throw new Error('OPENAI_API_KEY 未設定');

  await ensureChunksCollection();
  const client = getQdrantClient();
  const collection = cfg.qdrantCollection;

  console.log(`[sync-qdrant] start collection=${collection}`);

  const data = await ragicGet('gpt/3');
  const rows = rowsToArray(data);
  if (process.env.RAGIC_SYNC_DEBUG === 'true') {
    const t = data == null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
    console.log('[sync-debug] body type:', t, 'rows:', rows.length);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      console.log('[sync-debug] top keys (前 30 個):', Object.keys(data).slice(0, 30).join(', '));
    }
  }
  if (!rows.length) {
    console.log('[sync-qdrant] No rows from Ragic gpt/3.');
  }

  let totalChunks = 0;
  const ragicChunkIds = new Set();
  let batch = [];

  async function flushBatch() {
    if (!batch.length) return;
    await client.upsert(collection, { wait: true, points: batch });
    batch = [];
  }

  for (const r of rows) {
    const bookId = String(getContentSheetField(r, 'book_id') || '').trim();
    const bookName = String(getContentSheetField(r, 'book_name') || '').trim();
    const day = Number(getContentSheetField(r, 'day'));
    const title = String(getContentSheetField(r, 'title') || '').trim();
    const content = String(getContentSheetField(r, 'content') || '').trim();
    if (!bookId || !Number.isInteger(day) || day < 1 || day > 31) continue;
    if (!content) continue;

    const chunks = splitIntoChunks(content);
    if (!chunks.length) continue;

    const vectors = (await embedBatch(chunks)).map((v) => l2Normalize(v));
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkIndex = i + 1;
      const chunkId = buildChunkId({ bookId, day, chunkIndex });
      const embedding = vectors[i];
      if (!embedding || embedding.length !== 1536) continue;

      ragicChunkIds.add(chunkId);
      batch.push({
        id: pointIdFromChunkId(chunkId),
        vector: embedding,
        payload: {
          id: chunkId,
          book_id: bookId,
          book_name: bookName || null,
          day,
          title: title || null,
          chunk_index: chunkIndex,
          text: chunks[i],
        },
      });

      if (batch.length >= UPSERT_BATCH) {
        await flushBatch();
      }
      totalChunks += 1;
      if (totalChunks % 50 === 0) console.log(`[sync-qdrant] ...chunks=${totalChunks}`);
    }
  }

  await flushBatch();

  if (rows.length > 0 && totalChunks === 0) {
    console.warn(
      '[sync-qdrant] Ragic 有',
      rows.length,
      '筆列但未能寫入任何 chunk。第一筆 keys:',
      Object.keys(rows[0]).join(', ')
    );
  }

  const existingKeys = await scrollAllChunkKeys(collection);
  const toDelete = [];
  for (const key of existingKeys) {
    if (!ragicChunkIds.has(key)) {
      toDelete.push(pointIdFromChunkId(key));
    }
  }

  if (toDelete.length > 0) {
    const delBatch = 256;
    for (let i = 0; i < toDelete.length; i += delBatch) {
      const slice = toDelete.slice(i, i + delBatch);
      await client.delete(collection, { wait: true, points: slice });
    }
    console.log(`[sync-qdrant] deleted ${toDelete.length} orphaned points`);
  }

  console.log(`[sync-qdrant] done totalChunks=${totalChunks}`);
  return {
    totalChunks,
    rowCount: rows.length,
    deletedOrphans: toDelete.length,
  };
}

module.exports = { runSyncRagicToQdrant };
