const { Firestore } = require('@google-cloud/firestore');

let _db = null;

function getFirestore() {
  if (_db) return _db;
  // Cloud Run 預設使用 Application Default Credentials
  _db = new Firestore();
  return _db;
}

module.exports = { getFirestore };

