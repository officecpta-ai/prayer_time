#!/usr/bin/env node
/**
 * 同步 Ragic gpt/3（整本手冊內容）到：
 * - Firestore collection: prayer_time_chunks
 * - Vertex AI Vector Search index（stream update）
 *
 * 需求：
 * - RAGIC_API_KEY / RAGIC_BASE_URL
 * - OPENAI_API_KEY（用 text-embedding-3-small 產生向量，1536 維）
 * - VERTEX_PROJECT_ID / VERTEX_LOCATION / VERTEX_INDEX_ID
 *
 * 注意：此腳本會寫入雲端資源，請在本機或受信任環境執行。
 */

require('dotenv').config();

const { getFirestore } = require('../src/firestore');
const { ragicGet, rowsToArray } = require('../src/ragic');
const { splitIntoChunks } = require('../src/chunking');
const { openaiEmbedBatch, l2Normalize } = require('../src/openai');
const { vertexUpsertDatapoints } = require('../src/vertex');
const { getConfig } = require('../src/config');

const COLLECTION = process.env.FIRESTORE_CHUNKS_COLLECTION || 'prayer_time_chunks';

function buildChunkId({ bookId, day, chunkIndex }) {
  return `${bookId}__${day}__${chunkIndex}`;
}

async function main() {
  const cfg = getConfig();
  const indexId = cfg.vertexIndexId;
  if (!indexId) throw new Error('VERTEX_INDEX_ID 未設定');

  console.log(`Sync start: collection=${COLLECTION}`);

  // 取回整個 gpt/3（內容表），按 book_id/day 整理
  const data = await ragicGet('gpt/3');
  const rows = rowsToArray(data);
  if (!rows.length) {
    console.log('No rows from Ragic gpt/3.');
    return;
  }

  const db = getFirestore();
  const col = db.collection(COLLECTION);

  // 以 (book_id, day) 為單位 chunk
  let totalChunks = 0;
  for (const r of rows) {
    const bookId = String(r.book_id || '').trim();
    const bookName = String(r.book_name || '').trim();
    const day = Number(r.day);
    const title = String(r.title || '').trim();
    const content = String(r.content || '').replace(/\[br\]\[\/br\]/g, '\n');
    if (!bookId || !Number.isInteger(day)) continue;
    if (!content.trim()) continue;

    const chunks = splitIntoChunks(content);
    if (!chunks.length) continue;

    // 每日 chunk：批次 embeddings（降低 API 呼叫次數），再寫 Firestore + upsert Vertex
    const vectors = (await openaiEmbedBatch(chunks)).map((v) => l2Normalize(v));
    const datapoints = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkIndex = i + 1;
      const chunkText = chunks[i];
      const chunkId = buildChunkId({ bookId, day, chunkIndex });
      const embedding = vectors[i];
      datapoints.push({
        datapointId: chunkId,
        featureVector: embedding,
        restricts: [
          { namespace: 'book_id', allowList: [bookId] },
          { namespace: 'day', allowList: [String(day)] },
        ],
      });

      await col.doc(chunkId).set(
        {
          chunk_id: chunkId,
          book_id: bookId,
          book_name: bookName,
          day,
          title,
          chunk_index: chunkIndex,
          text: chunkText,
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      );
      totalChunks += 1;
      if (totalChunks % 50 === 0) console.log(`...chunks=${totalChunks}`);
    }

    // Upsert Vertex（每一天一批）
    await vertexUpsertDatapoints({ indexId, datapoints });
  }

  console.log(`Sync done. totalChunks=${totalChunks}`);
}

main().catch((e) => {
  console.error('sync_error', e?.message || String(e));
  process.exitCode = 1;
});

