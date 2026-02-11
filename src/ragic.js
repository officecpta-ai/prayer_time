const { getConfig } = require('./config');

const RAGIC_SHEETS = {
  BOOK_LIST: 'gpt/5',
  CONTENT: 'gpt/3',
  SUBSCRIPTION: 'gpt/4',
  READING_RECORD: 'gpt/7',
  CONVERSATION_LOG: 'gpt/10',
};

/**
 * 呼叫 Ragic API GET
 * @param {string} sheetPath - 表單路徑，如 gpt/5
 * @param {Record<string, string>} queryParams - 查詢參數
 */
/**
 * Ragic 官方認證：HTTP Basic（API key 當 username，密碼留空）
 * 見 https://www.ragic.com/intl/en/doc-api/24/HTTP-Basic-authentication-with-Ragic-API-Key
 * 預設：標準 Base64(apiKey:)。若 RAGIC_BASIC_RAW=true 則送 "Basic " + apiKey 字面（不編碼）
 */
function getRagicAuthHeader(apiKey, useQueryKey, basicRaw) {
  if (!apiKey || useQueryKey) return {};
  const value = basicRaw ? apiKey : Buffer.from(`${apiKey}:`).toString('base64');
  return { Authorization: `Basic ${value}` };
}

async function ragicGet(sheetPath, queryParams = {}) {
  const { ragicBaseUrl, ragicApiKey, ragicApiKeyInQuery, ragicBasicRaw } = getConfig();
  const url = new URL(`${ragicBaseUrl}/${sheetPath}`);
  url.searchParams.set('api', 'true');
  if (ragicApiKey && ragicApiKeyInQuery) {
    url.searchParams.set('APIKey', ragicApiKey);
  }
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });

  const headers = getRagicAuthHeader(ragicApiKey, ragicApiKeyInQuery, ragicBasicRaw);

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Ragic 錯誤 ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/**
 * 將 Ragic 回傳的 {"列ID": {...}} 轉成陣列
 */
function rowsToArray(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.values(obj).filter((row) => row && typeof row === 'object');
}

/** 禱告手冊清單 gpt/5 */
async function getBookList() {
  const data = await ragicGet(RAGIC_SHEETS.BOOK_LIST);
  return rowsToArray(data);
}

/**
 * 禱告手冊內容 gpt/3：依 book_id + day 取一筆
 * 必須同時符合 day 與 book_id，避免 Ragic 回傳多筆時取到錯的書（選主禱文卻顯示使徒信經）
 */
async function getContentByBookAndDay(bookId, day) {
  const data = await ragicGet(RAGIC_SHEETS.CONTENT, {
    book_id: bookId,
    day: String(day),
  });
  const rows = rowsToArray(data);
  const targetDay = Number(day);
  const normId = (v) => String(v || '').trim();
  const match = rows.find(
    (r) => Number(r.day) === targetDay && normId(r.book_id) === normId(bookId)
  );
  return match || null;
}

/** 僅當 is_active 為明確停用值時視為未訂閱；其餘有值或常見啟用寫法皆視為有效 */
function isSubscriptionActive(v) {
  if (v == null || v === '') return false;
  const s = String(v).toLowerCase().trim();
  if (s === 'disable' || s === 'disabled' || s === 'no' || s === '否' || s === '0') return false;
  if (v === true) return true;
  return (
    s === 'yes' || s === '是' || s === 'enable' || s === 'enabled' || s === '1' ||
    s === '啟用' || s === 'active' || s === 'true' || s === '✓' || s === 'v' || s === 'ｏ' || s === 'o'
  );
}

/** 訂閱表（gpt/4）中文欄位名對應（Ragic 可能回傳中文 key） */
const SUB_ALT_KEYS = {
  user_name: ['user_name', '姓名'],
  user_email: ['user_email', 'email', 'Email'],
  book_id: ['book_id', '選擇訂閱書本', '書名'],
  book_name: ['book_name', '書名', '選擇訂閱書本'],
  is_active: ['is_active', 'Is_active'],
  church: ['church', '教會'],
};

/** 從一列訂閱資料取欄位值：先試欄位名與中文別名，再試 config 的欄位 ID */
function getSubField(row, fieldName, ids) {
  if (!row || typeof row !== 'object') return '';
  const keysToTry = SUB_ALT_KEYS[fieldName] ? [fieldName, ...SUB_ALT_KEYS[fieldName]] : [fieldName];
  for (const k of keysToTry) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  const id = ids && ids[fieldName];
  if (id && row[id] !== undefined && row[id] !== null) return String(row[id]);
  return '';
}

/** 從訂閱列取得 book_id：欄位可能存 book_id 或書名（book_name），用書單做對照 */
function resolveSubscriptionBookId(row, subscriptionFieldIds, bookIdToName, nameToId) {
  const raw = getSubField(row, 'book_id', subscriptionFieldIds) || getSubField(row, 'book_name', subscriptionFieldIds);
  const v = (raw && String(raw).trim()) || '';
  if (!v) return null;
  if (bookIdToName.has(v)) return v;
  return nameToId.get(v) || null;
}

/**
 * 檢查是否已訂閱 gpt/4：user_email + book_id + is_active 為啟用
 * 訂閱表可能存書名（選擇訂閱書本/書名），會對照 gpt/5 解析為 book_id
 */
async function checkSubscription(userEmail, bookId) {
  const { subscriptionFieldIds } = getConfig();
  const [subData, bookList] = await Promise.all([
    ragicGet(RAGIC_SHEETS.SUBSCRIPTION),
    ragicGet(RAGIC_SHEETS.BOOK_LIST),
  ]);
  const rows = rowsToArray(subData);
  const books = rowsToArray(bookList);
  const bookIdToName = new Map();
  const nameToId = new Map();
  for (const b of books) {
    if (b.book_id != null) {
      bookIdToName.set(String(b.book_id), String(b.book_name || ''));
      if (b.book_name != null) nameToId.set(String(b.book_name).trim(), String(b.book_id));
    }
  }
  const email = String(userEmail || '').toLowerCase().trim();
  const book = String(bookId || '');
  const match = rows.find((r) => {
    const rEmail = getSubField(r, 'user_email', subscriptionFieldIds);
    const rActive = getSubField(r, 'is_active', subscriptionFieldIds);
    if (rEmail.toLowerCase().trim() !== email || !isSubscriptionActive(rActive)) return false;
    const rBookId = resolveSubscriptionBookId(r, subscriptionFieldIds, bookIdToName, nameToId);
    return rBookId !== null && rBookId === book;
  });
  return !!match;
}

/**
 * 檢查使用者是否有任一有效訂閱（gpt/4：user_email + is_active 為啟用）
 * 支援 Ragic 回傳欄位名或欄位 ID
 */
async function hasAnySubscription(userEmail) {
  const { subscriptionFieldIds } = getConfig();
  const data = await ragicGet(RAGIC_SHEETS.SUBSCRIPTION);
  const rows = rowsToArray(data);
  const email = String(userEmail || '').toLowerCase().trim();
  const match = rows.some((r) => {
    const rEmail = getSubField(r, 'user_email', subscriptionFieldIds);
    const rActive = getSubField(r, 'is_active', subscriptionFieldIds);
    return rEmail.toLowerCase().trim() === email && isSubscriptionActive(rActive);
  });
  return match;
}

/**
 * 依 email 回傳該使用者已訂閱的書單（gpt/4 有紀錄且 is_active，書名從 gpt/5 對應），並從訂閱表取姓名
 * 訂閱表可能存書名（選擇訂閱書本/書名），會對照 gpt/5 解析為 book_id
 * @returns {Promise<{ books: Array<{ book_id: string, book_name: string }>, user_name: string|null }>}
 */
async function getSubscribedBooksByEmail(userEmail) {
  const { subscriptionFieldIds } = getConfig();
  const [subData, bookList] = await Promise.all([
    ragicGet(RAGIC_SHEETS.SUBSCRIPTION),
    ragicGet(RAGIC_SHEETS.BOOK_LIST),
  ]);
  const subRows = rowsToArray(subData);
  const books = rowsToArray(bookList);
  const email = String(userEmail || '').toLowerCase().trim();
  const bookIdToName = new Map();
  const nameToId = new Map();
  for (const b of books) {
    if (b.book_id != null) {
      bookIdToName.set(String(b.book_id), String(b.book_name || ''));
      if (b.book_name != null) nameToId.set(String(b.book_name).trim(), String(b.book_id));
    }
  }
  const seen = new Set();
  const out = [];
  let user_name = null;
  for (const r of subRows) {
    const rEmail = getSubField(r, 'user_email', subscriptionFieldIds);
    const rActive = getSubField(r, 'is_active', subscriptionFieldIds);
    if (rEmail.toLowerCase().trim() !== email || !isSubscriptionActive(rActive)) continue;
    if (user_name === null) {
      const name = getSubField(r, 'user_name', subscriptionFieldIds);
      if (name && String(name).trim()) user_name = String(name).trim();
    }
    const bid = resolveSubscriptionBookId(r, subscriptionFieldIds, bookIdToName, nameToId);
    if (!bid || seen.has(bid)) continue;
    seen.add(bid);
    out.push({ book_id: bid, book_name: bookIdToName.get(bid) || bid });
  }
  return { books: out, user_name: user_name || null };
}

/**
 * 依 email 從訂閱表（gpt/4）取得該使用者姓名與教會（掃描所有有效訂閱列，取第一個非空值）
 * @returns {Promise<{ user_name: string|null, church: string|null }>}
 */
async function getSubscriptionUserInfo(userEmail) {
  const { subscriptionFieldIds } = getConfig();
  const data = await ragicGet(RAGIC_SHEETS.SUBSCRIPTION);
  const rows = rowsToArray(data);
  const email = String(userEmail || '').toLowerCase().trim();
  let foundName = null;
  let foundChurch = null;
  for (const r of rows) {
    const rEmail = getSubField(r, 'user_email', subscriptionFieldIds);
    const rActive = getSubField(r, 'is_active', subscriptionFieldIds);
    if (rEmail.toLowerCase().trim() !== email || !isSubscriptionActive(rActive)) continue;
    if (foundName === null) {
      const name = getSubField(r, 'user_name', subscriptionFieldIds);
      if (name && String(name).trim()) foundName = String(name).trim();
    }
    if (foundChurch === null) {
      const church = getSubField(r, 'church', subscriptionFieldIds);
      if (church && String(church).trim()) foundChurch = String(church).trim();
    }
    if (foundName !== null && foundChurch !== null) break;
  }
  return { user_name: foundName, church: foundChurch };
}

/**
 * 依 email 從訂閱表（gpt/4）取得該使用者姓名（第一筆有效訂閱的姓名）
 * @returns {Promise<string|null>}
 */
async function getSubscriptionUserName(userEmail) {
  const info = await getSubscriptionUserInfo(userEmail);
  return info.user_name;
}

/**
 * 將 Ragic 回傳的 read_time 轉成可比較的字串（yyyy/MM/dd HH:mm:ss）
 * 允許 "yyyy/MM/dd HH:mm" 或僅日期；不足部分補 0。
 */
function normalizeReadTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const [datePart, timePartRaw] = s.split(' ');
  const date = datePart?.replace(/-/g, '/');
  if (!date) return null;
  let time = timePartRaw || '00:00:00';
  const parts = time.split(':');
  if (parts.length === 2) time = `${parts[0]}:${parts[1]}:00`;
  if (parts.length === 1) time = `${parts[0]}:00:00`;
  const [hh = '00', mm = '00', ss = '00'] = time.split(':');
  return `${date} ${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.padStart(2, '0')}`;
}

/**
 * 從閱讀紀錄 gpt/7 推導使用者的最後閱讀進度（最後一次閱讀的書與天數）
 * 回傳 shape 與原 gpt/6 相容：{ last_book_id, last_book_name, last_day, last_read_date }
 * @returns {Promise<null|{last_book_id:string,last_book_name:string,last_day:number,last_read_date:string}>}
 */
async function getProgressByEmail(userEmail) {
  const data = await ragicGet(RAGIC_SHEETS.READING_RECORD);
  const rows = rowsToArray(data);
  const email = String(userEmail || '').toLowerCase().trim();
  let best = null;
  let bestTime = null;
  for (const r of rows) {
    if (String(r.user_email || '').toLowerCase().trim() !== email) continue;
    const t = normalizeReadTime(r.read_time);
    if (!t) continue;
    if (!bestTime || t > bestTime) {
      bestTime = t;
      best = r;
    }
  }
  if (!best) return null;
  const day = Number(best.reading_day);
  const lastDay = Number.isFinite(day) ? day : null;
  const lastReadDate = bestTime ? String(bestTime).split(' ')[0] : '';
  return {
    last_book_id: String(best.book_id ?? ''),
    last_book_name: String(best.book_name ?? ''),
    last_day: lastDay,
    last_read_date: lastReadDate,
  };
}

/**
 * 將 Date 轉為 Ragic 可用的日期時間字串（台灣時區）：yyyy/MM/dd HH:mm:ss
 * @param {Date} d
 */
function formatRagicDateTimeTaipei(d) {
  // 使用固定時區避免 Cloud Run 預設 UTC 造成時間偏差
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
  // sv-SE: "2026-02-05 14:50:00" → "2026/02/05 14:50:00"
  return s.replace(/-/g, '/');
}

/**
 * 寫入一筆閱讀紀錄到 gpt/7（閱讀紀錄表）。每次使用者成功取得某日內容時呼叫。
 * @param {{ user_email: string, book_id: string, book_name: string, reading_day: number, read_time?: string, user_name?: string, church?: string }} payload
 */
async function createReadingRecord(payload) {
  const { ragicBaseUrl, ragicApiKey, ragicApiKeyInQuery, ragicBasicRaw, readingRecordFieldIds } = getConfig();
  const url = new URL(`${ragicBaseUrl}/${RAGIC_SHEETS.READING_RECORD}`);
  url.searchParams.set('api', 'true');
  if (ragicApiKey && ragicApiKeyInQuery) url.searchParams.set('APIKey', ragicApiKey);
  const headers = {
    'Content-Type': 'application/json',
    ...getRagicAuthHeader(ragicApiKey, ragicApiKeyInQuery, ragicBasicRaw),
  };
  const ids = readingRecordFieldIds;
  const readTimeStr = payload.read_time || formatRagicDateTimeTaipei(new Date());
  const body = {
    [ids.user_email]: String(payload.user_email || ''),
    [ids.book_id]: String(payload.book_id ?? ''),
    [ids.book_name]: String(payload.book_name ?? ''),
    [ids.reading_day]: payload.reading_day != null ? Number(payload.reading_day) : '',
    [ids.read_time]: readTimeStr,
  };
  if (ids.user_name) body[ids.user_name] = String(payload.user_name ?? '');
  if (ids.church) body[ids.church] = String(payload.church ?? '');
  if (process.env.RAGIC_DEBUG === '1' || process.env.RAGIC_DEBUG === 'true') {
    console.log('[createReadingRecord] 寫入欄位:', { user_name: payload.user_name ?? '(空)', church: payload.church ?? '(空)', body_keys: Object.keys(body) });
  }
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Ragic 寫入閱讀紀錄錯誤 ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/**
 * 寫入一筆對話紀錄到 gpt/10（對話紀錄表）。由各 route 在處理請求成功時順便呼叫（fire-and-forget）。
 * @param {{ email: string, user_name?: string, role: 'user'|'assistant', message: string, conversation_id?: string, record_time?: string }} payload
 */
async function createConversationLog(payload) {
  const { ragicBaseUrl, ragicApiKey, ragicApiKeyInQuery, ragicBasicRaw, conversationLogFieldIds } = getConfig();
  const url = new URL(`${ragicBaseUrl}/${RAGIC_SHEETS.CONVERSATION_LOG}`);
  url.searchParams.set('api', 'true');
  if (ragicApiKey && ragicApiKeyInQuery) url.searchParams.set('APIKey', ragicApiKey);
  const headers = {
    'Content-Type': 'application/json',
    ...getRagicAuthHeader(ragicApiKey, ragicApiKeyInQuery, ragicBasicRaw),
  };
  const ids = conversationLogFieldIds;
  const body = {
    [ids.record_time]: payload.record_time || formatRagicDateTimeTaipei(new Date()),
    [ids.email]: String(payload.email || ''),
    [ids.user_name]: String(payload.user_name ?? ''),
    [ids.role]: String(payload.role || 'user'),
    [ids.message]: String(payload.message ?? ''),
    [ids.conversation_id]: String(payload.conversation_id ?? ''),
  };
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Ragic 寫入對話紀錄錯誤 ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/**
 * 取得使用者在指定書本的最後閱讀天數（從 gpt/7 閱讀紀錄取 reading_day 最大值）
 * @returns {Promise<number|null>} last_day 或 null（尚無紀錄）
 */
async function getLastReadingDayByEmailAndBook(userEmail, bookId) {
  const data = await ragicGet(RAGIC_SHEETS.READING_RECORD);
  const rows = rowsToArray(data);
  const email = String(userEmail || '').toLowerCase().trim();
  const book = String(bookId || '');
  let maxDay = null;
  for (const r of rows) {
    if (String(r.user_email || '').toLowerCase().trim() !== email) continue;
    if (String(r.book_id || '') !== book) continue;
    const d = Number(r.reading_day);
    if (!Number.isFinite(d)) continue;
    if (maxDay == null || d > maxDay) maxDay = d;
  }
  return maxDay;
}

/**
 * 取得指定手冊 1–31 天的標題清單（從 gpt/3 內容表取 title）
 * 僅採用 book_id 相符的列，避免 Ragic 回傳多筆時混入他書（查主禱文卻顯示使徒信經）
 * @returns {Promise<{ book_id: string, book_name: string, titles: Array<{day:number,title:string|null}> }>}
 */
async function getBookDayTitles(bookId) {
  const data = await ragicGet(RAGIC_SHEETS.CONTENT, { book_id: bookId });
  const rows = rowsToArray(data);
  const wantId = String(bookId || '').trim();
  const map = new Map(); // day(number) -> title(string)
  let bookName = '';
  for (const r of rows) {
    const rowBookId = String(r.book_id ?? '').trim();
    if (rowBookId !== wantId) continue;
    const d = Number(r.day);
    if (!Number.isFinite(d)) continue;
    if (d < 1 || d > 31) continue;
    if (!bookName && r.book_name) bookName = String(r.book_name);
    if (!map.has(d) && r.title != null && String(r.title).trim() !== '') {
      map.set(d, String(r.title));
    }
  }
  const titles = Array.from({ length: 31 }, (_, idx) => {
    const day = idx + 1;
    return { day, title: map.get(day) ?? null };
  });
  return { book_id: String(bookId), book_name: bookName, titles };
}

module.exports = {
  ragicGet,
  rowsToArray,
  getBookList,
  getContentByBookAndDay,
  checkSubscription,
  hasAnySubscription,
  getSubscribedBooksByEmail,
  getSubscriptionUserName,
  getSubscriptionUserInfo,
  getProgressByEmail,
  createReadingRecord,
  createConversationLog,
  getLastReadingDayByEmailAndBook,
  getBookDayTitles,
  RAGIC_SHEETS,
};
