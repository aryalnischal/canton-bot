/**
 * ═══════════════════════════════════════════════════════════════
 *  A/B BACKTEST: Fixed TP vs Adaptive TP
 * ═══════════════════════════════════════════════════════════════
 * 
 * Replays historical candle data and simulates trades with both
 * the old fixed TP strategy and the new adaptive TP strategy.
 * 
 * Uses a simple momentum signal (RSI oversold/overbought) to 
 * generate entries, then compares exit performance.
 * 
 * Usage:  npx tsx scripts/tp-backtest.ts
 */

import { Network, IndexerClient } from '@dydxprotocol/v4-client-js';
import { getAdaptiveTpConfig, type AdaptiveTpConfig } from '../src/lib/adaptive-tp';

// ═══════ CONFIG ═══════
const LEVERAGE = 3;
const INITIAL_CAPITAL = 1000;
const POSITION_SIZE_PCT = 0.20; // 20% of capital per trade
const CANDLE_RESOLUTION = '15MINS';
const RSI_PERIOD = 14;
const RSI_LONG = 35;   // Enter long when RSI < 35
const RSI_SHORT = 65;  // Enter short when RSI > 65

// Assets to test: one from each tier
const TEST_ASSETS = [
    { symbol: 'BTC-USD', label: 'BTC (Major)' },
    { symbol: 'ETH-USD', label: 'ETH (Major)' },
    { symbol: 'TIA-USD', label: 'TIA (Mid-Cap)' },
    { symbol: 'SEI-USD', label: 'SEI (Mid-Cap)' },
    { symbol: 'PEPE-USD', label: 'PEPE (High-Vol)' },
    { symbol: 'SHIB-USD', label: 'SHIB (High-Vol)' },
];

// Time periods to test
const TEST_PERIODS = [
    { label: '7 days', hours: 7 * 24 },
    { label: '30 days', hours: 30 * 24 },
];

// Old fixed TP config (what we had before)
const OLD_FIXED_CONFIG = {
    layers: [
        { pct: 0.25, gain: 0.0075 },  // TP1: +0.75%
        { pct: 0.25, gain: 0.015 },   // TP2: +1.5%
        { pct: 0.50, gain: 0.03 },    // TP3: +3.0%
    ],
    roeTP1: 14,
    roeTP2: 40,
    trailActivation: 1.50,
    trailPercent: 0.40,
    slPercent: 0.08,
};

// ═══════ TYPES ═══════
interface Candle { t: number; o: number; h: number; l: number; c: number; }
interface Trade {
    entry: number; exit: number; pnlPct: number; isLong: boolean;
    exitReason: string; durationBars: number;
}
interface StrategyResult {
    strategy: string;
    trades: Trade[];
    totalPnlPct: number;
    winRate: number;
    avgWinPct: number;
    avgLossPct: number;
    maxDrawdownPct: number;
    profitFactor: number;
}

// ═══════ ANSI ═══════
const B = '\x1b[1m'; const C = '\x1b[36m'; const G = '\x1b[32m';
const R = '\x1b[31m'; const Y = '\x1b[33m'; const D = '\x1b[2m';
const X = '\x1b[0m';

// ═══════ MAIN ═══════
async function main() {
    console.log(`\n${B}${C}═══════════════════════════════════════════════════════════${X}`);
    console.log(`${B}${C}   A/B BACKTEST: Fixed TP vs Adaptive TP                   ${X}`);
    console.log(`${B}${C}═══════════════════════════════════════════════════════════${X}\n`);

    const networkConfig = process.env.DYDX_NETWORK === 'mainnet' ? Network.mainnet() : Network.testnet();
    const indexer = new IndexerClient(networkConfig.indexerConfig);

    const allResults: { asset: string; period: string; fixed: StrategyResult; adaptive: StrategyResult }[] = [];

    for (const asset of TEST_ASSETS) {
        console.log(`\n${B}${C}━━━ ${asset.label} ━━━${X}`);

        for (const period of TEST_PERIODS) {
            console.log(`${D}  Fetching ${period.label} of 15-min candles...${X}`);
            const candles = await fetchCandles(indexer, asset.symbol, period.hours);
            if (candles.length < 100) {
                console.log(`${Y}  Insufficient data (${candles.length} candles), skipping${X}`);
                continue;
            }
            console.log(`${D}  Got ${candles.length} candles${X}`);

            // Get adaptive config for this asset using the candle data
            const adaptiveConfig = getAdaptiveTpConfig(asset.symbol, candles.map(c => ({ c: c.c, h: c.h, l: c.l })));

            // Run both strategies on same data
            const fixedResult = simulateTrades(candles, 'Fixed TP', {
                ...OLD_FIXED_CONFIG,
                maxHoldBars: 48, // Old bot had implicit ~12h timeout for ALL assets
            }, asset.symbol);
            const adaptiveResult = simulateTrades(candles, `Adaptive [${adaptiveConfig.tier}]`, {
                layers: adaptiveConfig.layers,
                roeTP1: adaptiveConfig.roeTP1,
                roeTP2: adaptiveConfig.roeTP2,
                trailActivation: adaptiveConfig.trailActivation,
                trailPercent: adaptiveConfig.trailPercent,
                slPercent: 0.08,
                maxHoldBars: adaptiveConfig.maxHoldBars, // Tier-specific hold time
            }, asset.symbol);

            allResults.push({ asset: asset.label, period: period.label, fixed: fixedResult, adaptive: adaptiveResult });

            // Print per-asset result
            printComparison(asset.label, period.label, fixedResult, adaptiveResult);
        }
    }

    // Final summary table
    printSummaryTable(allResults);
}

// ═══════ SIMULATION ENGINE ═══════

function simulateTrades(
    candles: Candle[],
    strategyName: string,
    config: {
        layers: { pct: number; gain: number }[];
        roeTP1: number; roeTP2: number;
        trailActivation: number; trailPercent: number; slPercent: number;
        maxHoldBars: number;
    },
    symbol: string
): StrategyResult {
    const trades: Trade[] = [];
    const rsiValues = computeRSI(candles, RSI_PERIOD);

    let inPosition = false;
    let isLong = false;
    let entryPrice = 0;
    let entryBar = 0;
    let remainingSize = 1.0; // Fraction of position still open
    let peakPnl = 0;
    let layersClosed = [false, false, false];
    let partialPnl = 0; // Accumulated PnL from partial closes

    for (let i = RSI_PERIOD + 1; i < candles.length; i++) {
        const c = candles[i];
        const rsi = rsiValues[i];
        if (rsi === undefined) continue;

        if (!inPosition) {
            // ENTRY SIGNALS
            if (rsi < RSI_LONG) {
                inPosition = true; isLong = true;
                entryPrice = c.c; entryBar = i;
                remainingSize = 1.0; peakPnl = 0;
                layersClosed = [false, false, false];
                partialPnl = 0;
            } else if (rsi > RSI_SHORT) {
                inPosition = true; isLong = false;
                entryPrice = c.c; entryBar = i;
                remainingSize = 1.0; peakPnl = 0;
                layersClosed = [false, false, false];
                partialPnl = 0;
            }
            continue;
        }

        // Position is open — check exits using candle high/low for intra-bar fills
        const pricePnlPct = isLong
            ? ((c.c - entryPrice) / entryPrice) * 100
            : ((entryPrice - c.c) / entryPrice) * 100;
        const roePct = pricePnlPct * LEVERAGE;

        // Check high/low for TP/SL hits
        const bestPrice = isLong ? c.h : c.l;
        const worstPrice = isLong ? c.l : c.h;
        const bestPnlPct = isLong
            ? ((bestPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - bestPrice) / entryPrice) * 100;
        const worstPnlPct = isLong
            ? ((worstPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - worstPrice) / entryPrice) * 100;

        // 1. STOP LOSS check (always first)
        if (worstPnlPct < -(config.slPercent * 100)) {
            const closePnl = partialPnl + (-(config.slPercent * 100)) * remainingSize;
            trades.push({
                entry: entryPrice, exit: worstPrice, pnlPct: closePnl,
                isLong, exitReason: 'Stop Loss', durationBars: i - entryBar,
            });
            inPosition = false;
            continue;
        }

        // 2. LAYERED TP check (on-chain orders)
        for (let j = 0; j < config.layers.length; j++) {
            if (layersClosed[j]) continue;
            const layer = config.layers[j];
            const tpHitPct = layer.gain * 100;
            if (bestPnlPct >= tpHitPct) {
                partialPnl += tpHitPct * layer.pct;
                remainingSize -= layer.pct;
                layersClosed[j] = true;
            }
        }

        // If all layers closed, position is fully exited
        if (remainingSize <= 0.01) {
            trades.push({
                entry: entryPrice, exit: c.c, pnlPct: partialPnl,
                isLong, exitReason: 'All TPs Hit', durationBars: i - entryBar,
            });
            inPosition = false;
            continue;
        }

        // 3. ROE-based TP check (in-memory, on remaining position)
        if (roePct > config.roeTP2) {
            const closePnl = partialPnl + pricePnlPct * remainingSize;
            trades.push({
                entry: entryPrice, exit: c.c, pnlPct: closePnl,
                isLong, exitReason: `ROE TP2 (${roePct.toFixed(0)}%)`, durationBars: i - entryBar,
            });
            inPosition = false;
            continue;
        }

        // 4. TRAILING STOP check
        if (pricePnlPct > peakPnl) peakPnl = pricePnlPct;
        if (peakPnl >= config.trailActivation) {
            const floor = peakPnl * (1 - config.trailPercent);
            if (pricePnlPct < floor) {
                const closePnl = partialPnl + pricePnlPct * remainingSize;
                trades.push({
                    entry: entryPrice, exit: c.c, pnlPct: closePnl,
                    isLong, exitReason: `Trail Stop (peak ${peakPnl.toFixed(1)}%)`,
                    durationBars: i - entryBar,
                });
                inPosition = false;
                continue;
            }
        }

        // 5. Tier-based max duration exit
        if (i - entryBar > config.maxHoldBars) {
            const closePnl = partialPnl + pricePnlPct * remainingSize;
            trades.push({
                entry: entryPrice, exit: c.c, pnlPct: closePnl,
                isLong, exitReason: 'Max Duration', durationBars: i - entryBar,
            });
            inPosition = false;
            continue;
        }
    }

    // Compute stats
    const wins = trades.filter(t => t.pnlPct > 0);
    const losses = trades.filter(t => t.pnlPct <= 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnlPct, 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnlPct, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));

    // Max drawdown
    let peak = 0, maxDD = 0, cumPnl = 0;
    for (const t of trades) {
        cumPnl += t.pnlPct;
        if (cumPnl > peak) peak = cumPnl;
        const dd = peak - cumPnl;
        if (dd > maxDD) maxDD = dd;
    }

    return {
        strategy: strategyName,
        trades,
        totalPnlPct: totalPnl,
        winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
        avgWinPct: wins.length > 0 ? grossProfit / wins.length : 0,
        avgLossPct: losses.length > 0 ? grossLoss / losses.length : 0,
        maxDrawdownPct: maxDD,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0,
    };
}

// ═══════ DATA FETCHING ═══════

async function fetchCandles(indexer: IndexerClient, symbol: string, totalHours: number): Promise<Candle[]> {
    const all: Candle[] = [];
    const now = new Date();
    let endTime = now.toISOString();
    const startTarget = new Date(now.getTime() - totalHours * 3600 * 1000);
    let attempts = 0;

    while (all.length < totalHours * 4 && attempts < 30) { // 4 candles per hour for 15min
        attempts++;
        try {
            const res = await (indexer as any).markets.getPerpetualMarketCandles(
                symbol, CANDLE_RESOLUTION, undefined, endTime, 100
            );
            if (!res?.candles?.length) break;
            const batch: Candle[] = res.candles.map((c: any) => ({
                t: new Date(c.startedAt).getTime(),
                o: parseFloat(c.open), h: parseFloat(c.high),
                l: parseFloat(c.low), c: parseFloat(c.close),
            }));
            all.push(...batch);
            const oldest = batch.reduce((m, c) => c.t < m ? c.t : m, Infinity);
            if (oldest <= startTarget.getTime()) break;
            endTime = new Date(oldest - 1).toISOString();
            if (batch.length < 100) break;
            await new Promise(r => setTimeout(r, 250));
        } catch (e: any) {
            if (e?.response?.status === 429) await new Promise(r => setTimeout(r, 3000));
            else throw e;
        }
    }

    const seen = new Set<number>();
    return all
        .filter(c => { if (seen.has(c.t)) return false; seen.add(c.t); return c.t >= startTarget.getTime(); })
        .sort((a, b) => a.t - b.t);
}

// ═══════ INDICATORS ═══════

function computeRSI(candles: Candle[], period: number): (number | undefined)[] {
    const rsi: (number | undefined)[] = new Array(candles.length).fill(undefined);
    if (candles.length < period + 1) return rsi;

    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const delta = candles[i].c - candles[i - 1].c;
        if (delta > 0) avgGain += delta; else avgLoss += Math.abs(delta);
    }
    avgGain /= period;
    avgLoss /= period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < candles.length; i++) {
        const delta = candles[i].c - candles[i - 1].c;
        const gain = delta > 0 ? delta : 0;
        const loss = delta < 0 ? Math.abs(delta) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
}

// ═══════ DISPLAY ═══════

function printComparison(asset: string, period: string, fixed: StrategyResult, adaptive: StrategyResult) {
    const better = adaptive.totalPnlPct > fixed.totalPnlPct;
    const diff = adaptive.totalPnlPct - fixed.totalPnlPct;

    console.log(`\n  ${B}${period}${X} (${fixed.trades.length} trades)`);
    console.log(`  ${'─'.repeat(60)}`);
    console.log(`  ${pad('Metric', 20)} ${pad('Fixed TP', 18)} ${pad('Adaptive TP', 18)} ${pad('Δ', 10)}`);
    console.log(`  ${'─'.repeat(60)}`);

    const rows = [
        ['Total PnL%', `${fixed.totalPnlPct.toFixed(2)}%`, `${adaptive.totalPnlPct.toFixed(2)}%`, `${diff > 0 ? '+' : ''}${diff.toFixed(2)}%`],
        ['Win Rate', `${fixed.winRate.toFixed(1)}%`, `${adaptive.winRate.toFixed(1)}%`, ''],
        ['Avg Win', `+${fixed.avgWinPct.toFixed(2)}%`, `+${adaptive.avgWinPct.toFixed(2)}%`, ''],
        ['Avg Loss', `-${fixed.avgLossPct.toFixed(2)}%`, `-${adaptive.avgLossPct.toFixed(2)}%`, ''],
        ['Max DD', `-${fixed.maxDrawdownPct.toFixed(2)}%`, `-${adaptive.maxDrawdownPct.toFixed(2)}%`, ''],
        ['Profit Factor', fixed.profitFactor.toFixed(2), adaptive.profitFactor.toFixed(2), ''],
    ];

    for (const [label, f, a, d] of rows) {
        console.log(`  ${pad(label, 20)} ${pad(f, 18)} ${pad(a, 18)} ${d ? (d.startsWith('+') ? G : R) + d + X : ''}`);
    }
    console.log(`  ${better ? G + '✔ Adaptive WINS' : R + '✘ Fixed WINS'}${X} (${Math.abs(diff).toFixed(2)}% difference)`);
}

function printSummaryTable(results: { asset: string; period: string; fixed: StrategyResult; adaptive: StrategyResult }[]) {
    console.log(`\n${B}${C}═══════════════════════════════════════════════════════════════════════${X}`);
    console.log(`${B}                         FINAL SCORECARD                              ${X}`);
    console.log(`${B}${C}═══════════════════════════════════════════════════════════════════════${X}\n`);

    const header = pad('Asset', 22) + pad('Period', 10) + pad('Fixed PnL', 12) + pad('Adaptive PnL', 14) + pad('Δ', 12) + 'Winner';
    console.log(`${D}${header}${X}`);
    console.log(`${D}${'─'.repeat(header.length)}${X}`);

    let fixedWins = 0, adaptiveWins = 0;
    let totalFixedPnl = 0, totalAdaptivePnl = 0;

    for (const r of results) {
        const diff = r.adaptive.totalPnlPct - r.fixed.totalPnlPct;
        const winner = diff > 0 ? 'Adaptive' : 'Fixed';
        const winColor = diff > 0 ? G : R;
        if (diff > 0) adaptiveWins++; else fixedWins++;
        totalFixedPnl += r.fixed.totalPnlPct;
        totalAdaptivePnl += r.adaptive.totalPnlPct;

        console.log(
            pad(r.asset, 22) +
            pad(r.period, 10) +
            pad(`${r.fixed.totalPnlPct.toFixed(2)}%`, 12) +
            pad(`${r.adaptive.totalPnlPct.toFixed(2)}%`, 14) +
            pad(`${diff > 0 ? '+' : ''}${diff.toFixed(2)}%`, 12) +
            `${winColor}${winner}${X}`
        );
    }

    console.log(`${D}${'─'.repeat(header.length)}${X}`);
    console.log(
        pad(`${B}TOTAL${X}`, 32) +
        pad(`${totalFixedPnl.toFixed(2)}%`, 12) +
        pad(`${totalAdaptivePnl.toFixed(2)}%`, 14) +
        pad(`${totalAdaptivePnl - totalFixedPnl > 0 ? '+' : ''}${(totalAdaptivePnl - totalFixedPnl).toFixed(2)}%`, 12)
    );

    console.log(`\n${B}Score: Fixed ${fixedWins} — Adaptive ${adaptiveWins}${X}`);
    const totalDiff = totalAdaptivePnl - totalFixedPnl;
    if (totalDiff > 0) {
        console.log(`${G}${B}✔ ADAPTIVE TP outperforms by +${totalDiff.toFixed(2)}% across all tests${X}\n`);
    } else if (totalDiff < 0) {
        console.log(`${R}${B}✘ FIXED TP outperforms by +${Math.abs(totalDiff).toFixed(2)}% across all tests${X}\n`);
    } else {
        console.log(`${Y}${B}≈ Both strategies performed equally${X}\n`);
    }
}

function pad(s: string, w: number): string { return s.length >= w ? s : s + ' '.repeat(w - s.length); }

// ═══════ RUN ═══════
main().catch(err => { console.error(`${R}Fatal:${X}`, err); process.exit(1); });
