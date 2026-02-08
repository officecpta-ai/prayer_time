function createStateStore({ ttlMs = 15 * 60 * 1000, maxSize = 5000 } = {}) {
  const m = new Map(); // lineUserId -> { value, expiresAtMs }

  function prune(now) {
    for (const [k, v] of m) {
      if (!v || v.expiresAtMs <= now) m.delete(k);
    }
    while (m.size > maxSize) {
      const oldestKey = m.keys().next().value;
      if (oldestKey == null) break;
      m.delete(oldestKey);
    }
  }

  return {
    get(lineUserId) {
      const now = Date.now();
      const entry = m.get(lineUserId);
      if (!entry) return null;
      if (entry.expiresAtMs <= now) {
        m.delete(lineUserId);
        return null;
      }
      return entry.value;
    },
    set(lineUserId, value) {
      const now = Date.now();
      m.set(lineUserId, { value, expiresAtMs: now + ttlMs });
      if (m.size % 200 === 0) prune(now);
    },
    clear(lineUserId) {
      m.delete(lineUserId);
    },
  };
}

module.exports = { createStateStore };

