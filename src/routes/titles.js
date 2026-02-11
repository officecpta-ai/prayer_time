const { checkSubscription, getBookDayTitles, createConversationLog } = require('../ragic');

async function getTitles(req, res) {
  try {
    const userEmail = req.userEmail;
    const bookId = req.query.book_id;
    if (!bookId) {
      return res.status(400).json({ error: '請提供 book_id' });
    }

    const subscribed = await checkSubscription(userEmail, bookId);
    if (!subscribed) {
      return res.status(200).json({
        subscribed: false,
        error: '很抱歉，您尚未訂閱禱告時光！',
      });
    }

    const result = await getBookDayTitles(bookId);
    createConversationLog({
      email: userEmail,
      user_name: '',
      role: 'user',
      message: `查詢標題 書本:${result.book_name || bookId}`,
      conversation_id: (req.query.conversation_id || '').trim(),
    }).catch((err) => console.error('對話紀錄寫入失敗:', err));
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '無法取得標題清單', message: err.message });
  }
}

module.exports = { getTitles };

