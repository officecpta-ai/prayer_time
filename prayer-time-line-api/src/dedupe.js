function createTtlDedupe({ ttlMs = 5 * 60 * 1000, maxSize = 5000 } = {}) {
  const m = new Map(); // key -> expiresAtMs

  function prune(now) {
    for (const [k, exp] of m) {
      if (exp <= now) m.delete(k);
    }
    while (m.size > maxSize) {
      const oldestKey = m.keys().next().value;
      if (oldestKey == null) break;
      m.delete(oldestKey);
    }
  }

  return {
    seenRecently(key) {
      const now = Date.now();
      const exp = m.get(key);
      if (exp && exp > now) return true;
      m.set(key, now + ttlMs);
      if (m.size % 200 === 0) prune(now);
      return false;
    },
  };
}

module.exports = { createTtlDedupe };

