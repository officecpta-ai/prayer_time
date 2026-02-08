const crypto = require('crypto');
const { getConfig } = require('./config');
const { base64urlEncode, base64urlDecodeToString, safeEqual } = require('./utils');

function buildViewSigInput({ u, bookId, day, exp }) {
  return [u, bookId, String(day), String(exp)].join('|');
}

function signViewLink({ u, bookId, day, exp }) {
  const { viewLinkSecret } = getConfig();
  if (!viewLinkSecret) throw new Error('VIEW_LINK_SECRET 未設定');
  const input = buildViewSigInput({ u, bookId, day, exp });
  const sig = crypto.createHmac('sha256', viewLinkSecret).update(input).digest();
  return base64urlEncode(sig);
}

function verifyViewLink({ u, bookId, day, exp, sig }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expNum = Number(exp);
  if (!Number.isFinite(expNum)) return { ok: false, status: 400, message: '⚠️ 連結格式不正確' };
  if (expNum < nowSec) return { ok: false, status: 403, message: '⏰ 連結已過期，請回到 LINE 重新取得連結' };
  // 允許 exp 過大也算有效（只要是你簽的），避免不必要拒絕；有效期由產生端控制

  let expected;
  try {
    expected = signViewLink({ u, bookId, day, exp: expNum });
  } catch {
    return { ok: false, status: 500, message: '⚠️ 服務設定未完成' };
  }
  if (!safeEqual(expected, sig)) return { ok: false, status: 403, message: '⚠️ 連結驗證失敗，請回到 LINE 重新取得連結' };

  let lineUserId;
  try {
    lineUserId = base64urlDecodeToString(u);
  } catch {
    return { ok: false, status: 400, message: '⚠️ 連結格式不正確' };
  }
  if (!lineUserId) return { ok: false, status: 400, message: '⚠️ 連結格式不正確' };
  return { ok: true, lineUserId, exp: expNum };
}

function buildViewUrl({ baseUrl, lineUserId, bookId, day, exp }) {
  const u = base64urlEncode(lineUserId);
  const sig = signViewLink({ u, bookId, day, exp });
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/view`);
  url.searchParams.set('u', u);
  url.searchParams.set('book_id', String(bookId));
  url.searchParams.set('day', String(day));
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);
  return url.toString();
}

module.exports = {
  buildViewUrl,
  verifyViewLink,
};

