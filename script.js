// script.js
// Footprint Chart Demo для BTCUSDT (Binance Futures) без React

const BINANCE_WS = 'wss://fstream.binance.com/ws';
const BINANCE_API = 'https://fapi.binance.com';

let chart;
let footprintSeries;
let ws;
let currentCandle = null;
let candles = [];
const timeFrame = 60000; // 1 минута в мс
let lastCandleCloseTime = 0;
let historicalCandles = [];

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

    // Создаем экземпляр нашей кастомной серии
    footprintSeries = chart.addCustomSeries(new FootprintSeries(), {});

    window.addEventListener('resize', () => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });

    loadHistoricalData();
    connectWebSocket();
}

// --- 1. Загрузка исторических данных для начального отображения ---
async function loadHistoricalData() {
    try {
        const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=30`);
        const klines = await res.json();
        // Преобразуем исторические свечи в формат, ожидаемый нашей серией
        historicalCandles = klines.map(k => ({
            time: Math.floor(k[0] / 1000), // время в секундах
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            bidVol: 0, // начальные значения, будут заполнены позже, если понадобится
            askVol: 0,
            levels: []
        }));
        // Находим время последней свечи для корректного старта WebSocket
        if (historicalCandles.length > 0) {
            lastCandleCloseTime = historicalCandles[historicalCandles.length-1].time * 1000;
        }
        footprintSeries.setData(historicalCandles);
        chart.timeScale().fitContent();
    } catch (e) {
        console.error('Ошибка загрузки истории:', e);
    }
}

// --- 2. Подключение к WebSocket и обработка aggTrade ---
function connectWebSocket() {
    ws = new WebSocket(`${BINANCE_WS}/btcusdt@aggTrade`);
    const statusEl = document.getElementById('status');

    ws.onopen = () => { statusEl.textContent = 'Статус: Подключено'; };
    ws.onclose = () => { statusEl.textContent = 'Статус: Отключено. Переподключение...'; setTimeout(connectWebSocket, 3000); };
    ws.onerror = (e) => { console.error('WS error:', e); };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        // Binance aggTrade stream structure
        if (msg.e === 'aggTrade') {
            processTrade(msg);
        }
    };
}

function processTrade(trade) {
    const price = parseFloat(trade.p);
    const quantity = parseFloat(trade.q);
    const isBuyerMaker = trade.m; // true = sell (taker is seller), false = buy (taker is buyer)

    const tradeTime = trade.T; // время сделки в мс
    const candleOpenTime = Math.floor(tradeTime / timeFrame) * timeFrame;

    // Если время сделки соответствует текущей накопленной свече
    if (currentCandle && currentCandle.openTime === candleOpenTime) {
        updateCandleWithTrade(currentCandle, price, quantity, isBuyerMaker);
    } else {
        // Если это новая свеча, закрываем предыдущую (если есть) и создаем новую
        if (currentCandle) {
            finalizeCandle(currentCandle);
        }
        currentCandle = createNewCandle(candleOpenTime, price, quantity, isBuyerMaker);
    }

    // Обновляем график в реальном времени
    updateChart();
}

function createNewCandle(openTime, price, quantity, isBuyerMaker) {
    const candle = {
        openTime: openTime,
        time: Math.floor(openTime / 1000), // время в секундах для lightweight-charts
        open: price,
        high: price,
        low: price,
        close: price,
        bidVol: 0,
        askVol: 0,
        levels: new Map() // price -> { bidVol, askVol }
    };
    updateCandleWithTrade(candle, price, quantity, isBuyerMaker);
    return candle;
}

function updateCandleWithTrade(candle, price, quantity, isMaker) {
    candle.high = Math.max(candle.high, price);
    candle.low = Math.min(candle.low, price);
    candle.close = price;

    const levelPrice = Math.round(price * 100) / 100; // округление до центов
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
    // Преобразуем Map уровней в массив для сериализации
    const levelsArray = Array.from(candle.levels.entries()).map(([price, vol]) => ({
        price, bidVol: vol.bidVol, askVol: vol.askVol
    }));
    // Сортируем уровни по цене (по убыванию)
    levelsArray.sort((a, b) => b.price - a.price);

    // Создаем финальный объект свечи для серии
    const finalizedCandle = {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        bidVol: candle.bidVol,
        askVol: candle.askVol,
        levels: levelsArray
    };

    // Находим индекс в массиве исторических свечей
    const existingIndex = historicalCandles.findIndex(c => c.time === finalizedCandle.time);
    if (existingIndex !== -1) {
        historicalCandles[existingIndex] = finalizedCandle;
    } else {
        historicalCandles.push(finalizedCandle);
        // Ограничим размер для производительности
        if (historicalCandles.length > 100) historicalCandles.shift();
    }
}

function updateChart() {
    if (!historicalCandles.length) return;
    // Обновляем данные серии
    footprintSeries.setData(historicalCandles);
}

// --- 3. Определение кастомной серии (Custom Series) ---
class FootprintSeries {
    constructor() {
        this._data = [];
    }

    // Обязательный метод: возвращаем рендерер
    renderer() {
        return new FootprintRenderer();
    }

    // Обязательный метод: обновление данных
    update(data) {
        this._data = data;
    }

    // Дополнительно можно реализовать priceScale и т.д.
}

// Класс рендерера
class FootprintRenderer {
    draw(target, priceConverter, isHovered, hitTestData) {
        const ctx = target.context;
        const data = this._data;
        if (!data || data.length === 0) return;

        // Используем mediaSize (логические пиксели) для рисования
        ctx.clearRect(0, 0, target.mediaSize.width, target.mediaSize.height);

        const barSpacing = this._barSpacing;
        const visibleRange = this._visibleRange;

        for (let i = visibleRange.from; i < visibleRange.to; i++) {
            const candle = data[i];
            if (!candle) continue;

            const x = i * barSpacing + barSpacing / 2;
            const width = barSpacing * 0.8; // ширина свечи

            const openY = priceConverter(candle.open);
            const closeY = priceConverter(candle.close);
            const highY = priceConverter(candle.high);
            const lowY = priceConverter(candle.low);

            // Рисуем тень свечи
            ctx.beginPath();
            ctx.strokeStyle = candle.close >= candle.open ? '#0ecb81' : '#f6465d';
            ctx.lineWidth = 1;
            ctx.moveTo(x, highY);
            ctx.lineTo(x, lowY);
            ctx.stroke();

            // Рисуем тело свечи
            ctx.fillStyle = candle.close >= candle.open ? '#0ecb81' : '#f6465d';
            ctx.fillRect(x - width/2, Math.min(openY, closeY), width, Math.abs(openY - closeY));

            // --- Рисуем футпринт (ячейки с объемами) внутри свечи ---
            if (candle.levels && candle.levels.length) {
                const maxVol = Math.max(...candle.levels.map(l => Math.max(l.bidVol, l.askVol)));
                const cellHeight = 12; // фиксированная высота ячейки

                for (const level of candle.levels) {
                    const priceY = priceConverter(level.price);
                    if (priceY === null) continue;

                    // Рисуем фон уровня
                    ctx.fillStyle = '#1e2329';
                    ctx.fillRect(x - width/2, priceY - cellHeight/2, width, cellHeight);

                    // Рисуем объем Bid (покупки) - левая половина
                    if (level.bidVol > 0) {
                        const bidWidth = (level.bidVol / maxVol) * (width / 2);
                        ctx.fillStyle = '#0ecb81';
                        ctx.fillRect(x - width/2, priceY - cellHeight/2, bidWidth, cellHeight);
                    }

                    // Рисуем объем Ask (продажи) - правая половина
                    if (level.askVol > 0) {
                        const askWidth = (level.askVol / maxVol) * (width / 2);
                        ctx.fillStyle = '#f6465d';
                        ctx.fillRect(x, priceY - cellHeight/2, askWidth, cellHeight);
                    }

                    // Рисуем разделительную линию
                    ctx.beginPath();
                    ctx.strokeStyle = '#2b3139';
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(x, priceY - cellHeight/2);
                    ctx.lineTo(x, priceY + cellHeight/2);
                    ctx.stroke();

                    // Подпись объема
                    ctx.fillStyle = '#d1d4dc';
                    ctx.font = '9px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(level.bidVol.toFixed(0), x - width/4, priceY + 3);
                    ctx.fillText(level.askVol.toFixed(0), x + width/4, priceY + 3);
                }
            }
        }
    }

    // Метод для получения данных о хит-тесте (не обязательно для MVP)
    hitTest(x, y, data) { return null; }
}

// Запуск
init();
