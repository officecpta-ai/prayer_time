const { getConfig } = require('../config');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Buffer.from(b64, 'base64').toString('utf8');
}

/**
 * GET /oauth/authorize
 * GPTs 會把使用者導向這裡，參數含 redirect_uri（ChatGPT callback）、scope、state。
 * 我們導向 Google 授權頁，並把原始 redirect_uri、state 包進 state 帶回。
 */
function authorize(req, res) {
  const { googleClientId, publicBaseUrl } = getConfig();
  if (!googleClientId || !publicBaseUrl) {
    return res.status(500).json({ error: 'OAuth 代理未設定 GOOGLE_CLIENT_ID 或 PUBLIC_BASE_URL' });
  }

  const redirectUri = req.query.redirect_uri;
  const scope = req.query.scope || 'email openid profile';
  const state = req.query.state || '';

  if (!redirectUri) {
    return res.status(400).json({ error: '缺少 redirect_uri' });
  }

  const ourCallback = `${publicBaseUrl}/oauth/callback`;
  const packedState = base64UrlEncode(JSON.stringify({ r: redirectUri, s: state }));

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: ourCallback,
    response_type: 'code',
    scope,
    state: packedState,
    access_type: 'offline',
    prompt: 'consent',
  });

  res.redirect(302, `${GOOGLE_AUTH_URL}?${params.toString()}`);
}

/**
 * GET /oauth/callback
 * Google 授權後導回這裡，帶 code、state。我們解開 state 得到 ChatGPT 的 redirect_uri，
 * 再導向 ChatGPT redirect_uri?code=code&state=原始state。
 */
function callback(req, res) {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send('缺少 code');
  }

  let redirectUri = '';
  let originalState = state || '';
  if (state) {
    try {
      const decoded = JSON.parse(base64UrlDecode(state));
      redirectUri = decoded.r || '';
      originalState = decoded.s || state;
    } catch (e) {
      console.error('oauth callback state decode error:', e);
    }
  }

  if (!redirectUri) {
    return res.status(400).send('無效的 state');
  }

  const sep = redirectUri.includes('?') ? '&' : '?';
  const url = `${redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(originalState)}`;
  res.redirect(302, url);
}

/**
 * POST /oauth/token
 * GPTs 拿 code 來換 token。我們用同一 code 向 Google 換 token（redirect_uri 用我們的 callback），
 * 再把 Google 回傳的 access_token 等原樣回給 GPTs。
 */
async function token(req, res) {
  const { googleClientId, googleClientSecret, publicBaseUrl } = getConfig();
  if (!googleClientId || !googleClientSecret || !publicBaseUrl) {
    return res.status(500).json({ error: 'OAuth 代理未設定 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / PUBLIC_BASE_URL' });
  }

  const { code, grant_type, redirect_uri } = req.body || {};
  if (!code || grant_type !== 'authorization_code') {
    return res.status(400).json({ error: '需要 code 且 grant_type=authorization_code' });
  }

  const ourCallback = `${publicBaseUrl}/oauth/callback`;
  const body = new URLSearchParams({
    code,
    client_id: googleClientId,
    client_secret: googleClientSecret,
    redirect_uri: ourCallback,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    console.error('Google token error:', tokenRes.status, data);
    return res.status(tokenRes.status).json(data);
  }

  res.json(data);
}

module.exports = { authorize, callback, token };
