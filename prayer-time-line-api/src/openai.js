const { getConfig } = require('./config');

function createTimeoutSignal(timeoutMs) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return { signal: undefined, cancel: () => {} };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), ms);
  return {
    signal: ac.signal,
    cancel: () => clearTimeout(t),
  };
}

function combineSignals(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ac = new AbortController();
  const onAbort = () => {
    try {
      ac.abort(new Error('aborted'));
    } catch {
      // ignore
    }
  };
  if (a.aborted || b.aborted) onAbort();
  else {
    a.addEventListener('abort', onAbort, { once: true });
    b.addEventListener('abort', onAbort, { once: true });
  }
  return ac.signal;
}

function extractResponsesText(data) {
  const direct = String(data?.output_text || '').trim();
  if (direct) return direct;

  // Fallback: parse output[].content[].text
  const out = data?.output;
  if (!Array.isArray(out)) return '';
  const parts = [];
  for (const item of out) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      const t = c?.text;
      if (typeof t === 'string' && t.trim()) parts.push(t.trim());
    }
  }
  return parts.join('\n').trim();
}

function buildSourcesLine(contexts) {
  const uniq = new Set();
  for (const c of contexts || []) {
    const book = String(c?.book_name || '').trim();
    const dayNum = c?.day != null ? Number(c.day) : NaN;
    if (!book || !Number.isFinite(dayNum)) continue;
    uniq.add(`${book}｜第${dayNum}天`);
  }
  const arr = Array.from(uniq);
  if (!arr.length) return '';
  return `出處：${arr.join('、')}`;
}

function stripModelSourcesLines(text) {
  const lines = String(text || '').split('\n');
  const kept = lines.filter((l) => !String(l || '').trim().match(/^出處[:：]/));
  // 移除尾端多餘空行
  while (kept.length && !String(kept[kept.length - 1] || '').trim()) kept.pop();
  return kept.join('\n').trim();
}

async function openaiEmbed(text, { timeoutMs, signal } = {}) {
  const { openaiApiKey, openaiEmbedModel } = getConfig();
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY 未設定');
  const input = String(text || '').trim();
  if (!input) throw new Error('embedding input empty');

  const ts = createTimeoutSignal(timeoutMs);
  const res = await fetch(
    'https://api.openai.com/v1/embeddings',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: openaiEmbedModel,
        input,
      }),
      signal: combineSignals(signal, ts.signal),
    }
  ).finally(() => ts.cancel());
  if (!res.ok) throw new Error(`openai_embed_error_${res.status}`);
  const data = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('openai_embed_invalid_response');
  return vec.map((x) => Number(x));
}

async function openaiEmbedBatch(texts) {
  const { openaiApiKey, openaiEmbedModel } = getConfig();
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY 未設定');
  const inputs = (texts || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (!inputs.length) return [];

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: openaiEmbedModel,
      input: inputs,
    }),
  });
  if (!res.ok) throw new Error(`openai_embed_error_${res.status}`);
  const data = await res.json();
  const arr = data?.data;
  if (!Array.isArray(arr) || arr.length !== inputs.length) throw new Error('openai_embed_invalid_response');
  return arr.map((item) => {
    const vec = item?.embedding;
    if (!Array.isArray(vec)) throw new Error('openai_embed_invalid_response');
    return vec.map((x) => Number(x));
  });
}

async function openaiQaAnswer({ question, contexts, timeoutMs, signal, maxOutputTokens } = {}) {
  const { openaiApiKey, openaiQaModel } = getConfig();
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY 未設定');
  const q = String(question || '').trim();
  if (!q) throw new Error('question empty');

  // contexts: Array<{book_name, day, chunk_index, text}>
  const ctxText = (contexts || [])
    .map((c, idx) => {
      const book = String(c.book_name || '').trim();
      const day = c.day != null ? Number(c.day) : '';
      const t = String(c.text || '').trim();
      return [
        `【參考片段 ${idx + 1}｜${book ? `書名：${book}｜` : ''}第${day}天】`,
        t,
      ].join('\n');
    })
    .join('\n\n');

  const system = [
    '你是一位以福音為中心、符合改革宗傳統、語氣溫柔謙卑的牧者助理。',
    '你只能根據「參考片段」來回答與本手冊內容相關的問題；若片段不足以支持結論，請明確說「沒有足夠資料」，並引導使用者回到手冊內容或提出更具體問題。',
    '重要：不得逐字引用或大段貼出參考片段原文；請用自己的話解釋與應用。',
    '回答請使用繁體中文，結構清楚，不要只給一句話。',
    '請不要列出「段落」或任何 chunk 編號。',
    '最後用 1 行列出出處（格式：出處：書名｜第X天；若多個出處用「、」分隔）。',
  ].join('\n');

  const user = `問題：${q}\n\n參考片段：\n${ctxText}`;

  // 使用 Responses API（與定價一致）
  const ts = createTimeoutSignal(timeoutMs);
  const res = await fetch(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: openaiQaModel,
        // Responses API 建議用 instructions + input（避免不同版本的 input schema 差異）
        instructions: system,
        input: user,
        // 盡量讓輸出精簡但完整
        max_output_tokens: Number.isFinite(Number(maxOutputTokens)) ? Number(maxOutputTokens) : 450,
      }),
      signal: combineSignals(signal, ts.signal),
    }
  ).finally(() => ts.cancel());
  if (!res.ok) throw new Error(`openai_qa_error_${res.status}`);
  const data = await res.json();
  const rawAnswer = extractResponsesText(data);
  if (!rawAnswer) throw new Error('openai_qa_empty');

  // 為確保一致格式：移除模型自行輸出的出處行，改由程式統一補上（不含段落）
  const main = stripModelSourcesLines(rawAnswer);
  const src = buildSourcesLine(contexts);
  return src ? `${main}\n\n${src}` : main;
}

function l2Normalize(vec) {
  const v = vec.map((x) => Number(x));
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

module.exports = {
  openaiEmbed,
  openaiEmbedBatch,
  openaiQaAnswer,
  l2Normalize,
};

