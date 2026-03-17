const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const port = process.env.PORT || 3000;

// 允許你的 Netlify 前端跨域存取 /signals
app.use(cors({
  origin: 'https://trading2026.netlify.app',
  methods: ['GET', 'POST'],
}));

app.use(bodyParser.json());

// 用來暫存最近收到的訊號（TradingView + 歷史初始化）
let signals = [];

// =================== 技術指標 & M/W 門計算 ===================

// EMA
function ema(data, len) {
  if (!data.length) return [];
  const alpha = 2 / (len + 1);
  const res = [data[0]];
  for (let i = 1; i < data.length; i++) {
    res.push(data[i] * alpha + res[i - 1] * (1 - alpha));
  }
  return res;
}

// MACD(12,26,9)
function macd(closes, f = 12, s = 26, sig = 9) {
  const fast = ema(closes, f);
  const slow = ema(closes, s);
  const dif = closes.map((v, i) => fast[i] - slow[i]);
  const dea = ema(dif, sig);
  const hist = dif.map((v, i) => v - dea[i]);
  return { dif, dea, hist };
}

// 判斷交叉
function cross(a1, a0, level = 0) {
  return (a1 < level && a0 > level) || (a1 > level && a0 < level);
}
function crossunder(a1, a0, level = 0) {
  return a1 >= level && a0 < level;
}
function crossover(a1, a0, level = 0) {
  return a1 <= level && a0 > level;
}

/**
 * 這個是簡化版的「掃描整段 K 線，找出所有 M/W 門」。
 * 回傳：
 *   {
 *     doors: [
 *       { type: 'M', price, barIndex, time, status: 'ok'|'pot'|'wait' },
 *       { type: 'W', price, barIndex, time, status: 'ok'|'pot'|'wait' },
 *       ...
 *     ]
 *   }
 */
function scanMWDoors(candles) {
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const times  = candles.map(c => c.time);

  const n = closes.length;
  if (n < 50) return { doors: [] };

  const { dif, hist } = macd(closes, 12, 26, 9);

  let ht = NaN, pt = NaN, htc = NaN, ptc = NaN, stc = NaN;
  let lb = NaN, pb = NaN, lbc = NaN, pbc = NaN, sbc = NaN;

  const doors = [];

  for (let i = 1; i < n; i++) {
    const d  = dif[i];
    const d1 = dif[i - 1];
    const h  = hist[i];
    const h1 = hist[i - 1];
    const hi = highs[i];
    const lo = lows[i];

    const z_cu = crossunder(h1, h, 0);
    const z_co = crossover(h1, h, 0);
    const z_cr = cross(h1, h, 0);

    // ===== 頂部 M 掃描 =====
    ht = z_cr ? 0 : (d > 0 && (isNaN(ht) || d > ht) ? d : ht);
    ht = (d > 0 && z_co) ? d : ht;

    htc = z_co ? 0 : (d > 0 && d === ht ? hi : htc);
    htc = (d > 0 && z_co) ? hi : htc;

    pt  = d < 0 ? 0 : (z_cu ? ht  : pt);
    ptc = d < 0 ? 0 : (z_cu ? htc : ptc);

    stc = (d < 0 || z_cu) ? 0 : (hi > stc ? hi : stc);

    const top_ok   = pt && ht && stc &&
                     (ht < pt) &&
                     (stc >= ptc) &&
                     (h < h1) &&
                     z_cu;

    const top_pot  = ht && pt && (ht < pt) && (stc >= ptc);
    const top_wait = ht && pt && (ht < pt) && (h > 0) && stc && stc < ptc;

    if (top_ok) {
      doors.push({
        type: 'M',
        status: 'ok',
        price: ptc,
        barIndex: i,
        time: times[i]
      });
    } else if (top_pot) {
      doors.push({
        type: 'M',
        status: 'pot',
        price: ptc,
        barIndex: i,
        time: times[i]
      });
    } else if (top_wait) {
      doors.push({
        type: 'M',
        status: 'wait',
        price: ptc,
        barIndex: i,
        time: times[i]
      });
    }

    // ===== 底部 W 掃描 =====
    lb = z_cr ? 0 : (d < 0 && (isNaN(lb) || d < lb) ? d : lb);
    lb = (d < 0 && z_cu) ? d : lb;

    lbc = z_cu ? 0 : (d < 0 && d === lb ? lo : lbc);
    lbc = (d < 0 && z_cu) ? lo : lbc;

    pb  = d > 0 ? 0 : (z_co ? lb  : pb);
    pbc = d > 0 ? 0 : (z_co ? lbc : pbc);

    sbc = (d > 0 || z_co) ? Infinity : (lo < sbc ? lo : sbc);

    const bot_ok   = pb && lb && sbc &&
                     (lb > pb) &&
                     (sbc <= pbc) &&
                     (h > h1) &&
                     z_co;

    const bot_pot  = lb && pb && (lb > pb) && (sbc <= pbc);
    const bot_wait = lb && pb && (lb > pb) && (h < 0) && sbc && sbc > pbc;

    if (bot_ok) {
      doors.push({
        type: 'W',
        status: 'ok',
        price: pbc,
        barIndex: i,
        time: times[i]
      });
    } else if (bot_pot) {
      doors.push({
        type: 'W',
        status: 'pot',
        price: pbc,
        barIndex: i,
        time: times[i]
      });
    } else if (bot_wait) {
      doors.push({
        type: 'W',
        status: 'wait',
        price: pbc,
        barIndex: i,
        time: times[i]
      });
    }
  }

  return { doors };
}

// =================== 初始化：抓 Bybit 歷史 + 計算門 ===================

async function fetchBybitKlines(symbol, interval, limit = 1000) {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.retCode !== 0) {
    throw new Error(json.retMsg || 'Bybit API error');
  }
  const list = json.result.list;
  const candles = list.map(d => ({
    time: parseInt(d[0]) / 1000,
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5] || 0),
  })).reverse();
  return candles;
}

/**
 * 啟動時呼叫：抓一組你主力看的週期（例如 5m），
 * 算出歷史 M/W 門，存進 signals。
 */
async function initHistoricalSignals() {
  try {
    const symbol = 'BTCUSDT';   // 你可以日後改成多 symbol 或改成環境變數
    const interval = '5';       // Bybit interval: '1','3','5','15','60','240','D','W','M'
    const limit = 1000;         // 最多抓 1000 根

    console.log('開始抓取 Bybit 歷史 K 線用於初始化門資訊...');
    const candles = await fetchBybitKlines(symbol, interval, limit);

    console.log(`取得 ${candles.length} 根 K 線，開始計算 M/W 門...`);
    const { doors } = scanMWDoors(candles);

    console.log(`掃描完成，共找到 ${doors.length} 個門事件。`);

    // 把每個 door 轉成一筆 signal 存入 signals 陣列
    doors.forEach(door => {
      const ts = new Date(door.time * 1000).toISOString();
      const sig = {
        type: 'history-mw-door',
        symbol,
        tf: interval,
        door_type: door.type,         // 'M' or 'W'
        door_status: door.status,     // 'ok','pot','wait'
        door_price: door.price,
        bar_index: door.barIndex,
        door_time: ts,
        receivedAt: ts,               // 為了與 TradingView 資料一致
      };
      signals.push(sig);
    });

    // 依時間排序（最新在前）
    signals.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

    // 如果太多可以裁剪，例如只留下最新 300 筆
    const MAX_KEEP = 300;
    if (signals.length > MAX_KEEP) {
      signals = signals.slice(0, MAX_KEEP);
    }

    console.log(`初始化完成，目前 signals.length = ${signals.length}`);
  } catch (err) {
    console.error('初始化歷史門資訊失敗：', err);
  }
}

// =================== TradingView Webhook 接收端 ===================
app.post('/tv-webhook', (req, res) => {
  try {
    const data = req.body; // Pine alert(msg) 的 JSON
    const now = new Date().toISOString();
    const record = {
      receivedAt: now,
      ...data,
    };

    console.log('收到 TradingView Webhook：', record);

    signals.unshift(record);
    if (signals.length > 300) signals.pop();

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('處理 Webhook 發生錯誤：', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// =================== 提供給前端查詢的 API ===================
app.get('/signals', (req, res) => {
  res.json({ signals });
});

// 確認服務存活用
app.get('/', (req, res) => {
  res.send('TradingView Webhook Server 正在運作');
});

// =================== 啟動伺服器 & 初始化歷史門 ===================
app.listen(port, () => {
  console.log(`Server 已啟動，port = ${port}`);
  // 啟動後主動初始化一次歷史 M/W 門
  initHistoricalSignals();
});
