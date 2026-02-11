const { getContentByBookAndDay, checkSubscription, createReadingRecord, getSubscriptionUserInfo, createConversationLog } = require('../ragic');

function getTodayDay() {
  return new Date().getDate();
}

async function getContent(req, res) {
  try {
    const bookId = req.query.book_id;
    const dayParam = req.query.day;
    const userEmail = req.userEmail;

    // #region agent log
    const _log = (msg, data, hid) => { try { fetch('http://127.0.0.1:7243/ingest/41879265-8ca7-44cf-933a-1ec2de4bc474',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.js:getContent',message:msg,data,timestamp:Date.now(),hypothesisId:hid})}).catch(()=>{}); } catch(e){}; console.log('[DEBUG content]', msg, JSON.stringify(data)); };
    _log('/content request', { request_book_id: bookId, day: dayParam }, 'H1');
    // #endregion

    if (!bookId) {
      return res.status(400).json({ error: '請提供 book_id' });
    }

    const day = dayParam != null ? parseInt(dayParam, 10) : getTodayDay();
    if (Number.isNaN(day) || day < 1 || day > 31) {
      return res.status(400).json({ error: 'day 須為 1–31' });
    }

    const [subscribed, userInfo] = await Promise.all([
      checkSubscription(userEmail, bookId),
      getSubscriptionUserInfo(userEmail),
    ]);

    if (!subscribed) {
      return res.status(200).json({
        subscribed: false,
        error: '很抱歉，您尚未訂閱禱告時光！',
      });
    }

    const row = await getContentByBookAndDay(bookId, day);
    if (!row) {
      return res.status(404).json({
        error: '找不到該日內容',
        book_id: bookId,
        day,
      });
    }

    // #region agent log
    _log('/content row returned', { request_book_id: bookId, returned_book_id: row.book_id, returned_book_name: row.book_name }, 'H2,H4');
    // #endregion

    const contentPayload = {
      book_id: row.book_id,
      book_name: row.book_name,
      day: row.day,
      title: row.title,
      content: row.content,
    };

    try {
      if (process.env.RAGIC_DEBUG === '1' || process.env.RAGIC_DEBUG === 'true') {
        console.log('[content] 訂閱表讀到 userInfo:', { user_name: userInfo.user_name ?? '(空)', church: userInfo.church ?? '(空)' });
      }
      await createReadingRecord({
        user_email: userEmail,
        book_id: row.book_id,
        book_name: row.book_name || '',
        reading_day: row.day,
        user_name: userInfo.user_name ?? '',
        church: userInfo.church ?? '',
      });
    } catch (recordErr) {
      console.error('寫入閱讀紀錄失敗:', recordErr);
    }

    createConversationLog({
      email: userEmail,
      user_name: userInfo.user_name ?? '',
      role: 'user',
      message: `取得內容 書本:${row.book_name} 第${row.day}天`,
      conversation_id: (req.query.conversation_id || '').trim(),
    }).catch((err) => console.error('對話紀錄寫入失敗:', err));

    res.json(contentPayload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '無法取得內容', message: err.message });
  }
}

module.exports = { getContent };
