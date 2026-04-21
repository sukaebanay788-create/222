const BINANCE_WS = 'wss://fstream.binance.com/ws';
const BINANCE_API = 'https://fapi.binance.com';

let chart;
let footprintSeries;
let ws;
let currentCandle = null;
let historicalCandles = [];
const TIMEFRAME_MS = 60000;
let statusEl = document.getElementById('status');

// ---------- Инициализация ----------
function init() {
    const container = document.getElementById('chart-container');
    chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: { background: { color: '#0b0e11' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1e2329' }, horzLines: { color: '#1e2329' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#1e2329' },
        timeScale: { borderColor: '#1e2329', timeVisible: true, secondsVisible: false },
    });

    const FootprintSeriesClass = createFootprintSeriesClass();
    footprintSeries = chart.addCustomSeries(FootprintSeriesClass, { priceScaleId: 'right' });

    window.addEventListener('resize', () => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });

    loadHistoricalData().then(() => connectWebSocket());
}

// ---------- Кастомная серия (правильная реализация) ----------
function createFootprintSeriesClass() {
    class FootprintRenderer {
        draw(target, priceConverter, isHovered, hitTestData) {
            const ctx = target.context;
            const series = target.series;
            const data = series.data();
            if (!data || data.length === 0) return;

            ctx.clearRect(0, 0, target.mediaSize.width, target.mediaSize.height);
            const barSpacing = target.barSpacing;
            const visibleRange = target.visibleRange;

            for (let i = visibleRange.from; i < visibleRange.to; i++) {
                const candle = data[i];
                if (!candle) continue;

                const x = i * barSpacing + barSpacing / 2;
                const width = barSpacing * 0.8;
                const openY = priceConverter(candle.open);
                const closeY = priceConverter(candle.close);
                const highY = priceConverter(candle.high);
                const lowY = priceConverter(candle.low);

                // Тень
                ctx.beginPath();
                ctx.strokeStyle = candle.close >= candle.open ? '#0ecb81' : '#f6465d';
                ctx.lineWidth = 1;
                ctx.moveTo(x, highY);
                ctx.lineTo(x, lowY);
                ctx.stroke();

                // Тело
                ctx.fillStyle = candle.close >= candle.open ? '#0ecb81' : '#f6465d';
                ctx.fillRect(x - width/2, Math.min(openY, closeY), width, Math.abs(openY - closeY));

                // Футпринт
                if (candle.levels && candle.levels.length) {
                    const maxVol = Math.max(...candle.levels.map(l => Math.max(l.bidVol, l.askVol)), 0.001);
                    const cellHeight = 12;
                    for (const level of candle.levels) {
                        const priceY = priceConverter(level.price);
                        if (priceY === null) continue;
                        ctx.fillStyle = '#1e2329';
                        ctx.fillRect(x - width/2, priceY - cellHeight/2, width, cellHeight);
                        if (level.bidVol > 0) {
                            const bidWidth = (level.bidVol / maxVol) * (width / 2);
                            ctx.fillStyle = '#0ecb81';
                            ctx.fillRect(x - width/2, priceY - cellHeight/2, bidWidth, cellHeight);
                        }
                        if (level.askVol > 0) {
                            const askWidth = (level.askVol / maxVol) * (width / 2);
                            ctx.fillStyle = '#f6465d';
                            ctx.fillRect(x, priceY - cellHeight/2, askWidth, cellHeight);
                        }
                        ctx.beginPath();
                        ctx.strokeStyle = '#2b3139';
                        ctx.lineWidth = 0.5;
                        ctx.moveTo(x, priceY - cellHeight/2);
                        ctx.lineTo(x, priceY + cellHeight/2);
                        ctx.stroke();
                        ctx.fillStyle = '#d1d4dc';
                        ctx.font = '9px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(level.bidVol.toFixed(0), x - width/4, priceY + 3);
                        ctx.fillText(level.askVol.toFixed(0), x + width/4, priceY + 3);
                    }
                }
            }
        }
        hitTest() { return null; }
    }

    class FootprintSeries extends LightweightCharts.CustomSeries {
        constructor() { super(); this._data = []; }
        static defaultOptions() { return {}; }
        renderer() { return new FootprintRenderer(); }
        update(data) { this._data = data; }
        data() { return this._data; }
    }
    return FootprintSeries;
}

// ---------- Данные ----------
async function loadHistoricalData() {
    const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=30`);
    const klines = await res.json();
    historicalCandles = klines.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]),
        bidVol: 0, askVol: 0, levels: []
    }));
    footprintSeries.setData(historicalCandles);
    chart.timeScale().fitContent();
}

function connectWebSocket() {
    ws = new WebSocket(`${BINANCE_WS}/btcusdt@aggTrade`);
    ws.onopen = () => statusEl.textContent = '🟢 Онлайн';
    ws.onclose = () => { statusEl.textContent = '🔴 Офлайн. Переподключение...'; setTimeout(connectWebSocket, 3000); };
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.e === 'aggTrade') processTrade(msg);
    };
}

function processTrade(t) {
    const price = parseFloat(t.p);
    const qty = parseFloat(t.q);
    const isAsk = t.m; // true = продажа
    const tradeTime = t.T;
    const openTime = Math.floor(tradeTime / TIMEFRAME_MS) * TIMEFRAME_MS;

    if (currentCandle && currentCandle.openTime === openTime) {
        updateCandle(currentCandle, price, qty, isAsk);
    } else {
        if (currentCandle) finalizeCandle(currentCandle);
        currentCandle = createCandle(openTime, price, qty, isAsk);
    }
    updateChart();
}

function createCandle(openTime, price, qty, isAsk) {
    const c = {
        openTime, time: Math.floor(openTime / 1000),
        open: price, high: price, low: price, close: price,
        bidVol: 0, askVol: 0, levels: new Map()
    };
    updateCandle(c, price, qty, isAsk);
    return c;
}

function updateCandle(c, price, qty, isAsk) {
    c.high = Math.max(c.high, price);
    c.low = Math.min(c.low, price);
    c.close = price;
    const levelPrice = Math.round(price * 100) / 100;
    if (!c.levels.has(levelPrice)) c.levels.set(levelPrice, { bidVol: 0, askVol: 0 });
    const lvl = c.levels.get(levelPrice);
    if (isAsk) { lvl.askVol += qty; c.askVol += qty; }
    else { lvl.bidVol += qty; c.bidVol += qty; }
}

function finalizeCandle(c) {
    const levels = Array.from(c.levels.entries()).map(([price, vol]) => ({ price, bidVol: vol.bidVol, askVol: vol.askVol }));
    levels.sort((a,b) => b.price - a.price);
    const finalized = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, bidVol: c.bidVol, askVol: c.askVol, levels };
    const idx = historicalCandles.findIndex(v => v.time === finalized.time);
    if (idx !== -1) historicalCandles[idx] = finalized;
    else { historicalCandles.push(finalized); if (historicalCandles.length > 200) historicalCandles.shift(); }
}

function updateChart() {
    if (historicalCandles.length) footprintSeries.setData(historicalCandles);
}

init();
