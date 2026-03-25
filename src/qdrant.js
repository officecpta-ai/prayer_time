const crypto = require('crypto');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { getConfig } = require('./config');

let _client;

/** 將 chunk 字串 id 轉為 Qdrant 可接受的 UUID（決定性，便於 upsert） */
function pointIdFromChunkId(chunkId) {
  const h = crypto.createHash('sha256').update(chunkId, 'utf8').digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const z = b.toString('hex');
  return `${z.slice(0, 8)}-${z.slice(8, 12)}-${z.slice(12, 16)}-${z.slice(16, 20)}-${z.slice(20, 32)}`;
}

function getQdrantClient() {
  if (_client) return _client;
  const { qdrantUrl, qdrantApiKey } = getConfig();
  if (!qdrantUrl) {
    throw new Error('QDRANT_URL 未設定');
  }
  _client = new QdrantClient({
    url: qdrantUrl,
    apiKey: qdrantApiKey || undefined,
  });
  return _client;
}

/**
 * 確保 collection 存在（Cosine、1536 維，與 text-embedding-3-small + L2 正規化一致）
 */
async function ensureChunksCollection() {
  const client = getQdrantClient();
  const { qdrantCollection } = getConfig();
  const cols = await client.getCollections();
  const names = (cols.collections || []).map((c) => c.name);
  if (!names.includes(qdrantCollection)) {
    await client.createCollection(qdrantCollection, {
      vectors: {
        size: 1536,
        distance: 'Cosine',
      },
    });
  }
  try {
    await client.createPayloadIndex(qdrantCollection, {
      field_name: 'book_id',
      field_schema: 'keyword',
    });
  } catch (_e) {
    /* 索引已存在 */
  }
}

/**
 * 向量相似度搜尋（可選依 book_id 過濾）
 * @param {number[]} queryVector 已 L2 正規化
 * @param {{ matchCount?: number, filterBookId?: string|null }} opts
 */
async function searchChunks(queryVector, opts = {}) {
  const client = getQdrantClient();
  const { qdrantCollection } = getConfig();
  const matchCount = opts.matchCount ?? 5;
  const filterBookId = opts.filterBookId;

  const filter =
    filterBookId ?
      { must: [{ key: 'book_id', match: { value: filterBookId } }] }
    : undefined;

  const res = await client.search(qdrantCollection, {
    vector: queryVector,
    limit: matchCount,
    filter,
    with_payload: true,
  });

  return (res || []).map((hit) => {
    const p = hit.payload || {};
    return {
      id: p.id,
      score: Number(hit.score || 0),
      book_id: p.book_id,
      book_name: p.book_name,
      day: p.day,
      title: p.title,
      chunk_index: p.chunk_index,
      text: p.text,
    };
  });
}

module.exports = {
  getQdrantClient,
  pointIdFromChunkId,
  ensureChunksCollection,
  searchChunks,
};
