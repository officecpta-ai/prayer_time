const { getConfig } = require('./config');

const RAGIC_SHEETS = {
  BOOK_LIST: 'gpt/5',
  CONTENT: 'gpt/3',
  WIX_SUBSCRIPTION: 'gpt/9',
  READING_RECORD: 'gpt/7',
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

/**
 * Ragic 在認證／權限／參數錯誤時常回 { status, msg, code }，與「列 ID 為 key」的正常資料不同
 */
function isRagicApiMessageEnvelope(data) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  if (keys.some((k) => /^\d+$/.test(k))) return false;
  return keys.includes('msg') && (keys.includes('status') || keys.includes('code'));
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
  const data = await res.json();
  if (isRagicApiMessageEnvelope(data)) {
    const msg = String(data.msg ?? '');
    const st = String(data.status ?? '');
    const code = data.code != null ? String(data.code) : 'n/a';
    throw new Error(
      `Ragic API 未回傳表列資料（${st}）：${msg}（code ${code}）。若金鑰與權限正確仍為 guest：本專案預設與 Cloud Run 相同為「Basic + 金鑰字面」（勿設 RAGIC_BASIC_RAW=false 除非確定要 Base64）；亦可改試 RAGIC_API_KEY_IN_QUERY=true。瀏覽器開 ?api=true 僅代表登入後可讀，與程式帶 API Key 不同。`
    );
  }
  return data;
}

/**
 * 將 Ragic 回傳的 {"列ID": {...}} 轉成陣列
 * 亦處理：頂層為陣列、或包在 data / records / result 內
 */
function rowsToArray(obj) {
  if (obj == null) return [];
  if (Array.isArray(obj)) {
    return obj.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }
  if (typeof obj !== 'object') return [];
  if (Array.isArray(obj.data)) {
    return obj.data.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }
  if (obj.data != null && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    return rowsToArray(obj.data);
  }
  if (Array.isArray(obj.records)) {
    return obj.records.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }
  if (Array.isArray(obj.result)) {
    return obj.result.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }
  return Object.values(obj).filter(
    (row) => row && typeof row === 'object' && !Array.isArray(row)
  );
}

const CONTENT_NAME_KEYS = {
  book_id: ['book_id', 'bookId', 'Book_ID'],
  book_name: ['book_name', 'bookName', 'Book_name'],
  day: ['day', 'Day'],
  title: ['title', 'Title'],
  content: ['content', 'Content'],
};

/**
 * 從 gpt/3 列讀欄位：先試欄位名稱別名，再試 RAGIC_CONTENT_FIELD_* 數字 ID
 */
function getContentSheetField(row, fieldName) {
  if (!row || typeof row !== 'object') return '';
  const { contentSheetFieldIds } = getConfig();
  const keys = CONTENT_NAME_KEYS[fieldName] || [fieldName];
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  const id = contentSheetFieldIds[fieldName];
  if (id && row[id] !== undefined && row[id] !== null && String(row[id]).trim() !== '') {
    return row[id];
  }
  return '';
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
  const match = rows.find((r) => {
    const d = Number(getContentSheetField(r, 'day'));
    const bid = normId(getContentSheetField(r, 'book_id'));
    return d === targetDay && bid === normId(bookId);
  });
  return match || null;
}

/** Wix 訂閱表（gpt/9）欄位別名 */
const WIX_ALT_KEYS = {
  name: ['name', 'Name'],
  email: ['email', 'Email'],
  mobile: ['mobile', 'Mobile'],
  course_name: ['course_name', 'courseName'],
  price_amount: ['price_amount', 'priceAmount'],
  start_date: ['start_date', 'startDate', 'plan_start_date'],
  end_date: ['end_date', 'endDate', 'plan_end_date'],
  orderNumbe: ['orderNumbe', 'orderNumber'],
  ticketNumber: ['ticketNumber', 'ticket_number'],
};

/** 從 Wix 訂閱列取欄位值 */
function getWixField(row, fieldName, ids) {
  if (!row || typeof row !== 'object') return '';
  const keysToTry = WIX_ALT_KEYS[fieldName] ? [fieldName, ...WIX_ALT_KEYS[fieldName]] : [fieldName];
  for (const k of keysToTry) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  const id = ids && ids[fieldName];
  if (id && row[id] !== undefined && row[id] !== null) return String(row[id]);
  return '';
}

/** 將 Ragic 日期字串轉成 YYYY-MM-DD 比較用 */
function parseDateToYmd(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

/** 以台北時區取得今天日期（YYYY-MM-DD） */
function getTodayYmdInTaipei() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

/** 檢查 Wix 訂閱是否在有效期間內（today >= start_date AND today <= end_date） */
function isWixSubscriptionInRange(row, ids) {
  const startStr = getWixField(row, 'start_date', ids);
  const endStr = getWixField(row, 'end_date', ids);
  const start = parseDateToYmd(startStr);
  const end = parseDateToYmd(endStr);
  const todayStr = getTodayYmdInTaipei();
  if (start && todayStr < start) return false;
  if (end && todayStr > end) return false;
  return true;
}

/** 取得 Wix 訂閱表中有效訂閱列（email 匹配且 within 起訖日） */
function getValidWixRows(rows, userEmail, ids) {
  const email = String(userEmail || '').toLowerCase().trim();
  return rows.filter((r) => {
    const rEmail = getWixField(r, 'email', ids);
    return rEmail.toLowerCase().trim() === email && isWixSubscriptionInRange(r, ids);
  });
}

/**
 * 檢查是否已訂閱（Wix gpt/9：email + start_date <= today <= end_date）
 * Wix 無 book_id，有效訂閱即享有全部手冊
 */
async function checkSubscription(userEmail, bookId) {
  const { wixSubscriptionFieldIds } = getConfig();
  const data = await ragicGet(RAGIC_SHEETS.WIX_SUBSCRIPTION);
  const rows = rowsToArray(data);
  const valid = getValidWixRows(rows, userEmail, wixSubscriptionFieldIds);
  return valid.length > 0;
}

/**
 * 檢查使用者是否有任一有效訂閱（Wix：email + 起訖日內）
 */
async function hasAnySubscription(userEmail) {
  const { wixSubscriptionFieldIds } = getConfig();
  const data = await ragicGet(RAGIC_SHEETS.WIX_SUBSCRIPTION);
  const rows = rowsToArray(data);
  const valid = getValidWixRows(rows, userEmail, wixSubscriptionFieldIds);
  return valid.length > 0;
}

/**
 * 依 email 回傳該使用者已訂閱的書單（Wix 有效訂閱即享有全部手冊），並從訂閱表取姓名
 * @returns {Promise<{ books: Array<{ book_id: string, book_name: string }>, user_name: string|null }>}
 */
async function getSubscribedBooksByEmail(userEmail) {
  const { wixSubscriptionFieldIds } = getConfig();
  const [subData, bookList] = await Promise.all([
    ragicGet(RAGIC_SHEETS.WIX_SUBSCRIPTION),
    ragicGet(RAGIC_SHEETS.BOOK_LIST),
  ]);
  const subRows = rowsToArray(subData);
  const books = rowsToArray(bookList);
  const valid = getValidWixRows(subRows, userEmail, wixSubscriptionFieldIds);
  if (valid.length === 0) return { books: [], user_name: null };
  const first = valid[0];
  const name = getWixField(first, 'name', wixSubscriptionFieldIds).trim();
  const user_name = name || null;
  const out = books
    .filter((b) => b.book_id != null)
    .map((b) => ({ book_id: String(b.book_id), book_name: String(b.book_name || '') }))
    .sort((a, b) => {
      const aId = String(a.book_id || '').trim();
      const bId = String(b.book_id || '').trim();
      const aNum = Number(aId);
      const bNum = Number(bId);
      const aIsNum = Number.isFinite(aNum);
      const bIsNum = Number.isFinite(bNum);
      if (aIsNum && bIsNum) return aNum - bNum;
      if (aIsNum) return -1;
      if (bIsNum) return 1;
      return aId.localeCompare(bId, 'zh-Hant', { numeric: true, sensitivity: 'base' });
    });
  return { books: out, user_name };
}

/**
 * 依 email 從 Wix 訂閱表取得該使用者姓名
 * @returns {Promise<{ user_name: string|null, church: string|null }>}
 */
async function getSubscriptionUserInfo(userEmail) {
  const { wixSubscriptionFieldIds } = getConfig();
  const data = await ragicGet(RAGIC_SHEETS.WIX_SUBSCRIPTION);
  const rows = rowsToArray(data);
  const valid = getValidWixRows(rows, userEmail, wixSubscriptionFieldIds);
  if (valid.length === 0) return { user_name: null, church: null };
  const first = valid[0];
  const user_name = getWixField(first, 'name', wixSubscriptionFieldIds).trim() || null;
  return { user_name, church: null };
}

/**
 * 依 email 從 Wix 訂閱表取得該使用者姓名
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
    const rowBookId = String(getContentSheetField(r, 'book_id') ?? '').trim();
    if (rowBookId !== wantId) continue;
    const d = Number(getContentSheetField(r, 'day'));
    if (!Number.isFinite(d)) continue;
    if (d < 1 || d > 31) continue;
    const bn = getContentSheetField(r, 'book_name');
    if (!bookName && bn) bookName = String(bn);
    const tit = getContentSheetField(r, 'title');
    if (!map.has(d) && tit != null && String(tit).trim() !== '') {
      map.set(d, String(tit));
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
  getContentSheetField,
  getBookList,
  getContentByBookAndDay,
  checkSubscription,
  hasAnySubscription,
  getSubscribedBooksByEmail,
  getSubscriptionUserName,
  getSubscriptionUserInfo,
  getProgressByEmail,
  createReadingRecord,
  getLastReadingDayByEmailAndBook,
  getBookDayTitles,
  RAGIC_SHEETS,
};
