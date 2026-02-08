const crypto = require('crypto');
const { getConfig } = require('./config');

function validateLineSignature({ rawBody, signatureBase64 }) {
  const { lineChannelSecret } = getConfig();
  if (!lineChannelSecret) return false;
  if (!rawBody || !signatureBase64) return false;
  const hmac = crypto.createHmac('sha256', lineChannelSecret).update(rawBody).digest('base64');
  // signature is base64 (not base64url)
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'utf8'), Buffer.from(String(signatureBase64), 'utf8'));
  } catch {
    return false;
  }
}

async function lineReplyText({ replyToken, text }) {
  const { lineChannelAccessToken } = getConfig();
  if (!lineChannelAccessToken) {
    return { ok: false, status: 500, error: 'LINE_CHANNEL_ACCESS_TOKEN 未設定' };
  }
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${lineChannelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: String(text || '') }],
    }),
  });

  if (res.ok) return { ok: true, status: res.status };
  // 不回傳/不記錄可能含敏感資訊的內容；只給 status
  return { ok: false, status: res.status };
}

async function getLineDisplayName(lineUserId) {
  const { lineChannelAccessToken } = getConfig();
  if (!lineChannelAccessToken) return null;
  const uid = String(lineUserId || '').trim();
  if (!uid) return null;
  const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(uid)}`, {
    headers: {
      Authorization: `Bearer ${lineChannelAccessToken}`,
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const name = data && typeof data === 'object' ? String(data.displayName || '').trim() : '';
  return name || null;
}

module.exports = {
  validateLineSignature,
  lineReplyText,
  getLineDisplayName,
};

