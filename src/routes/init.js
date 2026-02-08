const { hasAnySubscription, getBookList } = require('../ragic');

async function init(req, res) {
  try {
    const userEmail = req.userEmail;
    const hasSubscription = await hasAnySubscription(userEmail);
    if (!hasSubscription) {
      return res.json({ hasSubscription: false, books: [] });
    }
    const books = await getBookList();
    return res.json({ hasSubscription: true, books });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '無法初始化', message: err.message });
  }
}

module.exports = { init };

