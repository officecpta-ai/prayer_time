/**
 * 從 query（GET）或 body（POST）取得 email，須為非空字串
 */
function getEmailFromRequest(req) {
  const fromQuery = req.query && req.query.email;
  const fromBody = req.body && req.body.email;
  const raw = typeof fromQuery === 'string' ? fromQuery : (typeof fromBody === 'string' ? fromBody : '');
  return (raw && String(raw).trim()) || null;
}

/**
 * 身分驗證：要求 query/body 帶 email，設 req.userEmail
 */
function requireEmailOrAuth(req, res, next) {
  const email = getEmailFromRequest(req);
  if (email) {
    req.userEmail = email;
    return next();
  }
  return res.status(401).json({ error: '請提供 email', message: '缺少 email 參數' });
}

module.exports = { getEmailFromRequest, requireEmailOrAuth };
