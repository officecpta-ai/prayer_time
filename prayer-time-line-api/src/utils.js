function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecodeToString(s) {
  const b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return require('crypto').timingSafeEqual(aa, bb);
}

function normalizeLineBreaks(text) {
  return String(text || '').replace(/\[br\]\[\/br\]/g, '\n');
}

function sanitizeContent(text) {
  let s = String(text || '');
  // 只拿掉 [code] / [/code] 標籤，保留區塊內文字（內文在 Ragic 裡整段包在 [code] 內）
  s = s.replace(/\[code\]/gi, '').replace(/\[\/code\]/gi, '');
  // 拿掉標籤後可能殘留的「(代碼不該顯示）」等說明
  s = s.replace(/\([^)]*代碼[^)]*\)/g, '');
  // <br> 轉成換行
  s = s.replace(/<br\s*\/?>/gi, '\n');
  return s;
}

module.exports = {
  base64urlEncode,
  base64urlDecodeToString,
  safeEqual,
  normalizeLineBreaks,
  sanitizeContent,
};

