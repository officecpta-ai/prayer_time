/**
 * 讀取環境變數：PORT、Ragic 基礎網址與 API Key
 */
function getConfig() {
  const baseUrl = process.env.RAGIC_BASE_URL || 'https://ap13.ragic.com/asiahope';
  let apiKey = (process.env.RAGIC_API_KEY || '').trim();
  if ((apiKey.startsWith('"') && apiKey.endsWith('"')) || (apiKey.startsWith("'") && apiKey.endsWith("'"))) {
    apiKey = apiKey.slice(1, -1).trim();
  }

  if (!apiKey) {
    console.warn('RAGIC_API_KEY 未設定，Ragic 請求可能失敗');
  }

  const apiKeyInQuery = process.env.RAGIC_API_KEY_IN_QUERY === 'true';
  // 與 scripts/deploy.sh（RAGIC_BASIC_RAW=true）一致：Ragic 文件為 Authorization: Basic + 金鑰字面。
  // 僅當明確設 RAGIC_BASIC_RAW=false 時才改用 Base64(apiKey:)。
  const basicRaw = process.env.RAGIC_BASIC_RAW !== 'false';

  // Qdrant（整本手冊 QA 向量庫）
  const qdrantUrl = (process.env.QDRANT_URL || '').replace(/\/$/, '');
  const qdrantApiKey = process.env.QDRANT_API_KEY || '';
  const qdrantCollection = process.env.QDRANT_COLLECTION || 'prayer_chunks';
  let syncQdrantSecret = (process.env.SYNC_QDRANT_SECRET || '').trim();
  if (
    (syncQdrantSecret.startsWith('"') && syncQdrantSecret.endsWith('"')) ||
    (syncQdrantSecret.startsWith("'") && syncQdrantSecret.endsWith("'"))
  ) {
    syncQdrantSecret = syncQdrantSecret.slice(1, -1).trim();
  }

  // OpenAI（embedding + QA 回答）
  const openaiApiKey = process.env.OPENAI_API_KEY || '';
  const openaiEmbedModel = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
  const openaiChatModel = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

  // Ragic 閱讀紀錄表（gpt/7）：每次閱讀寫入一筆；姓名 1011771、教會 1011772
  const readingRecordFieldIds = {
    user_email: process.env.RAGIC_READING_RECORD_FIELD_USER_EMAIL || '1011761',
    book_id: process.env.RAGIC_READING_RECORD_FIELD_BOOK_ID || '1011762',
    book_name: process.env.RAGIC_READING_RECORD_FIELD_BOOK_NAME || '1011763',
    reading_day: process.env.RAGIC_READING_RECORD_FIELD_READING_DAY || '1011764',
    read_time: process.env.RAGIC_READING_RECORD_FIELD_READ_TIME || '1011765',
    user_name: process.env.RAGIC_READING_RECORD_FIELD_USER_NAME || '1011771',
    church: process.env.RAGIC_READING_RECORD_FIELD_CHURCH || '1011772',
  };

  // 禱告內容表（gpt/3）：若 JSON 以 Ragic 欄位數字 ID 為 key，請設下列環境變數（設計模式欄位 ID）
  const contentSheetFieldIds = {
    book_id: process.env.RAGIC_CONTENT_FIELD_BOOK_ID || '',
    book_name: process.env.RAGIC_CONTENT_FIELD_BOOK_NAME || '',
    day: process.env.RAGIC_CONTENT_FIELD_DAY || '',
    title: process.env.RAGIC_CONTENT_FIELD_TITLE || '',
    content: process.env.RAGIC_CONTENT_FIELD_CONTENT || '',
  };

  // Wix 訂閱表（gpt/9）欄位 ID
  const wixSubscriptionFieldIds = {
    name: process.env.RAGIC_WIX_FIELD_NAME || '1012061',
    email: process.env.RAGIC_WIX_FIELD_EMAIL || '1011774',
    mobile: process.env.RAGIC_WIX_FIELD_MOBILE || '1012062',
    course_name: process.env.RAGIC_WIX_FIELD_COURSE_NAME || '1011777',
    price_amount: process.env.RAGIC_WIX_FIELD_PRICE_AMOUNT || '1011779',
    start_date: process.env.RAGIC_WIX_FIELD_START_DATE || '1011780',
    end_date: process.env.RAGIC_WIX_FIELD_END_DATE || '1011783',
    orderNumbe: process.env.RAGIC_WIX_FIELD_ORDER_NUMBE || '1011778',
    ticketNumber: process.env.RAGIC_WIX_FIELD_TICKET_NUMBER || '1012060',
  };

  return {
    ragicBaseUrl: baseUrl.replace(/\/$/, ''),
    ragicApiKey: apiKey,
    ragicApiKeyInQuery: apiKeyInQuery,
    ragicBasicRaw: basicRaw,
    port: parseInt(process.env.PORT || '8080', 10),
    qdrantUrl,
    qdrantApiKey,
    qdrantCollection,
    syncQdrantSecret,
    openaiApiKey,
    openaiEmbedModel,
    openaiChatModel,
    readingRecordFieldIds,
    contentSheetFieldIds,
    wixSubscriptionFieldIds,
  };
}

module.exports = { getConfig };
