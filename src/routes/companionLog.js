const crypto = require('crypto');
const {
  hasAnySubscription,
  getSubscriptionUserInfo,
  createConversationLog,
} = require('../ragic');

function getStringField(req, key) {
  const fromBody = req.body?.[key];
  const fromQuery = req.query?.[key];
  const raw = typeof fromBody === 'string' ? fromBody : (typeof fromQuery === 'string' ? fromQuery : '');
  return (raw && String(raw).trim()) || '';
}

function generateConversationId() {
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
  const s = escapeHtml(text);
  const withBreaks = s.replace(/\n/g, '<br/>');
  return `<p>${withBreaks}</p>`;
}

/**
 * POST /companion/log
 * body:
 * - user_message: string (required)
 * - assistant_message: string (required)
 * - conversation_id: string (optional; omit to create new)
 */
async function postCompanionLog(req, res) {
  try {
    const userEmail = req.userEmail;
    const userMessage = getStringField(req, 'user_message');
    const assistantMessage = getStringField(req, 'assistant_message');
    const conversationId = getStringField(req, 'conversation_id') || generateConversationId();

    if (!userMessage) {
      return res.status(400).json({ error: '請提供 user_message' });
    }
    if (!assistantMessage) {
      return res.status(400).json({ error: '請提供 assistant_message' });
    }

    const hasAny = await hasAnySubscription(userEmail);
    if (!hasAny) {
      return res.status(403).json({ error: '很抱歉，您尚未訂閱第一階門訓課程助理！' });
    }

    const userInfo = await getSubscriptionUserInfo(userEmail).catch(() => null);
    const user_name = userInfo?.user_name ?? '';
    const church = userInfo?.church ?? '';

    await Promise.all([
      createConversationLog({
        email: userEmail,
        user_name,
        church,
        role: 'user',
        messageHtml: toRichTextHtml(userMessage),
        conversation_id: conversationId,
      }),
      createConversationLog({
        email: userEmail,
        user_name,
        church,
        role: 'assistant',
        messageHtml: toRichTextHtml(assistantMessage),
        conversation_id: conversationId,
      }),
    ]);

    return res.json({
      ok: true,
      conversation_id: conversationId,
    });
  } catch (err) {
    console.error('[companion-log] error:', err);
    return res.status(500).json({ error: '陪談紀錄寫入失敗' });
  }
}

module.exports = { postCompanionLog };
