require('dotenv').config();

const express = require('express');
const { getConfig } = require('./config');
const { validateLineSignature, lineReplyText, getLineDisplayName } = require('./line');
const { normalizeLineBreaks, base64urlEncode, base64urlDecodeToString, sanitizeContent } = require('./utils');
const {
  getBookList,
  getContentByBookAndDay,
  checkSubscriptionByLineUserId,
  getActiveSubscribedBookIdsByLineUserId,
  getLastReadingDayByLineUserIdAndBook,
  getSubscriptionUserInfoByLineUserId,
  createReadingRecord,
} = require('./ragic');
const { buildViewUrl, verifyViewLink } = require('./view');
const { createStateStore } = require('./state');
const { createTtlDedupe } = require('./dedupe');
const { getFirestore } = require('./firestore');
const { openaiEmbed, l2Normalize, openaiQaAnswer } = require('./openai');
const { vertexFindNeighbors } = require('./vertex');

const app = express();
app.set('trust proxy', true);

// 供 LINE Webhook 驗簽使用：保留 raw body
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

const state = createStateStore({ ttlMs: 15 * 60 * 1000 });
const dedupe = createTtlDedupe({ ttlMs: 5 * 60 * 1000 });
const displayNameCache = createStateStore({ ttlMs: 24 * 60 * 60 * 1000 });
const chunkCache = createStateStore({ ttlMs: 10 * 60 * 1000 });
const booksCache = createStateStore({ ttlMs: 10 * 60 * 1000 });

function msLeft(deadlineAtMs) {
  const n = Number(deadlineAtMs);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n - Date.now());
}

function buildQaFailText(err) {
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('qa_deadline') || msg.includes('timeout') || msg.includes('aborted')) {
    return '⏳ 回覆逾時（10 秒內未完成），請再試一次。';
  }
  return '⚠️ 目前系統忙碌或設定未完成，請稍後再試。';
}

function normalizeBookNameForDisplay(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (s === '十誡與屬靈爭戰') return '十誡';
  return s;
}

function normalizeBookNameForMatch(name) {
  // 用於比對：去除《》與空白；十誡長名/短名視為同一
  const s = normalizeBookNameForDisplay(name).replace(/[《》\s]/g, '').trim();
  return s;
}

function getBaseUrlFromReq(req) {
  const { publicBaseUrl } = getConfig();
  if (publicBaseUrl) return publicBaseUrl;
  return `${req.protocol}://${req.get('host')}`;
}

/** 是否為「要看書單」的意圖（任何狀態下都應回傳書單選項） */
function isBookListIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t === '/books' || t.toLowerCase() === 'books') return true;
  // 書單：允許前後空白、標點（？。.）、或句中含「書單」的短句
  const normalized = t.replace(/[\s　]+/g, '').replace(/[？?。.、,，]+/g, '');
  if (normalized === '書單') return true;
  if (t.length <= 25 && /書單/.test(t)) return true;
  return false;
}

function looksLikeQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.startsWith('/')) return false;
  // 純數字通常是選書/選天
  if (/^\d{1,2}$/.test(t)) return false;
  if (t.length < 2) return false;
  if (/[？?]/.test(t)) return true;
  // 常見中文提問起手式/疑問詞
  if (/(為什麼|為何|怎麼|如何|什麼|甚麼|請問|可以嗎|可不可以|是否)/.test(t)) return true;
  return false;
}

function buildQuestionRedirectText() {
  return '抱歉，詢問禱告時光相關問題，麻煩請前往「禱告時光小幫手」https://chatgpt.com/g/g-6986dfabed5081919af0ef95e2de4696-dao-gao-shi-guang-xiao-bang-shou ，小幫手會協助您，謝謝您！';
}

function buildShortSubscribeUrl({ baseUrl, lineUserId }) {
  const b = String(baseUrl || '').replace(/\/$/, '');
  const u = String(lineUserId || '').trim();
  if (!b || !u) return '';
  return `${b}/sub?u=${encodeURIComponent(base64urlEncode(u))}`;
}

async function getCachedBooks() {
  const cached = booksCache.get('_books');
  if (Array.isArray(cached) && cached.length) return cached;
  const books = await getBookList();
  const mapped = books.map((b) => ({
    book_id: String(b.book_id || '').trim(),
    book_name: normalizeBookNameForDisplay(String(b.book_name || '').trim()),
  }));
  booksCache.set('_books', mapped);
  return mapped;
}

function parseDayFromText(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  // Helper: convert Chinese numerals (一二三...十) up to 99
  function chineseNumberToInt(s) {
    if (!s) return NaN;
    const map = { 零:0, 〇:0, 一:1, 二:2, 兩:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
    s = String(s || '').replace(/\s+/g, '');
    // replace full-width digits to ascii
    s = s.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xFF10));
    // if contains ascii digits, parse directly
    if (/^\d+$/.test(s)) return Number(s);
    // normalize common variant
    s = s.replace(/两/g, '二').replace(/兩/g, '二');
    // handle tens like 十, 二十, 二十三, 十三
    if (s.includes('十')) {
      const parts = s.split('十');
      const left = parts[0];
      const right = parts[1];
      const leftVal = left === '' ? 1 : (map[left] ?? NaN);
      const rightVal = right === '' ? 0 : (map[right] ?? NaN);
      if (Number.isFinite(leftVal) && Number.isFinite(rightVal)) {
        return leftVal * 10 + rightVal;
      }
    }
    // single-character chinese digit
    if (s.length === 1 && map[s] != null) return map[s];
    // attempt to parse two-char like 二三 (treat as concatenation)
    if (s.length <= 2 && [...s].every((ch) => map[ch] != null)) {
      return Number([...s].map((ch) => map[ch]).join(''));
    }
    return NaN;
  }

  // priority: match "第X天" where X can be arabic or chinese numerals
  const m1 = t.match(/第\s*([0-9０-９一二三四五六七八九十兩两零〇]+)\s*天/);
  if (m1 && m1[1]) {
    const raw = m1[1];
    const n1 = chineseNumberToInt(raw);
    if (Number.isInteger(n1) && n1 >= 1 && n1 <= 31) return n1;
  }
  // fallback: match "書名 X天" or "X天" with arabic digits
  const m2 = t.match(/([0-9０-９]+)\s*天/);
  if (m2 && m2[1]) {
    const digits = m2[1].replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xFF10));
    const n2 = Number(digits);
    if (Number.isInteger(n2) && n2 >= 1 && n2 <= 31) return n2;
  }
  // fallback: match chinese digits like "第X天" without the 第...pattern already tried, try standalone chinese numeral + 天
  const m3 = t.match(/([一二三四五六七八九十兩两零〇]+)\s*天/);
  if (m3 && m3[1]) {
    const n3 = chineseNumberToInt(m3[1]);
    if (Number.isInteger(n3) && n3 >= 1 && n3 <= 31) return n3;
  }
  return null;
}

function findBookFromText(text, books) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // 1) 若有《書名》，優先以其為候選
  const bracket = raw.match(/《([^》]{1,30})》/);
  const hinted = bracket?.[1] ? String(bracket[1]).trim() : '';
  if (hinted) {
    const hn = normalizeBookNameForMatch(hinted);
    const exact = books.find((b) => normalizeBookNameForMatch(b.book_name) === hn);
    if (exact) return exact;
  }

  // 2) 以包含比對，取最長匹配（避免短名誤撞）
  const rawN = normalizeBookNameForMatch(raw);
  let best = null;
  let bestLen = 0;
  for (const b of books) {
    const bn = normalizeBookNameForMatch(b.book_name);
    if (!bn) continue;
    if (rawN.includes(bn) && bn.length > bestLen) {
      best = b;
      bestLen = bn.length;
    }
  }
  return best;
}

function looksLikeReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.startsWith('/')) return false;
  // 常見「我要讀/想讀/讀…第X天」
  if (/(我要讀|我想讀|想讀|要讀|讀).*(第?\s*\d{1,2}\s*天)/.test(t)) return true;
  // 只要同時包含「天」與任一書名符號《》也算
  if (/天/.test(t) && /《/.test(t)) return true;
  return false;
}

function splitBooksBySubscription(books, subscribedBookIds) {
  const subscribed = [];
  const unsubscribed = [];
  for (const b of books || []) {
    const bookId = String(b.book_id || '').trim();
    if (bookId && subscribedBookIds?.has(bookId)) subscribed.push(b);
    else unsubscribed.push(b);
  }
  return { subscribed, unsubscribed };
}

function buildSubscriptionUrlForLineUserId(lineUserId) {
  const { ragicSubscribeFormUrl, subscriptionFieldIds } = getConfig();
  const base = String(ragicSubscribeFormUrl || '').trim();
  if (!base) return '';
  const u = String(lineUserId || '').trim();
  if (!u) return base;

  // 用 Ragic 的 pfv[field_id]=value 來預填 line_user_id（欄位 ID：1011767）
  // 參考：https://www.ragic.com/intl/en/doc-kb/343/auto-fill-specific-fields-with-predefined-values-in-embedded-database-form
  const fieldId = String(subscriptionFieldIds?.line_user_id || '1011767').trim();
  try {
    const url = new URL(base);
    // 兼容：文件範例使用 pfv<fieldId>=...；也有人用 pfv[<fieldId>]=...
    url.searchParams.set(`pfv${fieldId}`, u);
    url.searchParams.set(`pfv[${fieldId}]`, u);
    return url.toString();
  } catch {
    // fallback：base 不是標準 URL 時就直接拼接（盡量不出錯）
    const sep = base.includes('?') ? '&' : '?';
    return [
      `${base}${sep}${encodeURIComponent(`pfv${fieldId}`)}=${encodeURIComponent(u)}`,
      `&${encodeURIComponent(`pfv[${fieldId}]`)}=${encodeURIComponent(u)}`,
    ].join('');
  }
}

function buildBooksMenuText(books, { subscribedBookIds, askForNumber = true, lineUserId = '', baseUrl = '' } = {}) {
  const { subscribed, unsubscribed } = splitBooksBySubscription(books, subscribedBookIds);
  const lines = ['📚 您想閱讀哪一本書？'];

  // 只有已訂閱的書才編號（供使用者回覆數字選書）
  subscribed.forEach((b, idx) => {
    const name = normalizeBookNameForDisplay(b.book_name) || String(b.book_id || '').trim() || `#${idx + 1}`;
    lines.push(`${idx + 1}. ${name}`);
  });

  // 空行（注意：依需求保持空行）
  lines.push('');

  if (unsubscribed.length > 0) {
    const names = unsubscribed
      .map((b) => normalizeBookNameForDisplay(b.book_name) || String(b.book_id || '').trim())
      .filter(Boolean);
    if (names.length) lines.push(`您可訂閱：${names.join('、')}`);
  } else {
    // 若全部已訂閱，這行就不顯示（保留空行即可）
  }

  // 只有尚有未訂閱手冊時才顯示訂閱連結；全部已訂閱則不顯示
  if (unsubscribed.length > 0) {
    lines.push('');
    const subUrl = buildShortSubscribeUrl({ baseUrl, lineUserId }) || buildSubscriptionUrlForLineUserId(lineUserId);
    lines.push(`訂閱連結：${subUrl || '連結候補'}`);
  }
  return lines.join('\n');
}

function formatBookNameQuoted(name) {
  const bn = normalizeBookNameForDisplay(name);
  if (!bn) return '';
  if (bn.startsWith('《') && bn.endsWith('》')) return bn;
  return `《${bn}》`;
}

function buildNotSubscribedText(bookName) {
  const bn = formatBookNameQuoted(bookName);
  if (bn) return `🔒 很抱歉，您尚未訂閱${bn}！`;
  return '🔒 很抱歉，您尚未訂閱禱告時光！';
}

function buildAskDayText({ lastDay, bookName }) {
  const bn = formatBookNameQuoted(bookName);
  if (lastDay == null) {
    return ['🗓️ 此手冊尚無閱讀紀錄。', '👉 請問您現在要讀哪一天？直接回答數字即可。（1–31）'].join('\n');
  }
  if (bn) {
    return [`📖 您上次閱讀到${bn}第 ${lastDay} 天。`, '👉 請問您現在要讀哪一天？直接回答數字即可。（1–31）'].join('\n');
  }
  return [`📖 您上次閱讀到第 ${lastDay} 天。`, '👉 請問您現在要讀哪一天？直接回答數字即可。（1–31）'].join('\n');
}

function parseDay(text) {
  const n = Number(String(text || '').trim());
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 31) return null;
  return n;
}

function pickBookFromState({ inputText, books }) {
  const t = String(inputText || '').trim();
  if (!t) return null;
  const asNum = Number(t);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= books.length) {
    return books[asNum - 1];
  }
  // 書名比對（完全相等優先；否則包含）
  const exact = books.find((b) => String(b.book_name || '').trim() === t);
  if (exact) return exact;
  const contains = books.find((b) => String(b.book_name || '').trim().includes(t));
  if (contains) return contains;
  return null;
}

function stripDuplicatedTitleFromContent({ title, content }) {
  const tRaw = String(title || '').trim();
  const cRaw = String(content || '');
  if (!tRaw || !cRaw) return cRaw;

  const lines = cRaw.split('\n');
  if (lines.length === 0) return cRaw;

  // content 第一行常與 title 重複（或幾乎相同）；若重複則略過第一行，避免標題出現兩次
  const first = String(lines[0] || '').trim();
  if (!first) return cRaw;

  const normalize = (s) => String(s || '').trim().replace(/\s+/g, '').replace(/[：:]/g, '');
  if (normalize(first) === normalize(tRaw)) {
    return lines.slice(1).join('\n').replace(/^\n+/, '');
  }
  return cRaw;
}

function buildDisplayText({ bookName, title, content }) {
  const bn = String(bookName || '').trim();
  const t = String(title || '').trim();
  const c = String(content || '');
  const body = stripDuplicatedTitleFromContent({ title: t, content: c }).trim();
  if (bn && t && body) return `${formatBookNameQuoted(bn)}\n\n${t}\n\n${body}`;
  if (t && body) return `${t}\n\n${body}`;
  return [bn, t, body].filter(Boolean).join('\n');
}

async function answerQuestionWithRag({ question, bookIdHint }) {
  // 目標：10 秒內完成；只使用「整體 deadline」避免過早中止
  const deadlineMs = Number(process.env.QA_DEADLINE_MS || 10000);
  const deadlineAtMs = Date.now() + deadlineMs;
  const bufferMs = 200; // 留一點點緩衝給 JSON/回覆
  const budget = () => Math.max(0, msLeft(deadlineAtMs) - bufferMs);

  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(new Error('qa_deadline')), Math.max(0, deadlineMs - bufferMs));

  const t0 = Date.now();
  let t1 = t0;
  let t2 = t0;
  let t3 = t0;
  let t4 = t0;

  try {
    // 1) embed question
    const qVec = l2Normalize(await openaiEmbed(question, { timeoutMs: budget(), signal: ac.signal }));
    t1 = Date.now();

    // 2) vector search
    const neighbors = await vertexFindNeighbors({
      queryVector: qVec,
      neighborCount: 4,
      timeoutMs: budget(),
      signal: ac.signal,
    });
    const ids = neighbors.map((n) => n.id).slice(0, 4);
    if (!ids.length) return null;
    t2 = Date.now();

    // 3) load chunk docs (Firestore 無原生 abort；用快取減少讀取次數)
    const db = getFirestore();
    const colName = process.env.FIRESTORE_CHUNKS_COLLECTION || 'prayer_time_chunks';
    const col = db.collection(colName);
    const cachedDocs = [];
    const missingIds = [];
    for (const id of ids) {
      const c = chunkCache.get(id);
      if (c) cachedDocs.push({ id, data: c });
      else missingIds.push(id);
    }
    let fetchedDocs = [];
    if (missingIds.length) {
      const refs = missingIds.map((id) => col.doc(id));
      const snaps = await db.getAll(...refs);
      fetchedDocs = snaps
        .filter((s) => s.exists)
        .map((s) => ({ id: s.id, data: s.data() }));
      for (const d of fetchedDocs) chunkCache.set(d.id, d.data);
    }
    const allDocs = [...cachedDocs, ...fetchedDocs].map((x) => x.data);

    const contexts = allDocs
      .filter(Boolean)
      .map((d) => ({
        book_id: d.book_id,
        book_name: d.book_name,
        day: d.day,
        chunk_index: d.chunk_index,
        text: d.text,
      }))
      // 若有 bookIdHint，優先同一本
      .sort((a, b) => {
        if (bookIdHint) {
          const aa = a.book_id === bookIdHint ? 0 : 1;
          const bb = b.book_id === bookIdHint ? 0 : 1;
          if (aa !== bb) return aa - bb;
        }
        return (a.day || 0) - (b.day || 0);
      })
      .slice(0, 4);

    if (!contexts.length) return null;
    t3 = Date.now();

    // 4) LLM answer
    const answer = await openaiQaAnswer({
      question,
      contexts,
      timeoutMs: budget(),
      signal: ac.signal,
      maxOutputTokens: 350,
    });
    t4 = Date.now();
    return answer;
  } finally {
    clearTimeout(kill);
    const now = Date.now();
    // 不記錄使用者問題內容，只記錄耗時
    console.log(
      JSON.stringify({
        qa_timing_ms: {
          embed: Math.max(0, t1 - t0),
          vertex: Math.max(0, t2 - t1),
          firestore: Math.max(0, t3 - t2),
          openai: Math.max(0, (t4 || now) - t3),
          total: Math.max(0, (t4 || now) - t0),
        },
      })
    );
  }
}

async function writeReadingRecordOnce({ lineUserId, bookId, bookName, day }) {
  const key = `${lineUserId}|${bookId}|${day}`;
  if (dedupe.seenRecently(key)) return { skipped: true };
  let displayName = displayNameCache.get(lineUserId);
  if (!displayName) {
    displayName = await getLineDisplayName(lineUserId);
    if (displayName) displayNameCache.set(lineUserId, displayName);
  }
  const userInfo = await getSubscriptionUserInfoByLineUserId(lineUserId);
  await createReadingRecord({
    line_user_id: lineUserId,
    line_display_name: displayName || '',
    user_email: '',
    book_id: bookId,
    book_name: normalizeBookNameForDisplay(bookName) || '',
    reading_day: day,
    user_name: userInfo.user_name ?? '',
    church: userInfo.church ?? '',
  });
  return { skipped: false };
}

app.get('/', (req, res) => {
  res.json({ service: 'prayer-time-line-api', status: 'ok' });
});

// 方便本機檢查 Ragic 是否正常（非必要）
app.get('/books', async (req, res) => {
  try {
    const books = await getBookList();
    res.json({ books: books.map((b) => ({ book_id: b.book_id, book_name: b.book_name })) });
  } catch {
    res.status(500).json({ error: 'books unavailable' });
  }
});

// 短連結：LINE 點此後 302 轉到 Ragic 訂閱表單並預填 UID
app.get('/sub', (req, res) => {
  try {
    const { ragicSubscribeFormUrl, subscriptionFieldIds } = getConfig();
    const base = String(ragicSubscribeFormUrl || '').trim();
    if (!base) return res.status(500).send('⚠️ 服務設定未完成');

    const u = String(req.query.u || '').trim();
    if (!u) return res.status(400).send('⚠️ 連結格式不正確');

    const lineUserId = base64urlDecodeToString(u);
    if (!lineUserId) return res.status(400).send('⚠️ 連結格式不正確');

    const fieldId = String(subscriptionFieldIds?.line_user_id || '1011767').trim();
    const url = new URL(base);
    // 兼容：文件範例使用 pfv<fieldId>=...；也有人用 pfv[<fieldId>]=...
    url.searchParams.set(`pfv${fieldId}`, String(lineUserId));
    url.searchParams.set(`pfv[${fieldId}]`, String(lineUserId));

    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, url.toString());
  } catch {
    return res.status(400).send('⚠️ 連結格式不正確');
  }
});

app.post('/line/webhook', async (req, res) => {
  const signature = req.get('X-Line-Signature') || '';
  const rawBody = req.rawBody;
  if (!validateLineSignature({ rawBody, signatureBase64: signature })) {
    return res.status(403).send('Forbidden');
  }

  // 盡快回 200，避免 LINE 重送；但我們仍需用 replyToken 回覆。
  res.status(200).send('OK');

  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events : [];
  const event = events[0];
  if (!event) return;

  try {
    if (event.type !== 'message') return;
    if (!event.message || event.message.type !== 'text') return;
    if (!event.source || event.source.type !== 'user') return;

    const lineUserId = String(event.source.userId || '').trim();
    const replyToken = String(event.replyToken || '').trim();
    const text = String(event.message.text || '').trim();
    if (!lineUserId || !replyToken) return;

    // commands：書單、/books 都顯示書單選項（優先於狀態機）
    if (isBookListIntent(text)) {
      const baseUrl = getBaseUrlFromReq(req);
      const mapped = await getCachedBooks();
      const subscribedBookIds = await getActiveSubscribedBookIdsByLineUserId(lineUserId);
      if (mapped.length === 1) {
        const only = mapped[0];
        const isSub = subscribedBookIds.has(String(only.book_id || '').trim());
        if (!isSub) {
          state.clear(lineUserId);
          await lineReplyText({ replyToken, text: `${buildNotSubscribedText(only.book_name || '')}\n🔗 訂閱連結：${buildShortSubscribeUrl({ baseUrl, lineUserId }) || buildSubscriptionUrlForLineUserId(lineUserId) || '連結候補'}` });
          return;
        }
        const lastDay = await getLastReadingDayByLineUserIdAndBook(lineUserId, only.book_id);
        state.set(lineUserId, { step: 'choose_day', book_id: only.book_id, book_name: only.book_name || '' });
        const menu = buildBooksMenuText(mapped, { subscribedBookIds, askForNumber: false, lineUserId, baseUrl });
        const askDay = buildAskDayText({ lastDay, bookName: only.book_name || '' });
        await lineReplyText({ replyToken, text: `${menu}\n\n${askDay}` });
        return;
      }
      state.set(lineUserId, { step: 'choose_book', books: mapped, subscribed_book_ids: Array.from(subscribedBookIds) });
      await lineReplyText({ replyToken, text: buildBooksMenuText(mapped, { subscribedBookIds, lineUserId, baseUrl }) });
      return;
    }

    // 直接短句「書名第N天」也要能命中：例如「十誡第一天」「主禱文2天」
    try {
      const baseUrlQuick = getBaseUrlFromReq(req);
      const allBooksQuick = await getCachedBooks();
      const dayQuick = parseDayFromText(text);
      const pickedQuick = findBookFromText(text, allBooksQuick);
      if (pickedQuick && dayQuick) {
        const subscribedQuick = await checkSubscriptionByLineUserId(lineUserId, pickedQuick.book_id);
        if (!subscribedQuick) {
          state.clear(lineUserId);
          await lineReplyText({
            replyToken,
            text: `${buildNotSubscribedText(pickedQuick.book_name || '')}\n訂閱連結：${
              buildShortSubscribeUrl({ baseUrl: baseUrlQuick, lineUserId }) || buildSubscriptionUrlForLineUserId(lineUserId) || '連結候補'
            }`,
          });
          return;
        }

        const contentRowQuick = await getContentByBookAndDay(pickedQuick.book_id, dayQuick);
        if (!contentRowQuick) {
          state.clear(lineUserId);
          await lineReplyText({ replyToken, text: '⚠️ 很抱歉，找不到該日內容。' });
          return;
        }

        const titleQuick = normalizeLineBreaks(sanitizeContent(contentRowQuick.title || ''));
        const contentQuick = normalizeLineBreaks(sanitizeContent(contentRowQuick.content || ''));
        const resolvedBookNameQuick = normalizeBookNameForDisplay(pickedQuick.book_name || contentRowQuick.book_name || '');
        const fullTextQuick = buildDisplayText({ bookName: resolvedBookNameQuick, title: titleQuick, content: contentQuick });

        const expQuick = Math.floor(Date.now() / 1000) + 15 * 60;
        const viewUrlQuick = buildViewUrl({ baseUrl: baseUrlQuick, lineUserId, bookId: pickedQuick.book_id, day: dayQuick, exp: expQuick });
        const viewTextQuick = `🔗 內容較長或回覆失敗時，請點此閱讀：\n${viewUrlQuick}`;

        if (fullTextQuick.length > 3000) {
          state.set(lineUserId, { step: 'qa', book_id: pickedQuick.book_id, book_name: resolvedBookNameQuick, day: dayQuick });
          await lineReplyText({ replyToken, text: viewTextQuick });
          return;
        }

        const rQuick = await lineReplyText({ replyToken, text: fullTextQuick });
        if (!rQuick.ok) {
          state.set(lineUserId, { step: 'qa', book_id: pickedQuick.book_id, book_name: resolvedBookNameQuick, day: dayQuick });
          await lineReplyText({ replyToken, text: viewTextQuick });
          return;
        }

        await writeReadingRecordOnce({ lineUserId, bookId: pickedQuick.book_id, bookName: resolvedBookNameQuick, day: dayQuick });
        state.set(lineUserId, { step: 'qa', book_id: pickedQuick.book_id, book_name: resolvedBookNameQuick, day: dayQuick });
        return;
      }
    } catch (e) {
      // ignore quick-match errors and continue normal flow
    }

    // 使用者直接說「要讀某書第幾天」：直接回內容（除非書不存在）
    if (looksLikeReadIntent(text)) {
      const baseUrl = getBaseUrlFromReq(req);
      const books = await getCachedBooks();
      const day = parseDayFromText(text);
      const picked = findBookFromText(text, books);
      if (picked && day) {
        const subscribed = await checkSubscriptionByLineUserId(lineUserId, picked.book_id);
        if (!subscribed) {
          state.clear(lineUserId);
          await lineReplyText({
            replyToken,
            text: `${buildNotSubscribedText(picked.book_name || '')}\n訂閱連結：${
              buildShortSubscribeUrl({ baseUrl, lineUserId }) || buildSubscriptionUrlForLineUserId(lineUserId) || '連結候補'
            }`,
          });
          return;
        }

        const contentRow = await getContentByBookAndDay(picked.book_id, day);
        if (!contentRow) {
          state.clear(lineUserId);
          await lineReplyText({ replyToken, text: '⚠️ 很抱歉，找不到該日內容。' });
          return;
        }

        const title = normalizeLineBreaks(sanitizeContent(contentRow.title || ''));
        const content = normalizeLineBreaks(sanitizeContent(contentRow.content || ''));
        const resolvedBookName = normalizeBookNameForDisplay(picked.book_name || contentRow.book_name || '');
        const fullText = buildDisplayText({ bookName: resolvedBookName, title, content });

        const exp = Math.floor(Date.now() / 1000) + 15 * 60;
        const viewUrl = buildViewUrl({ baseUrl, lineUserId, bookId: picked.book_id, day, exp });
        const viewText = `🔗 內容較長或回覆失敗時，請點此閱讀：\n${viewUrl}`;

        if (fullText.length > 3000) {
          state.set(lineUserId, { step: 'qa', book_id: picked.book_id, book_name: resolvedBookName, day });
          await lineReplyText({ replyToken, text: viewText });
          return;
        }

        const r = await lineReplyText({ replyToken, text: fullText });
        if (!r.ok) {
          state.set(lineUserId, { step: 'qa', book_id: picked.book_id, book_name: resolvedBookName, day });
          await lineReplyText({ replyToken, text: viewText });
          return;
        }

        await writeReadingRecordOnce({ lineUserId, bookId: picked.book_id, bookName: resolvedBookName, day });
        state.set(lineUserId, { step: 'qa', book_id: picked.book_id, book_name: resolvedBookName, day });
        return;
      }

      // 書不存在：才顯示書單
      if (!picked) {
        const subscribedBookIds = await getActiveSubscribedBookIdsByLineUserId(lineUserId);
        state.set(lineUserId, { step: 'choose_book', books, subscribed_book_ids: Array.from(subscribedBookIds) });
        await lineReplyText({ replyToken, text: buildBooksMenuText(books, { subscribedBookIds, lineUserId, baseUrl }) });
        return;
      }
      // 有書但沒解析到天數：交給原本流程（避免誤判）
    }

    // 使用者提問：改引導到「禱告時光小幫手」，不在此服務回答問題
    if (looksLikeQuestion(text)) {
      await lineReplyText({ replyToken, text: buildQuestionRedirectText() });
      return;
    }

    const s = state.get(lineUserId);

    // 任何狀態下只要使用者問書單，一律顯示書單選項（避免在 qa/choose_day 時誤回上次內容）
    if (isBookListIntent(text)) {
      state.clear(lineUserId);
      const baseUrl = getBaseUrlFromReq(req);
      const mapped = await getCachedBooks();
      const subscribedBookIds = await getActiveSubscribedBookIdsByLineUserId(lineUserId);
      if (mapped.length === 1) {
        const only = mapped[0];
        const isSub = subscribedBookIds.has(String(only.book_id || '').trim());
        if (!isSub) {
          await lineReplyText({ replyToken, text: `${buildNotSubscribedText(only.book_name || '')}\n🔗 訂閱連結：${buildShortSubscribeUrl({ baseUrl, lineUserId }) || buildSubscriptionUrlForLineUserId(lineUserId) || '連結候補'}` });
          return;
        }
        const lastDay = await getLastReadingDayByLineUserIdAndBook(lineUserId, only.book_id);
        state.set(lineUserId, { step: 'choose_day', book_id: only.book_id, book_name: only.book_name || '' });
        const menu = buildBooksMenuText(mapped, { subscribedBookIds, askForNumber: false, lineUserId, baseUrl });
        const askDay = buildAskDayText({ lastDay, bookName: only.book_name || '' });
        await lineReplyText({ replyToken, text: `${menu}\n\n${askDay}` });
        return;
      }
      state.set(lineUserId, { step: 'choose_book', books: mapped, subscribed_book_ids: Array.from(subscribedBookIds) });
      await lineReplyText({ replyToken, text: buildBooksMenuText(mapped, { subscribedBookIds, lineUserId, baseUrl }) });
      return;
    }

    if (!s || s.step === 'choose_book') {
      const baseUrl = getBaseUrlFromReq(req);
      const books = s?.books?.length ? s.books : await getCachedBooks();
      // 訂閱狀態可能在對話中途被更新（使用者剛去訂閱表單送出）
      // 為避免 state 內的快取造成誤判，這裡每次都即時重查一次。
      const subscribedBookIds = await getActiveSubscribedBookIdsByLineUserId(lineUserId);
      const { subscribed, unsubscribed } = splitBooksBySubscription(books, subscribedBookIds);
      if (books.length === 1) {
        const only = books[0];
        const isSub = subscribedBookIds.has(String(only.book_id || '').trim());
        if (!isSub) {
          state.clear(lineUserId);
          await lineReplyText({ replyToken, text: `${buildNotSubscribedText(only.book_name || '')}\n🔗 訂閱連結：${buildShortSubscribeUrl({ baseUrl, lineUserId }) || buildSubscriptionUrlForLineUserId(lineUserId) || '連結候補'}` });
          return;
        }
        const lastDay = await getLastReadingDayByLineUserIdAndBook(lineUserId, only.book_id);
        state.set(lineUserId, { step: 'choose_day', book_id: only.book_id, book_name: only.book_name || '' });
        const menu = buildBooksMenuText(books, { subscribedBookIds, askForNumber: false, lineUserId, baseUrl });
        const askDay = buildAskDayText({ lastDay, bookName: only.book_name || '' });
        await lineReplyText({ replyToken, text: `${menu}\n\n${askDay}` });
        return;
      }
      state.set(lineUserId, { step: 'choose_book', books, subscribed_book_ids: Array.from(subscribedBookIds) });

      // 只允許用編號選「已訂閱」；未訂閱若輸入書名則引導訂閱
      let picked = null;
      const t = String(text || '').trim();
      const asNum = Number(t);
      if (Number.isInteger(asNum) && asNum >= 1 && asNum <= subscribed.length) {
        picked = subscribed[asNum - 1];
      } else {
        picked = pickBookFromState({ inputText: t, books: subscribed });
        if (!picked) {
          const maybeUnsub = pickBookFromState({ inputText: t, books: unsubscribed });
          if (maybeUnsub) {
            await lineReplyText({
              replyToken,
              text: `${buildNotSubscribedText(maybeUnsub.book_name || '')}\n🔗 訂閱連結：${buildShortSubscribeUrl({ baseUrl, lineUserId }) || buildSubscriptionUrlForLineUserId(lineUserId) || '連結候補'}`,
            });
            return;
          }
        }
      }
      if (!picked) {
        await lineReplyText({ replyToken, text: buildBooksMenuText(books, { subscribedBookIds, lineUserId, baseUrl }) });
        return;
      }

      const lastDay = await getLastReadingDayByLineUserIdAndBook(lineUserId, picked.book_id);
      state.set(lineUserId, { step: 'choose_day', book_id: picked.book_id, book_name: picked.book_name || '' });
      await lineReplyText({ replyToken, text: buildAskDayText({ lastDay, bookName: picked.book_name || '' }) });
      return;
    }

    if (s.step === 'choose_day') {
      const day = parseDay(text);
      if (!day) {
        await lineReplyText({ replyToken, text: '⚠️ 請回覆 1–31 的天數（例如：1）。' });
        return;
      }

      const bookId = String(s.book_id || '');
      const bookName = String(s.book_name || '');

      const subscribed = await checkSubscriptionByLineUserId(lineUserId, bookId);
      if (!subscribed) {
        state.clear(lineUserId);
        await lineReplyText({ replyToken, text: buildNotSubscribedText(bookName) });
        return;
      }

      const contentRow = await getContentByBookAndDay(bookId, day);
      if (!contentRow) {
        state.clear(lineUserId);
        await lineReplyText({ replyToken, text: '⚠️ 很抱歉，找不到該日內容。' });
        return;
      }

      const title = normalizeLineBreaks(sanitizeContent(contentRow.title || ''));
      const content = normalizeLineBreaks(sanitizeContent(contentRow.content || ''));
      const resolvedBookName = normalizeBookNameForDisplay(bookName || contentRow.book_name || '');
      const fullText = buildDisplayText({ bookName: resolvedBookName, title, content });

      const baseUrl = getBaseUrlFromReq(req);
      const exp = Math.floor(Date.now() / 1000) + 15 * 60;
      const viewUrl = buildViewUrl({ baseUrl, lineUserId, bookId, day, exp });
      const viewText = `🔗 內容較長或回覆失敗時，請點此閱讀：\n${viewUrl}`;

      if (fullText.length > 3000) {
        state.clear(lineUserId);
        await lineReplyText({ replyToken, text: viewText });
        return;
      }

      // Try one text reply (no split)
      const r = await lineReplyText({ replyToken, text: fullText });
      if (r.ok) {
        // Option 1: reply 成功即寫閱讀紀錄（短時間去重）
        await writeReadingRecordOnce({ lineUserId, bookId, bookName: resolvedBookName, day });
        // 讀完後保留 QA 狀態，允許使用者提問（15 分鐘 TTL）
        state.set(lineUserId, { step: 'qa', book_id: bookId, book_name: resolvedBookName, day });
        return;
      }

      // Fallback to web view link
      state.set(lineUserId, { step: 'qa', book_id: bookId, book_name: resolvedBookName, day });
      await lineReplyText({ replyToken, text: viewText });
      return;
    }

    if (s.step === 'qa') {
      // 不回答問題：一律回傳上次閱讀的手冊內容
      const bookId = String(s.book_id || '').trim();
      const day = Number(s.day);
      const bookName = String(s.book_name || '').trim();

      if (!bookId || !Number.isInteger(day)) {
        // 沒有足夠狀態就回到選書流程
        state.clear(lineUserId);
        const baseUrl = getBaseUrlFromReq(req);
        const books = await getBookList();
        const mapped = books.map((b) => ({ book_id: b.book_id, book_name: b.book_name }));
        const subscribedBookIds = await getActiveSubscribedBookIdsByLineUserId(lineUserId);
        state.set(lineUserId, { step: 'choose_book', books: mapped, subscribed_book_ids: Array.from(subscribedBookIds) });
        await lineReplyText({ replyToken, text: buildBooksMenuText(mapped, { subscribedBookIds, lineUserId, baseUrl }) });
        return;
      }

      const subscribed = await checkSubscriptionByLineUserId(lineUserId, bookId);
      if (!subscribed) {
        state.clear(lineUserId);
        await lineReplyText({ replyToken, text: buildNotSubscribedText(bookName) });
        return;
      }

      const contentRow = await getContentByBookAndDay(bookId, day);
      if (!contentRow) {
        state.clear(lineUserId);
        await lineReplyText({ replyToken, text: '⚠️ 很抱歉，找不到該日內容。' });
        return;
      }

      const title = normalizeLineBreaks(sanitizeContent(contentRow.title || ''));
      const content = normalizeLineBreaks(sanitizeContent(contentRow.content || ''));
      const resolvedBookName = bookName || contentRow.book_name || '';
      const fullText = buildDisplayText({ bookName: resolvedBookName, title, content });

      const baseUrl = getBaseUrlFromReq(req);
      const exp = Math.floor(Date.now() / 1000) + 15 * 60;
      const viewUrl = buildViewUrl({ baseUrl, lineUserId, bookId, day, exp });
      const viewText = `🔗 內容較長或回覆失敗時，請點此閱讀：\n${viewUrl}`;

      if (fullText.length > 3000) {
        await lineReplyText({ replyToken, text: viewText });
        return;
      }

      const r = await lineReplyText({ replyToken, text: fullText });
      if (!r.ok) {
        await lineReplyText({ replyToken, text: viewText });
        return;
      }

      // 仍保留「回覆成功就寫閱讀紀錄」（短時間去重），避免重複刷太多
      await writeReadingRecordOnce({ lineUserId, bookId, bookName: resolvedBookName, day });
      // 保持 qa 狀態（其實是「上次閱讀」狀態）
      state.set(lineUserId, { step: 'qa', book_id: bookId, book_name: resolvedBookName, day });
      return;
    }
  } catch (err) {
    // 不輸出 token/userId/rawBody 等敏感資訊，只輸出簡短訊息
    console.error('line_webhook_error', err?.message || String(err));
  }
});

app.get('/view', async (req, res) => {
  try {
    const u = String(req.query.u || '');
    const bookId = String(req.query.book_id || '');
    const day = Number(req.query.day);
    const exp = req.query.exp;
    const sig = String(req.query.sig || '');

    if (!u || !bookId || !Number.isInteger(day)) {
      return res.status(400).send('⚠️ 連結格式不正確');
    }

    const v = verifyViewLink({ u, bookId, day, exp, sig });
    if (!v.ok) return res.status(v.status).send(v.message);
    const lineUserId = v.lineUserId;

    const subscribed = await checkSubscriptionByLineUserId(lineUserId, bookId);
    if (!subscribed) {
      // 只在未訂閱時才查書名，避免每次 /view 都多打一支 API
      let bookName = '';
      try {
        const books = await getBookList();
        const match = (books || []).find((b) => String(b.book_id || '') === bookId);
        bookName = String(match?.book_name || '').trim();
      } catch {
        // ignore lookup failure, fallback to generic message
      }
      return res.status(403).send(buildNotSubscribedText(bookName));
    }

    const contentRow = await getContentByBookAndDay(bookId, day);
    if (!contentRow) return res.status(404).send('⚠️ 很抱歉，找不到該日內容。');

    const title = normalizeLineBreaks(sanitizeContent(contentRow.title || ''));
    const content = normalizeLineBreaks(sanitizeContent(contentRow.content || ''));
    const bookName = normalizeBookNameForDisplay(String(contentRow.book_name || ''));
    const displayText = buildDisplayText({ bookName, title, content });
    // HTML 內文只顯示「去重後的內容本體」（不重複顯示 title；使用已 sanitize 的 content）
    const bodyOnly = stripDuplicatedTitleFromContent({ title, content });

    // Option 1: 成功回傳 HTML 即寫閱讀紀錄（短時間去重）
    await writeReadingRecordOnce({ lineUserId, bookId, bookName, day });

    const html = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(bookName || '禱告時光')}</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", "PingFang TC", Arial, sans-serif; line-height: 1.6; background: #fafafa; color: #111; }
      .wrap { max-width: 720px; margin: 0 auto; padding: 16px 16px 48px; }
      .card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); padding: 18px; }
      h1 { font-size: 18px; margin: 0 0 6px; }
      h2 { font-size: 16px; margin: 0 0 14px; color: #333; }
      pre { white-space: pre-wrap; word-break: break-word; margin: 12px 0 0; font-size: 15px; }
      .muted { color: #666; font-size: 12px; margin-top: 12px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        ${bookName ? `<h1>📖 ${escapeHtml(formatBookNameQuoted(bookName))}</h1>` : ''}
        ${title ? `<h2>🗓️ ${escapeHtml(title)}</h2>` : ''}
        <pre>${escapeHtml(String(bodyOnly || '').trim())}</pre>
        <div class="muted">⏰ 若此連結已過期，請回到 LINE 重新取得。</div>
      </div>
    </div>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    console.error('view_error', err?.message || String(err));
    return res.status(500).send('Internal Server Error');
  }
});

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const { port } = getConfig();
const server = app.listen(port, () => {
  // 不輸出任何 token/userId 等敏感資訊
  console.log(`prayer-time-line-api listening on port ${port}`);
});
server.on('error', (err) => {
  console.error('server_error', err?.message || String(err));
});

