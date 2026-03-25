#!/usr/bin/env node
/**
 * 同步 Ragic gpt/3（整本手冊內容）到 Qdrant
 * - 新增/更新：依 Ragic 資料 upsert
 * - 刪除：Ragic 已不存在的 chunk，自 Qdrant 移除
 *
 * 需求：
 * - RAGIC_API_KEY / RAGIC_BASE_URL
 * - OPENAI_API_KEY（text-embedding-3-small，1536 維）
 * - QDRANT_URL（可選 QDRANT_API_KEY）
 *
 * 本機執行：node scripts/sync-ragic-to-qdrant.js
 * Cloud Run 排程：POST /internal/sync-ragic-to-qdrant（見 scripts/gcp-schedule-qdrant-sync.example.sh）
 */

require('dotenv').config();

const { runSyncRagicToQdrant } = require('../src/syncRagicToQdrant');

runSyncRagicToQdrant()
  .then((stats) => {
    console.log('Sync done.', stats);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
