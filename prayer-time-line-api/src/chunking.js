function splitIntoChunks(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  // 以空行分段；保留有意義的小段
  const parts = s
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);

  // 避免段落過長：再用單行切（粗略）
  const chunks = [];
  for (const p of parts) {
    if (p.length <= 450) {
      chunks.push(p);
      continue;
    }
    const lines = p.split('\n').map((x) => x.trim()).filter(Boolean);
    let buf = '';
    for (const line of lines) {
      if (!buf) {
        buf = line;
        continue;
      }
      if ((buf + '\n' + line).length > 450) {
        chunks.push(buf);
        buf = line;
      } else {
        buf += '\n' + line;
      }
    }
    if (buf) chunks.push(buf);
  }
  return chunks;
}

module.exports = { splitIntoChunks };

