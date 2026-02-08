const { getConfig } = require('./config');

const RAGIC_SHEETS = {
  BOOK_LIST: 'gpt/5',
  CONTENT: 'gpt/3',
  SUBSCRIPTION: 'gpt/4',
  READING_RECORD: 'gpt/7',
};

function getRagicAuthHeader(apiKey, useQueryKey, basicRaw) {
  if (!apiKey || useQueryKey) return {};
  const value = basicRaw ? apiKey : Buffer.from(`${apiKey}:`).toString('base64');
  return { Authorization: `Basic ${value}` };
}

async function ragicGet(sheetPath, queryParams = {}) {
  const { ragicBaseUrl, ragicApiKey, ragicApiKeyInQuery, ragicBasicRaw } = getConfig();
  const url = new URL(`${ragicBaseUrl}/${sheetPath}`);
  url.searchParams.set('api', 'true');
  if (ragicApiKey && ragicApiKeyInQuery) url.searchParams.set('APIKey', ragicApiKey);
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });

  const headers = getRagicAuthHeader(ragicApiKey, ragicApiKeyInQuery, ragicBasicRaw);
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Ragic 錯誤 ${res.status}`);
  }
  return res.json();
}

function rowsToArray(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.values(obj).filter((row) => row && typeof row === 'object');
}

function isSubscriptionActive(v) {
  if (v == null || v === '') return false;
  const s = String(v).toLowerCase().trim();
  if (s === 'disable' || s === 'disabled' || s === 'no' || s === '否' || s === '0') return false;
  if (v === true) return true;
  return s === 'yes' || s === '是' || s === 'enable' || s === 'enabled' || s === '1';
}

async function getBookList() {
  const data = await ragicGet(RAGIC_SHEETS.BOOK_LIST);
  return rowsToArray(data);
}

let _bookMapsCache = null; // { atMs, idToName: Map, nameToId: Map }
async function getBookMaps({ ttlMs = 5 * 60 * 1000 } = {}) {
  const now = Date.now();
  if (_bookMapsCache && now - _bookMapsCache.atMs < ttlMs) return _bookMapsCache;
  const books = await getBookList();
  const idToName = new Map();
  const nameToId = new Map();
  for (const b of books) {
    const id = String(b.book_id || '').trim();
    const name = String(b.book_name || '').trim();
    if (id) idToName.set(id, name);
    if (name) nameToId.set(name, id);
  }
  _bookMapsCache = { atMs: now, idToName, nameToId };
  return _bookMapsCache;
}

function pickFirstNonEmpty(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

/** 依 line_user_id 從訂閱表（gpt/4）取得姓名與教會（掃描所有有效訂閱列，取第一個非空值） */
async function getSubscriptionUserInfoByLineUserId(lineUserId) {
  const { subscriptionFieldIds } = getConfig();
  const data = await ragicGet(RAGIC_SHEETS.SUBSCRIPTION);
  const rows = rowsToArray(data);
  const u = String(lineUserId || '').trim();
  let foundName = null;
  let foundChurch = null;
  for (const r of rows) {
    const rLine = pickFirstNonEmpty(r, ['line_user_id', subscriptionFieldIds.line_user_id]);
    if (rLine.trim() !== u) continue;
    if (!isSubscriptionActive(pickFirstNonEmpty(r, ['is_active', subscriptionFieldIds.is_active]))) continue;
    if (foundName === null) {
      const name = pickFirstNonEmpty(r, ['user_name', '姓名', subscriptionFieldIds.user_name]);
      if (name) foundName = name;
    }
    if (foundChurch === null) {
      const church = pickFirstNonEmpty(r, ['church', '教會', subscriptionFieldIds.church]);
      if (church) foundChurch = church;
    }
    if (foundName !== null && foundChurch !== null) break;
  }
  return { user_name: foundName, church: foundChurch };
}

async function getContentByBookAndDay(bookId, day) {
  const { idToName } = await getBookMaps();
  const desiredBookId = String(bookId || '').trim();
  const desiredBookName = idToName.get(desiredBookId) || '';

  const data = await ragicGet(RAGIC_SHEETS.CONTENT, {
    book_id: bookId,
    day: String(day),
  });
  const rows = rowsToArray(data);
  const target = Number(day);
  const filtered = rows.filter((r) => {
    const rb = String(r.book_id || '').trim();
    const rn = String(r.book_name || '').trim();
    if (desiredBookId && rb && rb === desiredBookId) return true;
    if (desiredBookName && rn && rn === desiredBookName) return true;
    return false;
  });

  const match = filtered.find((r) => Number(r.day) === target);
  if (match) return match;
  return null;
}

async function checkSubscriptionByLineUserId(lineUserId, bookId) {
  const { idToName } = await getBookMaps();
  const desiredBookId = String(bookId || '').trim();
  const desiredBookName = idToName.get(desiredBookId) || '';

  const data = await ragicGet(RAGIC_SHEETS.SUBSCRIPTION);
  const rows = rowsToArray(data);
  const u = String(lineUserId || '').trim();
  for (const r of rows) {
    if (String(r.line_user_id || '').trim() !== u) continue;
    if (!isSubscriptionActive(r.is_active)) continue;

    // 訂閱表的「書本」欄位有機會回傳 book_id 或 book_name（依欄位型態/顯示值而定）
    // 我們同時比對 book_id 與 book_name，避免誤判未訂閱。
    const rowBookId = pickFirstNonEmpty(r, ['book_id']);
    const rowBookName = pickFirstNonEmpty(r, ['book_name', '書名', '選擇訂閱書本']);

    if (desiredBookId && rowBookId && rowBookId === desiredBookId) return true;
    if (desiredBookName && rowBookName && rowBookName === desiredBookName) return true;
  }
  return false;
}

async function getActiveSubscribedBookIdsByLineUserId(lineUserId) {
  const { nameToId } = await getBookMaps();
  const data = await ragicGet(RAGIC_SHEETS.SUBSCRIPTION);
  const rows = rowsToArray(data);
  const u = String(lineUserId || '').trim();
  const set = new Set();
  for (const r of rows) {
    if (String(r.line_user_id || '').trim() !== u) continue;
    if (!isSubscriptionActive(r.is_active)) continue;
    const rowBookId = pickFirstNonEmpty(r, ['book_id']);
    if (rowBookId) {
      set.add(rowBookId);
      continue;
    }
    const rowBookName = pickFirstNonEmpty(r, ['book_name', '書名', '選擇訂閱書本']);
    const mappedId = rowBookName ? String(nameToId.get(rowBookName) || '').trim() : '';
    if (mappedId) set.add(mappedId);
  }
  return set;
}

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

function formatRagicDateTimeTaipei(d) {
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
  return s.replace(/-/g, '/');
}

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
    [ids.line_user_id]: String(payload.line_user_id || ''),
    [ids.user_email]: String(payload.user_email || ''),
    [ids.book_id]: String(payload.book_id ?? ''),
    [ids.book_name]: String(payload.book_name ?? ''),
    [ids.reading_day]: payload.reading_day != null ? Number(payload.reading_day) : '',
    [ids.read_time]: readTimeStr,
  };
  if (ids.line_display_name) {
    const v = String(payload.line_display_name || '').trim();
    if (v) body[ids.line_display_name] = v;
  }
  if (ids.user_name) body[ids.user_name] = String(payload.user_name ?? '');
  if (ids.church) body[ids.church] = String(payload.church ?? '');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Ragic 寫入閱讀紀錄錯誤 ${res.status}`);
  }
  return res.json();
}

async function getLastReadingDayByLineUserIdAndBook(lineUserId, bookId) {
  const data = await ragicGet(RAGIC_SHEETS.READING_RECORD);
  const rows = rowsToArray(data);
  const u = String(lineUserId || '').trim();
  const book = String(bookId || '');
  let maxDay = null;
  for (const r of rows) {
    if (String(r.line_user_id || '').trim() !== u) continue;
    if (String(r.book_id || '') !== book) continue;
    const d = Number(r.reading_day);
    if (!Number.isFinite(d)) continue;
    if (maxDay == null || d > maxDay) maxDay = d;
  }
  return maxDay;
}

module.exports = {
  RAGIC_SHEETS,
  ragicGet,
  rowsToArray,
  getBookList,
  getContentByBookAndDay,
  checkSubscriptionByLineUserId,
  getActiveSubscribedBookIdsByLineUserId,
  getSubscriptionUserInfoByLineUserId,
  createReadingRecord,
  getLastReadingDayByLineUserIdAndBook,
  normalizeReadTime,
  formatRagicDateTimeTaipei,
};

