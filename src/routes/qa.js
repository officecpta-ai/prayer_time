const crypto = require('crypto');
const {
  checkSubscription,
  hasAnySubscription,
  getSubscribedBooksByEmail,
  getSubscriptionUserInfo,
  createConversationLog,
} = require('../ragic');
const { searchChunks } = require('../qdrant');
const { embedBatch, l2Normalize, generateAnswerWithContext } = require('../openai');

/**
 * 從 query（GET）或 body（POST）取得 question
 */
function getQuestionFromRequest(req) {
  const fromQuery = req.query?.question;
  const fromBody = req.body?.question;
  const raw = typeof fromQuery === 'string' ? fromQuery : (typeof fromBody === 'string' ? fromBody : '');
  return (raw && String(raw).trim()) || null;
}

/**
 * 從 query（GET）或 body（POST）取得 book_id（選填）
 */
function getBookIdFromRequest(req) {
  const fromQuery = req.query?.book_id;
  const fromBody = req.body?.book_id;
  const raw = typeof fromQuery === 'string' ? fromQuery : (typeof fromBody === 'string' ? fromBody : '');
  return (raw && String(raw).trim()) || null;
}

/**
 * 從 query（GET）或 body（POST）取得 conversation_id（選填）
 */
function getConversationIdFromRequest(req) {
  const fromQuery = req.query?.conversation_id;
  const fromBody = req.body?.conversation_id;
  const raw = typeof fromQuery === 'string' ? fromQuery : (typeof fromBody === 'string' ? fromBody : '');
  const v = (raw && String(raw).trim()) || '';
  return v || null;
}

function generateConversationId() {
  // 16 hex chars；僅用於 gpt/10 欄位歸組
  return crypto.randomBytes(8).toString('hex');
}

function escapeHtml(text) {
  const s = String(text ?? '');
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toRichTextHtml(text) {
  // Ragic 的 message 欄位：寫入 HTML（富文字）
  const s = escapeHtml(text);
  const withBreaks = s.replace(/\n/g, '<br/>');
  return `<p>${withBreaks}</p>`;
}

/**
 * GET /qa?question=...&book_id=... 或 POST /qa { question, book_id? }
 * 驗證：requireEmailOrAuth，若提供 book_id 則檢查訂閱
 */
async function getQa(req, res) {
  try {
    const question = getQuestionFromRequest(req);
    const bookId = getBookIdFromRequest(req);
    const userEmail = req.userEmail;
    const conversationId = getConversationIdFromRequest(req) || generateConversationId();

    if (!question) {
      return res.status(400).json({ error: '請提供 question' });
    }

    const hasAny = await hasAnySubscription(userEmail);
    if (!hasAny) {
      return res.status(403).json({ error: '很抱歉，您尚未訂閱第一階門訓課程助理！' });
    }

    if (bookId) {
      const subscribed = await checkSubscription(userEmail, bookId);
      if (!subscribed) {
        return res.status(403).json({ error: '您尚未訂閱此手冊，無法使用整本手冊 QA' });
      }
    }

    const userInfoPromise = getSubscriptionUserInfo(userEmail).catch(() => null);

    const embeddings = await embedBatch([question]);
    const queryEmbedding = embeddings[0];
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return res.status(500).json({ error: '無法產生問題的 embedding' });
    }

    const normalized = l2Normalize(queryEmbedding);
    let chunks;
    try {
      chunks = await retrieveQaChunks({
        userEmail,
        question,
        normalizedEmbedding: normalized,
        filterBookId: bookId || null,
      });
    } catch (err) {
      console.error('[qa] Qdrant search error:', err);
      return res.status(500).json({ error: '向量搜尋失敗' });
    }

    if (!chunks || chunks.length === 0) {
      return res.json({
        answer: '找不到相關內容，請換個方式提問或確認手冊已同步至向量庫。',
        sources: [],
        conversation_id: conversationId,
      });
    }

    const contexts = chunks.map((c) => ({
      book_name: c.book_name || '',
      day: c.day ?? 0,
      text: c.text || '',
    }));

    const answer = await generateAnswerWithContext({ question, contexts });
    const sources = buildSources(chunks);

    // 凡通過訂閱檢查且成功產生回答之 QA，皆寫入對話紀錄（user + assistant）
    try {
      const userInfo = await userInfoPromise;
      const user_name = userInfo?.user_name ?? '';
      const church = userInfo?.church ?? '';

      const [userLogRes, assistantLogRes] = await Promise.all([
        createConversationLog({
          email: userEmail,
          user_name,
          church,
          role: 'user',
          messageHtml: toRichTextHtml(question),
          conversation_id: conversationId,
        }),
        createConversationLog({
          email: userEmail,
          user_name,
          church,
          role: 'assistant',
          messageHtml: toRichTextHtml(answer),
          conversation_id: conversationId,
        }),
      ]);
      void userLogRes;
      void assistantLogRes;
    } catch (logErr) {
      console.error('[qa] createConversationLog failed:', logErr);
    }

    return res.json({ answer, sources, conversation_id: conversationId });
  } catch (err) {
    console.error('[qa] error:', err);
    return res.status(500).json({ error: 'QA 處理失敗' });
  }
}

function isCrossBookQuestion(question) {
  const q = String(question || '').trim();
  if (!q) return false;
  // 涵蓋：整體比較、每本、四本關聯等跨手冊詢問
  return /(每本|各本|四本|整體|全部|比較|差異|關聯|連貫|共同|異同|整合|總覽)/.test(q);
}

function mergeChunksByBestScore(chunks) {
  const byId = new Map();
  for (const c of chunks || []) {
    if (!c || !c.id) continue;
    const prev = byId.get(c.id);
    if (!prev || Number(c.score || 0) > Number(prev.score || 0)) {
      byId.set(c.id, c);
    }
  }
  return Array.from(byId.values()).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function diversifyByBook(chunks, books, maxCount) {
  const out = [];
  const usedIds = new Set();

  // 先為每本手冊放入分數最高的一筆，保證跨手冊問題不會漏書
  for (const b of books || []) {
    const bid = String(b.book_id || '');
    if (!bid) continue;
    const first = (chunks || []).find((c) => String(c.book_id || '') === bid);
    if (first && !usedIds.has(first.id)) {
      out.push(first);
      usedIds.add(first.id);
    }
  }
  for (const c of chunks || []) {
    if (out.length >= maxCount) break;
    if (!c?.id || usedIds.has(c.id)) continue;
    out.push(c);
    usedIds.add(c.id);
  }
  return out;
}

function buildSources(chunks) {
  const uniq = new Set();
  const out = [];
  for (const c of chunks || []) {
    const key = `${c.book_name || ''}::${c.day ?? 0}`;
    if (uniq.has(key)) continue;
    uniq.add(key);
    out.push({
      book_name: c.book_name || '',
      day: c.day ?? 0,
    });
    if (out.length >= 8) break;
  }
  return out;
}

async function retrieveQaChunks({ userEmail, question, normalizedEmbedding, filterBookId }) {
  // 若指定單一本手冊，直接在該 book_id 內檢索
  if (filterBookId) {
    return searchChunks(normalizedEmbedding, {
      matchCount: 10,
      filterBookId,
    });
  }

  // 先做全庫檢索
  const global = await searchChunks(normalizedEmbedding, {
    matchCount: 10,
    filterBookId: null,
  });

  // 僅在「跨手冊問題」啟動逐本保底檢索（根本解）
  if (!isCrossBookQuestion(question)) {
    return global;
  }

  const { books } = await getSubscribedBooksByEmail(userEmail);
  if (!books || books.length === 0) return global;

  const perBook = await Promise.all(
    books.map((b) =>
      searchChunks(normalizedEmbedding, {
        matchCount: 3,
        filterBookId: b.book_id,
      })
    )
  );
  const merged = mergeChunksByBestScore([...global, ...perBook.flat()]);
  return diversifyByBook(merged, books, 14);
}

module.exports = { getQa };
