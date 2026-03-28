require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const { getConfig } = require('./config');
const { requireEmailOrAuth } = require('./auth');
const { listBooks, getEmailBooks } = require('./routes/books');
const { getContent } = require('./routes/content');
const { getProgress } = require('./routes/progress');
const { getSubscriptionStatus } = require('./routes/subscriptionStatus');
const { getLastReadingDay } = require('./routes/readingRecord');
const { getTitles } = require('./routes/titles');
const { init } = require('./routes/init');
const { getQa } = require('./routes/qa');
const { postCompanionLog } = require('./routes/companionLog');
const { postInternalSyncRagicToQdrant } = require('./routes/syncQdrant');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ service: '第一階門訓課程助理 API', status: 'ok' });
});

// 提供 OpenAPI Schema 給 GPTs Action「Import from URL」使用
app.get('/openapi.yaml', (req, res) => {
  const filePath = path.join(__dirname, '..', 'openapi.yaml');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('openapi.yaml not found');
  }
  res.type('application/x-yaml').send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/books', listBooks);
app.get('/email/books', getEmailBooks);

app.get('/content', requireEmailOrAuth, getContent);

app.get('/progress', requireEmailOrAuth, getProgress);
app.get('/subscription-status', requireEmailOrAuth, getSubscriptionStatus);
app.get('/reading-record/last-day', requireEmailOrAuth, getLastReadingDay);
app.get('/titles', requireEmailOrAuth, getTitles);
app.get('/init', requireEmailOrAuth, init);

app.get('/qa', requireEmailOrAuth, getQa);
app.post('/qa', requireEmailOrAuth, getQa);
app.post('/companion/log', requireEmailOrAuth, postCompanionLog);

/** Ragic→Qdrant 同步（需 SYNC_QDRANT_SECRET；供排程 POST，不列入公開 API 文件） */
app.post('/internal/sync-ragic-to-qdrant', postInternalSyncRagicToQdrant);

const { port } = getConfig();
const server = app.listen(port, () => {
  console.log(`Listening on port ${port}`);
  console.log(`→ 請在「另一個」終端機執行: curl http://localhost:${port}/`);
});
server.on('error', (err) => {
  console.error('Server error:', err.message);
});
