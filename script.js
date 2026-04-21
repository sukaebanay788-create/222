// Используем API версии 3.8.0
const BINANCE_WS = 'wss://fstream.binance.com/ws';
const BINANCE_API = 'https://fapi.binance.com';

let chart;
let footprintSeries;
let ws;
let currentCandle = null;
let historicalCandles = [];
const TIMEFRAME_MS = 60000; // 1m
let statusEl = document.getElementById('status');

// ----- Инициализация графика -----
function init() {
    chart = LightweightCharts.createChart(document.getElementById('chart'), {
        width: window.innerWidth,
        height: window.innerHeight,
        layout: { backgroundColor: '#0b0e11', textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1e2329' }, horzLines: { color: '#1e2329' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#1e2329' },
        timeScale: { borderColor: '#1e2329', timeVisible: true },
    });

    // Определяем кастомную серию (старый способ через SeriesApi)
    const series = chart.addCandlestickSeries({
        upColor: '#0ecb81', downColor: '#f6465d',
        borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
        wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
    });

    // Мы будем рисовать футпринт поверх свечей через кастомный плагин или примитивы,
    // но для простоты используем подход из демо: заменяем стандартный рендеринг.
    // Однако проще создать overlay-канвас или рисовать в том же контексте.
    // Я упрощу: буду использовать стандартные свечи и добавлять текст объёмов через примитивы.
    // Но чтобы сохранить аутентичность, сделаем кастомную серию через наследование в стиле 3.8.
    // В версии 3.8 можно было расширять Series.
    // К сожалению, прямой пример из демо сложно воспроизвести без React.
    // Поэтому я дам упрощённый, но работающий вариант с отрисовкой текста объёма на свечах.
    
    // Для быстрого теста: подпишемся на aggTrade и будем выводить суммарный объём в консоль.
    // Визуализацию футпринта в этом варианте опустим, чтобы не усложнять.
    // Вместо этого предложу второй вариант ниже.
    
    statusEl.textContent = '⚠️ Используйте Вариант 2 для футпринта';
}
init();
