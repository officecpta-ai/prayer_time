const { getConfig } = require('./config');

/**
 * 從 Authorization Bearer token 向 Google 驗證並取得使用者 email
 * @param {string} authHeader - "Bearer <token>"
 * @returns {Promise<{ email: string } | null>}
 */
async function getEmailFromBearer(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const url = `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      console.warn('Google tokeninfo 失敗:', res.status, text);
      return null;
    }
    const data = await res.json();
    if (data.email) return { email: data.email };
    if (data.sub) return { email: data.sub };
    return null;
  } catch (err) {
    console.error('getEmailFromBearer error:', err);
    return null;
  }
}

/**
 * Express 中介：要求 Bearer 且有效，並將 req.userEmail 設為 email
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const user = await getEmailFromBearer(authHeader);
  if (!user) {
    return res.status(401).json({ error: '請先登入', message: 'Authorization Bearer 無效或已過期' });
  }
  req.userEmail = user.email;
  next();
}

/**
 * 從 query（GET）或 body（POST）取得 email，須為非空字串
 */
function getEmailFromRequest(req) {
  const fromQuery = (req.query && req.query.email);
  const fromBody = (req.body && req.body.email);
  const raw = typeof fromQuery === 'string' ? fromQuery : (typeof fromBody === 'string' ? fromBody : '');
  const email = (raw && String(raw).trim()) || '';
  return email || null;
}

/**
 * 身分二選一：先看 query/body 的 email，沒有再試 Bearer；設 req.userEmail
 */
async function requireEmailOrAuth(req, res, next) {
  const emailFromParam = getEmailFromRequest(req);
  if (emailFromParam) {
    req.userEmail = emailFromParam;
    return next();
  }
  const authHeader = req.headers.authorization;
  const user = await getEmailFromBearer(authHeader);
  if (user) {
    req.userEmail = user.email;
    return next();
  }
  return res.status(401).json({ error: '請提供 email 或完成登入', message: '缺少 email 參數或 Authorization Bearer 無效' });
}

module.exports = { getEmailFromBearer, requireAuth, getEmailFromRequest, requireEmailOrAuth };
