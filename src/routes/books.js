const { getConfig } = require('../config');
const { getBookList, getSubscribedBooksByEmail, createConversationLog } = require('../ragic');

async function listBooks(req, res) {
  try {
    const books = await getBookList();
    res.json({ books });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '無法取得手冊清單', message: err.message });
  }
}

/**
 * GET /email/books?email=... — 不需 Bearer，依 email 回傳已訂閱書單與表單連結
 */
async function getEmailBooks(req, res) {
  const email = (req.query.email || '').trim();
  if (!email) {
    return res.status(400).json({ error: '請提供 email 參數', message: '缺少 email' });
  }
  try {
    const { books: list, user_name } = await getSubscribedBooksByEmail(email);
    const allBooks = await getBookList();
    const subscribed_books = list.map((b, i) => ({ number: i + 1, book_id: b.book_id, book_name: b.book_name }));
    const all_books_subscribed = list.length >= allBooks.length;
    const { subscriptionFormUrl } = getConfig();

    // #region agent log
    try { fetch('http://127.0.0.1:7243/ingest/41879265-8ca7-44cf-933a-1ec2de4bc474',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'books.js:getEmailBooks',message:'/email/books response',data:{subscribed_books:subscribed_books},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{}); } catch(e){}; console.log('[DEBUG email/books]', 'subscribed_books', JSON.stringify(subscribed_books));
    // #endregion

    createConversationLog({
      email,
      user_name: user_name ?? '',
      role: 'user',
      message: '查詢訂閱書單',
      conversation_id: (req.query.conversation_id || '').trim(),
    }).catch((err) => console.error('對話紀錄寫入失敗:', err));

    res.json({
      subscribed_books,
      subscription_form_url: subscriptionFormUrl,
      user_name: user_name || null,
      all_books_subscribed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '無法查詢訂閱', message: err.message });
  }
}

module.exports = { listBooks, getEmailBooks };
