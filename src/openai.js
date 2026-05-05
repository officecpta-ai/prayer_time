const OpenAI = require('openai');
const { getConfig } = require('./config');

let _client = null;

function getOpenAI() {
  if (_client) return _client;
  const { openaiApiKey } = getConfig();
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY 未設定');
  _client = new OpenAI({ apiKey: openaiApiKey });
  return _client;
}

/**
 * 批次產生 embedding（text-embedding-3-small，1536 維）
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  if (!texts.length) return [];
  const openai = getOpenAI();
  const { openaiEmbedModel } = getConfig();
  const res = await openai.embeddings.create({
    model: openaiEmbedModel,
    input: texts,
  });
  return (res.data || []).map((d) => d.embedding || []).filter((e) => Array.isArray(e) && e.length > 0);
}

/**
 * L2 正規化（Cosine 向量搜尋用，與 pgvector cosine distance 一致）
 */
function l2Normalize(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return vec;
  const sum = vec.reduce((s, v) => s + v * v, 0);
  const norm = Math.sqrt(sum) || 1;
  return vec.map((v) => v / norm);
}

/**
 * 以 RAG 上下文生成回答
 * @param {{ question: string, contexts: Array<{ book_name: string, day: number, text: string }> }}
 * @returns {Promise<string>}
 */
async function generateAnswerWithContext({ question, contexts }) {
  const openai = getOpenAI();
  const { openaiChatModel } = getConfig();
  const contextText = contexts
    .map((c) => `【${c.book_name} 第${c.day}天】\n${c.text}`)
    .join('\n\n---\n\n');
  const systemContent = `你是第一階門訓課程助理助手。請根據以下禱告手冊內容回答使用者的問題。回答時：
- 僅依據提供的內容，不捏造、不推測
- 語氣溫和、節制
- 若內容不足以回答，誠實說明`;
  const userContent = `參考內容：\n\n${contextText}\n\n---\n\n使用者問題：${question}`;
  const res = await openai.chat.completions.create({
    model: openaiChatModel,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
  });
  const text = res.choices?.[0]?.message?.content?.trim() || '';
  return text;
}

module.exports = { embedBatch, l2Normalize, generateAnswerWithContext };
