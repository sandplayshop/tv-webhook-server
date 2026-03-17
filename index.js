const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// 允許你的前端網域跨域存取（Netlify 網域）
app.use(cors({
  origin: 'https://trading2026.netlify.app',
  methods: ['GET', 'POST'],
}));

// 解析 JSON body
app.use(bodyParser.json());

// 用來暫存最近收到的訊號（記 100 筆）
let signals = [];

// TradingView Webhook 接收端
app.post('/tv-webhook', (req, res) => {
  try {
    const data = req.body; // 就是 Pine alert(msg) 的 JSON

    const now = new Date().toISOString();
    const record = {
      receivedAt: now,
      ...data,
    };

    console.log('收到 TradingView Webhook：', record);

    // 存進記憶體陣列
    signals.unshift(record);
    if (signals.length > 100) signals.pop();

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('處理 Webhook 發生錯誤：', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 提供給前端查詢最近訊號的 API
app.get('/signals', (req, res) => {
  res.json({ signals });
});

// 確認服務存活用
app.get('/', (req, res) => {
  res.send('TradingView Webhook Server 正在運作');
});

app.listen(port, () => {
  console.log(`Server 已啟動，port = ${port}`);
});
