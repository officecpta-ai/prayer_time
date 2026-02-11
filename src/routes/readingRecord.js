const { getLastReadingDayByEmailAndBook, createConversationLog } = require('../ragic');

async function getLastReadingDay(req, res) {
  try {
    const userEmail = req.userEmail;
    const bookId = req.query.book_id;
    if (!bookId) {
      return res.status(400).json({ error: '請提供 book_id' });
    }
    const last_day = await getLastReadingDayByEmailAndBook(userEmail, bookId);
    const next_day = last_day == null ? 1 : Math.min(31, Number(last_day) + 1);
    createConversationLog({
      email: userEmail,
      user_name: '',
      role: 'user',
      message: `查詢最後閱讀天數 書本:${bookId}`,
      conversation_id: (req.query.conversation_id || '').trim(),
    }).catch((err) => console.error('對話紀錄寫入失敗:', err));
    return res.json({ book_id: String(bookId), last_day, next_day });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '無法取得閱讀紀錄', message: err.message });
  }
}

module.exports = { getLastReadingDay };

