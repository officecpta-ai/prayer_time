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
const { authorize, callback, token } = require('./routes/oauth');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ service: '禱告時光 API', status: 'ok' });
});

// 提供 OpenAPI Schema 給 GPTs Action「Import from URL」使用
app.get('/openapi.yaml', (req, res) => {
  const filePath = path.join(__dirname, '..', 'openapi.yaml');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('openapi.yaml not found');
  }
  res.type('application/x-yaml').send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/oauth/authorize', authorize);
app.get('/oauth/callback', callback);
app.post('/oauth/token', token);

app.get('/books', listBooks);
app.get('/email/books', getEmailBooks);

app.get('/content', requireEmailOrAuth, getContent);

app.get('/progress', requireEmailOrAuth, getProgress);
app.get('/subscription-status', requireEmailOrAuth, getSubscriptionStatus);
app.get('/reading-record/last-day', requireEmailOrAuth, getLastReadingDay);
app.get('/titles', requireEmailOrAuth, getTitles);
app.get('/init', requireEmailOrAuth, init);

const { port } = getConfig();
const server = app.listen(port, () => {
  console.log(`Listening on port ${port}`);
  console.log(`→ 請在「另一個」終端機執行: curl http://localhost:${port}/`);
});
server.on('error', (err) => {
  console.error('Server error:', err.message);
});
