const { getProgressByEmail, createConversationLog } = require('../ragic');

async function getProgress(req, res) {
  try {
    const userEmail = req.userEmail;
    const row = await getProgressByEmail(userEmail);

    if (!row) {
      createConversationLog({
        email: userEmail,
        user_name: '',
        role: 'user',
        message: '查詢閱讀進度',
        conversation_id: (req.query.conversation_id || '').trim(),
      }).catch((err) => console.error('對話紀錄寫入失敗:', err));
      return res.json({
        last_book_id: null,
        last_book_name: null,
        last_day: null,
        last_read_date: null,
        message: '尚無閱讀進度',
      });
    }

    createConversationLog({
      email: userEmail,
      user_name: '',
      role: 'user',
      message: '查詢閱讀進度',
      conversation_id: (req.query.conversation_id || '').trim(),
    }).catch((err) => console.error('對話紀錄寫入失敗:', err));
    res.json({
      last_book_id: row.last_book_id,
      last_book_name: row.last_book_name,
      last_day: row.last_day,
      last_read_date: row.last_read_date,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '無法取得閱讀進度', message: err.message });
  }
}

module.exports = { getProgress };
