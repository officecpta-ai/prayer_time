/**
 * 將禱告手冊內容切為 chunk，供 embedding 與向量搜尋
 * 策略：依 [br][/br] 或雙換行分段，每段約 500–800 字（約 250–400 tokens）
 */

const CHUNK_MAX_CHARS = 1200; // 約 600 tokens
const CHUNK_OVERLAP = 100;

/**
 * @param {string} content - 原始內容（可含 [br][/br]）
 * @returns {string[]} chunks
 */
function splitIntoChunks(content) {
  const raw = String(content || '').replace(/\[br\]\[\/br\]/g, '\n').trim();
  if (!raw) return [];

  const paragraphs = raw.split(/\n\n+/).filter((p) => p.trim());
  const chunks = [];
  let current = '';

  for (const p of paragraphs) {
    const withLine = current ? `${current}\n\n${p}` : p;
    if (withLine.length <= CHUNK_MAX_CHARS) {
      current = withLine;
    } else {
      if (current) {
        chunks.push(current.trim());
        const overlap = current.slice(-CHUNK_OVERLAP);
        current = overlap + '\n\n' + p;
      } else {
        current = p;
      }
      while (current.length > CHUNK_MAX_CHARS) {
        const cut = current.slice(0, CHUNK_MAX_CHARS);
        const lastBreak = cut.lastIndexOf('\n');
        const slice = lastBreak > CHUNK_MAX_CHARS / 2 ? cut.slice(0, lastBreak + 1) : cut;
        chunks.push(slice.trim());
        current = current.slice(slice.length).trim();
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

module.exports = { splitIntoChunks };
