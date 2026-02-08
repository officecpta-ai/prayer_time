const { hasAnySubscription } = require('../ragic');

async function getSubscriptionStatus(req, res) {
  try {
    const userEmail = req.userEmail;
    const hasSubscription = await hasAnySubscription(userEmail);
    res.json({ hasSubscription });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '無法取得訂閱狀態', message: err.message });
  }
}

module.exports = { getSubscriptionStatus };
