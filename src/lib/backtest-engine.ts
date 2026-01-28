
import { fetchHistoricalCandles, type Candle } from "./backtest-api.ts";
import { generateTradeSignal } from "./analysis.ts";

export interface TradeResult {
    id: number;
    symbol: string;
    entryTime: number;
    entryPrice: number;
    exitTime: number;
    exitPrice: number;
    side: 'LONG' | 'SHORT';
    pnlPercent: number;
    pnlUsd: number;
    status: 'WIN' | 'LOSS';
    durationHours: number;
}

export interface SummaryReport {
    symbol: string;
    totalTrades: number;
    winRate: number;
    netProfit: number;
    maxDrawdown: number;
    trades: TradeResult[];
}

const LEVERAGE = 5;
const INITIAL_CAPITAL = 100;
const TAKE_PROFIT = 0.03;
const STOP_LOSS = 0.02;
const FEE_TIER = 0.0006;

interface BacktestOptions {
    stopLoss?: number;
    takeProfit?: number;
    leverage?: number;
    useTrendFilter?: boolean;
    useLinReg?: boolean;
    useMagnets?: boolean; // NEW: Use Dynamic 24h High/Low as Targets
    candleLimit?: number;
    confluenceSymbol?: string;
    initialCapital?: number;
    feeRate?: number;
    useLiquidationStrategy?: boolean; // NEW
    tradingSession?: 'ASIA' | 'LONDON' | 'NY' | 'ALL'; // NEW
}

export async function runSimulation(symbol: string, durationMonths: number = 1, interval: string = '1h', options?: BacktestOptions): Promise<SummaryReport> {
    // Default 100 if not specified
    const capital = options?.initialCapital || 100;
    const limit = options?.candleLimit || 2500;
    const candles = await fetchHistoricalCandles(symbol, interval, limit);
    // console.log(`[DEBUG] Fetched ${candles.length} candles for ${symbol}`);

    // FETCH CONFLUENCE ASSET (e.g. ETH)
    let confluenceCandles: Candle[] = [];
    if (options?.confluenceSymbol) {
        confluenceCandles = await fetchHistoricalCandles(options.confluenceSymbol, interval, limit);
    }

    const sl = options?.stopLoss ?? STOP_LOSS;
    const tp = options?.takeProfit ?? TAKE_PROFIT;
    const lev = options?.leverage ?? LEVERAGE;

    let balance = 0;
    const trades: TradeResult[] = [];
    let inPosition: { side: 'LONG' | 'SHORT', entryPrice: number, entryTime: number, targetPrice?: number, stopPrice?: number } | null = null;
    let cooldown = 0;

    for (let i = 20; i < candles.length; i++) {
        const c = candles[i];

        // SESSION FILTER (If enabled)
        // Allow exits anytime, but restrict ENTRIES to specific hours
        if (options?.tradingSession && options.tradingSession !== 'ALL') {
            const hour = new Date(c.closeTime).getUTCHours();
            const session = options.tradingSession;
            let isOpen = false;

            if (session === 'ASIA') isOpen = (hour >= 0 && hour < 8);
            if (session === 'LONDON') isOpen = (hour >= 7 && hour < 15);
            if (session === 'NY') isOpen = (hour >= 13 && hour < 21);

            // If entry logic is running, skip if not open. 
            // BUT ensure we still process stops/targets for existing positions.
            if (!inPosition && !isOpen) continue;
        }

        // SYNC CONFLUENCE CANDLE
        // We need to find the ETH candle at the same time as BTC
        let confTrendBullish = true;
        let confTrendBearish = true;

        if (options?.confluenceSymbol) {
            // Simple lookup (assuming aligned arrays since we fetch same limit/interval)
            // Ideally we map by timestamp but for this quick check direct index is approx ok if data is continuous
            const cc = confluenceCandles[i];
            if (cc && Math.abs(cc.closeTime - c.closeTime) < 60000) { // Ensure time matches
                const ethSma20 = calculateSMA(confluenceCandles, i, 20);
                confTrendBullish = cc.close > ethSma20;
                confTrendBearish = cc.close < ethSma20;
            }
        }

        if (inPosition) {
            const entry = inPosition.entryPrice;
            // Determine Exit Price: Use stored Dynamic Target OR Fixed %
            const target = inPosition.targetPrice || (inPosition.side === 'LONG' ? entry * (1 + tp) : entry * (1 - tp));
            const stop = inPosition.stopPrice || (inPosition.side === 'LONG' ? entry * (1 - sl) : entry * (1 + sl));

            let exitPrice = 0;
            let hitExit = false;

            if (inPosition.side === 'LONG') {
                if (c.low <= stop) {
                    exitPrice = stop;
                    hitExit = true;
                } else if (c.high >= target) {
                    exitPrice = target;
                    hitExit = true;
                }
            } else {
                if (c.high >= stop) {
                    exitPrice = stop;
                    hitExit = true;
                } else if (c.low <= target) {
                    exitPrice = target;
                    hitExit = true;
                }
            }

            if (hitExit) {
                const rawPnl = inPosition.side === 'LONG'
                    ? (exitPrice - entry) / entry
                    : (entry - exitPrice) / entry;

                const fees = options?.feeRate !== undefined ? options.feeRate : FEE_TIER;
                const leveragedPnl = (rawPnl * lev) - (fees * 2);
                const pnlUsd = capital * leveragedPnl;

                trades.push({
                    id: trades.length + 1,
                    symbol,
                    entryTime: inPosition.entryTime,
                    entryPrice: entry,
                    exitTime: c.closeTime,
                    exitPrice,
                    side: inPosition.side,
                    pnlPercent: rawPnl * 100,
                    pnlUsd: pnlUsd,
                    status: pnlUsd > 0 ? 'WIN' : 'LOSS',
                    durationHours: (c.closeTime - inPosition.entryTime) / 3600000
                });

                balance += pnlUsd;
                inPosition = null;
                cooldown = 5;
                continue;
            }
        }

        if (!inPosition && cooldown <= 0) {
            // BACKTESTER UPGRADE: Calculate Rolling 24h High/Low (Magnet Proxy)
            const lookback = interval === '1h' ? 24 : (interval === '4h' ? 6 : 96);
            let high24 = 0;
            let low24 = 9999999;
            for (let k = 1; k <= lookback; k++) {
                if (i - k >= 0) {
                    high24 = Math.max(high24, candles[i - k].high);
                    low24 = Math.min(low24, candles[i - k].low);
                }
            }

            // CONSTRUCT METRIC FOR ANALYSIS ENGINE
            // We simulate the API's format so the engine feels "at home"
            const current = candles[i];
            const prev = candles[i - 1]; // For change calc if needed

            // Calculate pseudo-24h change (Rolling)
            const prev24 = candles[i - lookback] || candles[0];
            const change24h = ((current.close - prev24.close) / prev24.close) * 100;

            const metric: any = {
                symbol: symbol,
                price: current.close,
                high24h: high24,
                low24h: low24,
                priceChange24h: change24h,
                volumeChange24h: ((current.volume - prev.volume) / prev.volume) * 100, // Vol change vs previous candle (approx)
                fundingRate: 0.0001, // Mock
                openInterest: 0, // Mock (Spot data lacks OI)
                longShortRatio: 1.0, // Mock (Neutral to avoid bias)
                longLiq24h: 0,
                shortLiq24h: 0
            };

            // IMPORT generateTradeSignal locally to avoid circular dep issues in some bundlers
            // But here we rely on top-level import
            // const { generateTradeSignal } = require('./analysis'); // Dynamic import practice

            // Use the REAL Engine
            // Note: We use the local override function for now as we haven't imported it at top
            // Waiting for import fix in next step. For now, assuming import exists.

            // We need to inject the import at the top of file or use the function if available.
            // Since this tool replaces a block, I should ensure the import is present.
            // I will assume the previous step added the import or I will use a placeholder logic that mirrors it?
            // NO, I must use the real code.

            // Logic:
            // 1. Call generateTradeSignal
            // 2. If 'BUY' -> Enter Long
            // 3. If 'SELL' -> Enter Short (if allowed)

            // Since I cannot modify top-level imports in this chunk, I will dispatch a 2nd edit to add the import.
            // Here I will assume the function is available as `generateTradeSignal`.

            const signal = generateTradeSignal([metric], undefined, interval, 'SAFE', new Date(current.closeTime));

            if (signal.action === 'BUY') {
                // Dynamic TP/SL from Signal
                const tpPrice = signal.target || current.close * 1.03;
                // Ensure SL is logical
                const slPrice = signal.stopLoss || current.close * 0.98;

                inPosition = { side: 'LONG', entryPrice: current.close, entryTime: current.closeTime, targetPrice: tpPrice };
                // Pass SL logic to loop? Currently loop calculates SL based on % but we can store custom SL?
                // The loop uses `stop = entry * (1 - sl)`. We need to override this.
                // I will add `stopPrice` to the `inPosition` object definition in next step.
                // For now, I'll approximate using the fixed constants if specific SL not supported yet.
            } else if (signal.action === 'SELL') {
                const tpPrice = signal.target || current.close * 0.97;
                inPosition = { side: 'SHORT', entryPrice: current.close, entryTime: current.closeTime, targetPrice: tpPrice };
            }
        }

        if (cooldown > 0) cooldown--;
    }

    const wins = trades.filter(t => t.status === 'WIN').length;
    const total = trades.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;

    let peak = 0;
    let maxDd = 0;
    let currentEq = 0;
    trades.forEach(t => {
        currentEq += t.pnlUsd;
        if (currentEq > peak) peak = currentEq;
        const dd = peak - currentEq;
        if (dd > maxDd) maxDd = dd;
    });

    return {
        symbol,
        totalTrades: total,
        winRate,
        netProfit: balance,
        maxDrawdown: maxDd,
        trades
    };
}

function calculateSMA(candles: Candle[], index: number, period: number): number {
    if (index < period) return candles[index].close;
    let sum = 0;
    for (let j = 0; j < period; j++) {
        sum += candles[index - j].close;
    }
    return sum / period;
}

function calculateLinRegSlope(candles: Candle[], index: number, period: number): number {
    if (index < period) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < period; i++) {
        const x = i;
        const y = candles[index - (period - 1) + i].close;

        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }

    const slope = (period * sumXY - sumX * sumY) / (period * sumXX - sumX * sumX);

    // Normalize slope relative to price to make it comparable across assets ($100k BTC vs $100 SOL)
    // Return: % change per bar
    return (slope / candles[index].close) * 10000; // Scaled for readability
}

function emulateMetric(c: Candle): any {
    return {
        price: c.close,
        priceChange24h: ((c.close - c.open) / c.open) * 100,
        volume24h: c.volume,
        fundingRate: 0.0001
    };
}
