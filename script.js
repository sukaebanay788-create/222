// Footprint Chart Demo для BTCUSDT (Binance Futures) – полностью исправленная кастомная серия
const BINANCE_WS = 'wss://fstream.binance.com/ws';
const BINANCE_API = 'https://fapi.binance.com';

let chart;
let footprintSeries;
let ws;
let currentCandle = null;
let historicalCandles = [];
const TIMEFRAME_MS = 60000; // 1 минута
let statusEl = document.getElementById('status');

// --- Инициализация ---
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

    // Создаём кастомную серию
    const FootprintSeriesClass = createFootprintSeriesClass();
    footprintSeries = chart.addCustomSeries(FootprintSeriesClass, {
        priceScaleId: 'right',
    });

    window.addEventListener('resize', () => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });

    loadHistoricalData().then(() => {
        connectWebSocket();
    });
}

// --- Фабрика класса кастомной серии ---
function createFootprintSeriesClass() {
    // Определяем рендерер отдельно
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

                // Тело свечи
                ctx.fillStyle = candle.close >= candle.open ? '#0ecb81' : '#f6465d';
                ctx.fillRect(x - width/2, Math.min(openY, closeY), width, Math.abs(openY - closeY));

                // Футпринт-ячейки
                if (candle.levels && candle.levels.length) {
                    const maxVol = Math.max(...candle.levels.map(l => Math.max(l.bidVol, l.askVol)), 0.001);
                    const cellHeight = 12;

                    for (const level of candle.levels) {
                        const priceY = priceConverter(level.price);
                        if (priceY === null) continue;

                        // Фон
                        ctx.fillStyle = '#1e2329';
                        ctx.fillRect(x - width/2, priceY - cellHeight/2, width, cellHeight);

                        // Bid (левая половина)
                        if (level.bidVol > 0) {
                            const bidWidth = (level.bidVol / maxVol) * (width / 2);
                            ctx.fillStyle = '#0ecb81';
                            ctx.fillRect(x - width/2, priceY - cellHeight/2, bidWidth, cellHeight);
                        }

                        // Ask (правая половина)
                        if (level.askVol > 0) {
                            const askWidth = (level.askVol / maxVol) * (width / 2);
                            ctx.fillStyle = '#f6465d';
                            ctx.fillRect(x, priceY - cellHeight/2, askWidth, cellHeight);
                        }

                        // Разделитель
                        ctx.beginPath();
                        ctx.strokeStyle = '#2b3139';
                        ctx.lineWidth = 0.5;
                        ctx.moveTo(x, priceY - cellHeight/2);
                        ctx.lineTo(x, priceY + cellHeight/2);
                        ctx.stroke();

                        // Текст объёмов
                        ctx.fillStyle = '#d1d4dc';
                        ctx.font = '9px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(level.bidVol.toFixed(0), x - width/4, priceY + 3);
                        ctx.fillText(level.askVol.toFixed(0), x + width/4, priceY + 3);
                    }
                }
            }
        }

        hitTest(x, y, data) {
            return null; // не реализуем для простоты
        }
    }

    // Определяем класс серии с правильным наследованием
    class FootprintSeries extends LightweightCharts.CustomSeries {
        constructor() {
            super();
            this._data = [];
        }

        // Статический метод с настройками по умолчанию (ОБЯЗАТЕЛЕН!)
        static defaultOptions() {
            return {
                // Можно указать свои параметры, но достаточно пустого объекта
            };
        }

        renderer() {
            return new FootprintRenderer();
        }

        update(data) {
            this._data = data;
        }

        data() {
            return this._data;
        }
    }

    return FootprintSeries;
}

// --- 1. Загрузка исторических свечей ---
async function loadHistoricalData() {
    try {
        const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=30`);
        const klines = await res.json();
        historicalCandles = klines.map(k => ({
            time: Math.floor(k[0] / 1000),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            bidVol: 0,
            askVol: 0,
            levels: []
        }));
        if (historicalCandles.length > 0) {
            const lastCandle = historicalCandles[historicalCandles.length - 1];
            lastCandleOpenTime = lastCandle.time * 1000;
        }
        footprintSeries.setData(historicalCandles);
        chart.timeScale().fitContent();
    } catch (e) {
        console.error('Ошибка загрузки истории:', e);
    }
}

// --- 2. WebSocket и обработка aggTrade ---
function connectWebSocket() {
    ws = new WebSocket(`${BINANCE_WS}/btcusdt@aggTrade`);
    ws.onopen = () => { statusEl.textContent = '🟢 Онлайн'; };
    ws.onclose = () => { statusEl.textContent = '🔴 Офлайн. Переподключение...'; setTimeout(connectWebSocket, 3000); };
    ws.onerror = (e) => { console.error('WS error:', e); };
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.e === 'aggTrade') {
            processTrade(msg);
        }
    };
}

function processTrade(trade) {
    const price = parseFloat(trade.p);
    const quantity = parseFloat(trade.q);
    const isBuyerMaker = trade.m; // true = ask (продажа), false = bid (покупка)
    const tradeTime = trade.T;
    const candleOpenTime = Math.floor(tradeTime / TIMEFRAME_MS) * TIMEFRAME_MS;

    if (currentCandle && currentCandle.openTime === candleOpenTime) {
        updateCandleWithTrade(currentCandle, price, quantity, isBuyerMaker);
    } else {
        if (currentCandle) {
            finalizeCandle(currentCandle);
        }
        currentCandle = createNewCandle(candleOpenTime, price, quantity, isBuyerMaker);
    }
    updateChart();
}

function createNewCandle(openTime, price, quantity, isBuyerMaker) {
    const candle = {
        openTime: openTime,
        time: Math.floor(openTime / 1000),
        open: price,
        high: price,
        low: price,
        close: price,
        bidVol: 0,
        askVol: 0,
        levels: new Map()
    };
    updateCandleWithTrade(candle, price, quantity, isBuyerMaker);
    return candle;
}

function updateCandleWithTrade(candle, price, quantity, isMaker) {
    candle.high = Math.max(candle.high, price);
    candle.low = Math.min(candle.low, price);
    candle.close = price;

    const levelPrice = Math.round(price * 100) / 100;
    if (!candle.levels.has(levelPrice)) {
        candle.levels.set(levelPrice, { bidVol: 0, askVol: 0 });
    }
    const level = candle.levels.get(levelPrice);
    if (isMaker) {
        level.askVol += quantity;
        candle.askVol += quantity;
    } else {
        level.bidVol += quantity;
        candle.bidVol += quantity;
    }
}

function finalizeCandle(candle) {
    const levelsArray = Array.from(candle.levels.entries()).map(([price, vol]) => ({
        price, bidVol: vol.bidVol, askVol: vol.askVol
    }));
    levelsArray.sort((a, b) => b.price - a.price);

    const finalized = {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        bidVol: candle.bidVol,
        askVol: candle.askVol,
        levels: levelsArray
    };

    const idx = historicalCandles.findIndex(c => c.time === finalized.time);
    if (idx !== -1) {
        historicalCandles[idx] = finalized;
    } else {
        historicalCandles.push(finalized);
        if (historicalCandles.length > 200) historicalCandles.shift();
    }
}

function updateChart() {
    if (historicalCandles.length === 0) return;
    footprintSeries.setData(historicalCandles);
}

// Старт
init();
