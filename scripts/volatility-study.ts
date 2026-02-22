
/**
 * ═══════════════════════════════════════════════════════════════════
 *  VOLATILITY STUDY — Asset Classification for Adaptive Take Profit
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Fetches 1H candle data from dYdX indexer for all top markets,
 * computes volatility metrics across 7d/30d/90d, and classifies
 * each asset into a volatility tier for adaptive TP calibration.
 * 
 * Usage:  npx tsx scripts/volatility-study.ts
 */

import { Network, IndexerClient } from '@dydxprotocol/v4-client-js';
import * as fs from 'fs';
import * as path from 'path';

// ═══════ CONFIG ═══════
const TIMEFRAMES = [
    { label: '7d', hours: 7 * 24 },
    { label: '30d', hours: 30 * 24 },
    { label: '90d', hours: 90 * 24 },
];
const CANDLE_RESOLUTION = '1HOUR';  // 1-hour candles
const BATCH_SIZE = 100;             // dYdX max per request

// ═══════ TYPES ═══════
interface CandleData {
    t: number;   // timestamp
    o: number;   // open
    h: number;   // high
    l: number;   // low
    c: number;   // close
    v: number;   // volume (base token)
}

interface AssetMetrics {
    symbol: string;
    price: number;
    volume24hUsd: number;
    timeframe: string;
    candleCount: number;
    // Core Volatility
    atrPercent: number;           // ATR as % of price
    dailyRangePercent: number;    // avg (H-L)/C per day
    stdDevReturns: number;        // std dev of hourly returns
    // Extremes
    maxUpCandle: number;          // largest single-candle up move %
    maxDownCandle: number;        // largest single-candle down move %
    // Rally / Drawdown Analysis
    avgRallyPercent: number;      // avg magnitude of upswings before reversal
    avgDrawdownPercent: number;   // avg magnitude of downswings before reversal
    maxRallyPercent: number;      // biggest rally
    maxDrawdownPercent: number;   // biggest drawdown
    // Volume
    avgHourlyVolumeUsd: number;
}

interface AssetProfile {
    symbol: string;
    price: number;
    volume24hUsd: number;
    tier: 'MAJOR' | 'MID_CAP' | 'HIGH_VOL';
    metrics: Record<string, AssetMetrics>;  // keyed by timeframe label
}

// ═══════ ANSI COLORS ═══════
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ═══════ MAIN ═══════
async function main() {
    console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}${CYAN}   VOLATILITY STUDY — Asset TP Calibration Tool    ${RESET}`);
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}\n`);

    const networkConfig = process.env.DYDX_NETWORK === 'mainnet' ? Network.mainnet() : Network.testnet();
    const indexer = new IndexerClient(networkConfig.indexerConfig);

    // 1. Discover markets (same logic as scanner.ts)
    console.log(`${DIM}[1/4] Fetching market list...${RESET}`);
    const response = await indexer.markets.getPerpetualMarkets();
    const markets = response.markets;
    const marketKeys = Object.keys(markets).filter(k =>
        k.endsWith('USD') &&
        !k.includes(',') &&
        !k.includes('0x') &&
        !k.includes('prediction')
    );

    // Select top by volume + OI (same as scanner)
    const sortedByVol = [...marketKeys].sort((a, b) =>
        parseFloat(markets[b].volume24H || '0') - parseFloat(markets[a].volume24H || '0')
    );
    const volumeTargets = sortedByVol.slice(0, 10);

    const sortedByOI = [...marketKeys].sort((a, b) => {
        const oiA = parseFloat(markets[a].openInterest || '0') * parseFloat(markets[a].oraclePrice || '0');
        const oiB = parseFloat(markets[b].openInterest || '0') * parseFloat(markets[b].oraclePrice || '0');
        return oiB - oiA;
    });
    const oiTargets = sortedByOI.slice(0, 5);

    const targets = Array.from(new Set([...volumeTargets, ...oiTargets]));
    console.log(`${GREEN}Found ${targets.length} target assets:${RESET} ${targets.join(', ')}\n`);

    // 2. Fetch candles and compute metrics
    console.log(`${DIM}[2/4] Fetching candle data (this may take 1-2 minutes)...${RESET}\n`);
    const profiles: AssetProfile[] = [];

    for (const symbol of targets) {
        const price = parseFloat(markets[symbol].oraclePrice || '0');
        const vol24h = parseFloat(markets[symbol].volume24H || '0');
        const vol24hUsd = vol24h; // dYdX reports volume24H in USD already

        console.log(`  ${CYAN}▸ ${symbol}${RESET} ($${price.toFixed(2)}, Vol: $${formatNum(vol24hUsd)})`);

        const metricsMap: Record<string, AssetMetrics> = {};

        for (const tf of TIMEFRAMES) {
            try {
                const candles = await fetchCandles(indexer, symbol, tf.hours);
                if (candles.length < 24) {
                    console.log(`    ${YELLOW}${tf.label}: Insufficient data (${candles.length} candles)${RESET}`);
                    continue;
                }
                const m = computeMetrics(symbol, price, vol24hUsd, tf.label, candles);
                metricsMap[tf.label] = m;
                console.log(`    ${DIM}${tf.label}: ATR=${(m.atrPercent * 100).toFixed(2)}% | Range=${(m.dailyRangePercent * 100).toFixed(2)}% | Rally=${(m.avgRallyPercent * 100).toFixed(2)}% | DD=${(m.avgDrawdownPercent * 100).toFixed(2)}%${RESET}`);
            } catch (e: any) {
                console.log(`    ${RED}${tf.label}: Error — ${e.message}${RESET}`);
            }
        }

        // Classify based on 30d ATR% (or 7d fallback)
        const ref = metricsMap['30d'] || metricsMap['7d'];
        let tier: 'MAJOR' | 'MID_CAP' | 'HIGH_VOL' = 'MID_CAP';
        if (ref) {
            if (ref.atrPercent < 0.02) tier = 'MAJOR';
            else if (ref.atrPercent >= 0.04) tier = 'HIGH_VOL';
        }

        profiles.push({ symbol, price, volume24hUsd: vol24hUsd, tier, metrics: metricsMap });
    }

    // 3. Print summary table
    console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}                           VOLATILITY CLASSIFICATION REPORT                          ${RESET}`);
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════════════${RESET}\n`);

    printTierTable('MAJOR', 'Tier 1 — Majors (ATR% < 2%)', profiles);
    printTierTable('MID_CAP', 'Tier 2 — Mid-Cap (2% ≤ ATR% < 4%)', profiles);
    printTierTable('HIGH_VOL', 'Tier 3 — High Volatility (ATR% ≥ 4%)', profiles);

    // 4. Print rally/drawdown analysis (key for TP tuning)
    console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}                      RALLY & DRAWDOWN ANALYSIS (30d Window)                        ${RESET}`);
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════════════${RESET}\n`);

    const header = padRight('Symbol', 14) +
        padRight('Avg Rally', 12) + padRight('Max Rally', 12) +
        padRight('Avg DD', 12) + padRight('Max DD', 12) +
        padRight('Max Up 1H', 12) + padRight('Max Down 1H', 12) +
        'Tier';
    console.log(`${DIM}${header}${RESET}`);
    console.log(`${DIM}${'─'.repeat(header.length)}${RESET}`);

    for (const p of profiles.sort((a, b) => {
        const aATR = a.metrics['30d']?.atrPercent || 0;
        const bATR = b.metrics['30d']?.atrPercent || 0;
        return bATR - aATR;
    })) {
        const m = p.metrics['30d'] || p.metrics['7d'];
        if (!m) continue;

        const tierColor = p.tier === 'HIGH_VOL' ? RED : p.tier === 'MAJOR' ? GREEN : YELLOW;
        console.log(
            padRight(p.symbol, 14) +
            padRight(`+${(m.avgRallyPercent * 100).toFixed(2)}%`, 12) +
            padRight(`+${(m.maxRallyPercent * 100).toFixed(2)}%`, 12) +
            padRight(`-${(m.avgDrawdownPercent * 100).toFixed(2)}%`, 12) +
            padRight(`-${(m.maxDrawdownPercent * 100).toFixed(2)}%`, 12) +
            padRight(`+${(m.maxUpCandle * 100).toFixed(2)}%`, 12) +
            padRight(`-${(Math.abs(m.maxDownCandle) * 100).toFixed(2)}%`, 12) +
            `${tierColor}${p.tier}${RESET}`
        );
    }

    // 5. Tier summary statistics
    console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}                         TIER SUMMARY (Averages across assets)                       ${RESET}`);
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════════════${RESET}\n`);

    for (const tierName of ['MAJOR', 'MID_CAP', 'HIGH_VOL'] as const) {
        const tierAssets = profiles.filter(p => p.tier === tierName);
        if (tierAssets.length === 0) continue;

        const metrics30d = tierAssets.map(p => p.metrics['30d']).filter(Boolean);
        if (metrics30d.length === 0) continue;

        const avgATR = avg(metrics30d.map(m => m.atrPercent));
        const avgRally = avg(metrics30d.map(m => m.avgRallyPercent));
        const avgDD = avg(metrics30d.map(m => m.avgDrawdownPercent));
        const avgRange = avg(metrics30d.map(m => m.dailyRangePercent));

        const tierColor = tierName === 'HIGH_VOL' ? RED : tierName === 'MAJOR' ? GREEN : YELLOW;
        console.log(`${tierColor}${BOLD}${tierName}${RESET} (${tierAssets.length} assets: ${tierAssets.map(a => a.symbol).join(', ')})`);
        console.log(`  ATR%: ${(avgATR * 100).toFixed(2)}%  |  Daily Range: ${(avgRange * 100).toFixed(2)}%  |  Avg Rally: +${(avgRally * 100).toFixed(2)}%  |  Avg DD: -${(avgDD * 100).toFixed(2)}%`);
        console.log('');
    }

    // 6. TP Recommendation
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}                       RECOMMENDED ADAPTIVE TP PARAMETERS                           ${RESET}`);
    console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════════════${RESET}\n`);

    for (const tierName of ['MAJOR', 'MID_CAP', 'HIGH_VOL'] as const) {
        const tierAssets = profiles.filter(p => p.tier === tierName);
        const metrics30d = tierAssets.map(p => p.metrics['30d']).filter(Boolean);
        if (metrics30d.length === 0) continue;

        const avgRally = avg(metrics30d.map(m => m.avgRallyPercent));
        const avgDD = avg(metrics30d.map(m => m.avgDrawdownPercent));

        // TP layers: fraction of average rally magnitude
        const tp1 = avgRally * 0.25;  // 25% of avg rally
        const tp2 = avgRally * 0.50;  // 50% of avg rally
        const tp3 = avgRally * 0.85;  // 85% of avg rally

        // ROE thresholds based on rally * leverage consideration
        const roeTP1 = Math.max(10, avgRally * 100 * 3);  // ~3x the price move in ROE
        const roeTP2 = Math.max(30, avgRally * 100 * 8);   // ~8x the price move in ROE

        // Trail activation ~ 40% of avg rally
        const trailAct = avgRally * 0.40;
        // Trail distance: tighter for majors, wider for alts
        const trailDist = tierName === 'MAJOR' ? 0.40 : tierName === 'MID_CAP' ? 0.35 : 0.30;

        const tierColor = tierName === 'HIGH_VOL' ? RED : tierName === 'MAJOR' ? GREEN : YELLOW;
        console.log(`${tierColor}${BOLD}${tierName}${RESET}`);
        console.log(`  Layered TPs:  TP1: +${(tp1 * 100).toFixed(2)}%  |  TP2: +${(tp2 * 100).toFixed(2)}%  |  TP3: +${(tp3 * 100).toFixed(2)}%`);
        console.log(`  ROE TPs:      TP1: >${roeTP1.toFixed(0)}% ROE (close 50%)  |  TP2: >${roeTP2.toFixed(0)}% ROE (close 100%)`);
        console.log(`  Trailing:     Activate: +${(trailAct * 100).toFixed(2)}%  |  Trail: ${(trailDist * 100).toFixed(0)}% below peak`);
        console.log('');
    }

    // 7. Save JSON report
    const outputPath = path.join(__dirname, 'output', 'volatility-report.json');
    const report = {
        generatedAt: new Date().toISOString(),
        assetCount: profiles.length,
        profiles: profiles.map(p => ({
            symbol: p.symbol,
            price: p.price,
            volume24hUsd: p.volume24hUsd,
            tier: p.tier,
            metrics: p.metrics
        }))
    };
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\n${GREEN}✔ Report saved to ${outputPath}${RESET}\n`);
}

// ═══════ DATA FETCHING ═══════

async function fetchCandles(indexer: IndexerClient, symbol: string, totalHours: number): Promise<CandleData[]> {
    const allCandles: CandleData[] = [];
    const now = new Date();
    let endTime = now.toISOString();
    const startTarget = new Date(now.getTime() - totalHours * 3600 * 1000);
    let attempts = 0;

    while (allCandles.length < totalHours && attempts < 20) {
        attempts++;
        try {
            const res = await (indexer as any).markets.getPerpetualMarketCandles(
                symbol, CANDLE_RESOLUTION, undefined, endTime, BATCH_SIZE
            );

            if (!res?.candles?.length) break;

            const batch: CandleData[] = res.candles.map((c: any) => ({
                t: new Date(c.startedAt).getTime(),
                o: parseFloat(c.open),
                h: parseFloat(c.high),
                l: parseFloat(c.low),
                c: parseFloat(c.close),
                v: parseFloat(c.baseTokenVolume)
            }));

            allCandles.push(...batch);

            // Move window back
            const oldest = batch.reduce((m, c) => c.t < m ? c.t : m, Infinity);
            if (oldest <= startTarget.getTime()) break;
            endTime = new Date(oldest - 1).toISOString();

            if (batch.length < BATCH_SIZE) break;

            // Rate limit
            await new Promise(r => setTimeout(r, 300));
        } catch (e: any) {
            if (e?.response?.status === 429) {
                await new Promise(r => setTimeout(r, 3000));
            } else {
                throw e;
            }
        }
    }

    // Sort chronologically and deduplicate
    const seen = new Set<number>();
    return allCandles
        .filter(c => {
            if (seen.has(c.t)) return false;
            seen.add(c.t);
            return c.t >= startTarget.getTime();
        })
        .sort((a, b) => a.t - b.t);
}

// ═══════ METRICS COMPUTATION ═══════

function computeMetrics(
    symbol: string, price: number, vol24hUsd: number,
    timeframe: string, candles: CandleData[]
): AssetMetrics {
    const n = candles.length;

    // Use MEDIAN candle close as reference price (robust against oraclePrice mismatch)
    const sortedCloses = candles.map(c => c.c).sort((a, b) => a - b);
    const refPrice = sortedCloses[Math.floor(sortedCloses.length / 2)];

    // Hourly returns (percentage)
    const returns: number[] = [];
    for (let i = 1; i < n; i++) {
        if (candles[i - 1].c > 0) {
            returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c);
        }
    }

    // ATR (True Range) — use candle-derived reference price
    const trs: number[] = [];
    for (let i = 1; i < n; i++) {
        const h = candles[i].h;
        const l = candles[i].l;
        const pc = candles[i - 1].c;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const atr = trs.length > 0 ? avg(trs) : 0;
    const atrPercent = refPrice > 0 ? atr / refPrice : 0;

    // Daily range: group by day, compute avg (H-L)/C
    const dayMap = new Map<string, CandleData[]>();
    for (const c of candles) {
        const day = new Date(c.t).toISOString().slice(0, 10);
        if (!dayMap.has(day)) dayMap.set(day, []);
        dayMap.get(day)!.push(c);
    }
    const dailyRanges: number[] = [];
    for (const [, dayCandles] of dayMap) {
        const dayHigh = Math.max(...dayCandles.map(c => c.h));
        const dayLow = Math.min(...dayCandles.map(c => c.l));
        const dayClose = dayCandles[dayCandles.length - 1].c;
        if (dayClose > 0) dailyRanges.push((dayHigh - dayLow) / dayClose);
    }
    const dailyRangePercent = dailyRanges.length > 0 ? avg(dailyRanges) : 0;

    // Std dev of returns
    const meanRet = avg(returns);
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanRet, 2), 0) / (returns.length || 1);
    const stdDevReturns = Math.sqrt(variance);

    // Max single-candle moves
    const maxUpCandle = returns.length > 0 ? Math.max(...returns) : 0;
    const maxDownCandle = returns.length > 0 ? Math.min(...returns) : 0;

    // Rally & Drawdown analysis (swing detection)
    // Adaptive threshold: 1.5× ATR% (capped at 5% to avoid over-filtering)
    const adaptiveThresh = Math.min(Math.max(atrPercent * 1.5, 0.002), 0.05);
    const { rallies, drawdowns } = detectSwings(candles, adaptiveThresh);

    // Remove outlier swings (> 3σ from mean) and cap at 50%
    const cleanRallies = removeOutliers(rallies).filter(r => r <= 0.50);
    const cleanDrawdowns = removeOutliers(drawdowns.map(Math.abs)).filter(d => d <= 0.50);

    const avgRallyPercent = cleanRallies.length > 0 ? avg(cleanRallies) : 0;
    const maxRallyPercent = cleanRallies.length > 0 ? Math.max(...cleanRallies) : 0;
    const avgDrawdownPercent = cleanDrawdowns.length > 0 ? avg(cleanDrawdowns) : 0;
    const maxDrawdownPercent = cleanDrawdowns.length > 0 ? Math.max(...cleanDrawdowns) : 0;

    // Avg hourly volume in USD
    const avgHourlyVolumeUsd = avg(candles.map(c => c.v * c.c));

    return {
        symbol, price, volume24hUsd: vol24hUsd, timeframe,
        candleCount: n,
        atrPercent, dailyRangePercent, stdDevReturns,
        maxUpCandle, maxDownCandle,
        avgRallyPercent, avgDrawdownPercent,
        maxRallyPercent, maxDrawdownPercent,
        avgHourlyVolumeUsd,
    };
}

/** Remove values beyond 3 standard deviations from the mean */
function removeOutliers(arr: number[]): number[] {
    if (arr.length < 3) return arr;
    const m = avg(arr);
    const sd = Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / arr.length);
    if (sd === 0) return arr;
    return arr.filter(v => Math.abs(v - m) <= 3 * sd);
}

/**
 * Swing detection using ZigZag algorithm with adaptive threshold.
 * 
 * Tracks running high and running low from the last confirmed swing point.
 * A rally is confirmed when price rises by `threshold` from a trough.
 * A drawdown is confirmed when price drops by `threshold` from a peak.
 * 
 * Uses candle highs/lows for accuracy.
 */
function detectSwings(candles: CandleData[], threshold: number): { rallies: number[], drawdowns: number[] } {
    if (candles.length < 5) return { rallies: [], drawdowns: [] };

    const rallies: number[] = [];
    const drawdowns: number[] = [];

    // Initialize: find whether the first significant move is up or down
    let lastPivot = candles[0].c;
    let runHigh = candles[0].h;
    let runLow = candles[0].l;
    let trend: 'up' | 'down' | 'none' = 'none';

    for (let i = 1; i < candles.length; i++) {
        const c = candles[i];

        // Always track extremes
        if (c.h > runHigh) runHigh = c.h;
        if (c.l < runLow) runLow = c.l;

        if (trend === 'none') {
            // Determine initial trend from first significant move
            const upMove = (runHigh - lastPivot) / lastPivot;
            const downMove = (lastPivot - runLow) / lastPivot;
            if (upMove >= threshold) {
                trend = 'up';
                runLow = c.l; // Reset low tracking
            } else if (downMove >= threshold) {
                trend = 'down';
                runHigh = c.h; // Reset high tracking
            }
        } else if (trend === 'up') {
            // In uptrend, track new highs
            if (c.h > runHigh) {
                runHigh = c.h;
            }
            // Check for reversal: dropped enough from the high?
            const drop = (runHigh - c.l) / runHigh;
            if (drop >= threshold) {
                // Confirm rally from lastPivot to runHigh
                const pct = (runHigh - lastPivot) / lastPivot;
                if (pct > 0.001) rallies.push(pct);
                // Start tracking downtrend
                lastPivot = runHigh;
                runLow = c.l;
                runHigh = c.h;
                trend = 'down';
            }
        } else {
            // In downtrend, track new lows
            if (c.l < runLow) {
                runLow = c.l;
            }
            // Check for reversal: bounced enough from the low?
            const bounce = (c.h - runLow) / runLow;
            if (bounce >= threshold) {
                // Confirm drawdown from lastPivot to runLow
                const pct = (runLow - lastPivot) / lastPivot;
                if (Math.abs(pct) > 0.001) drawdowns.push(pct);
                // Start tracking uptrend
                lastPivot = runLow;
                runHigh = c.h;
                runLow = c.l;
                trend = 'up';
            }
        }
    }

    return { rallies, drawdowns };
}

// ═══════ DISPLAY HELPERS ═══════

function printTierTable(tier: string, title: string, profiles: AssetProfile[]) {
    const tierAssets = profiles.filter(p => p.tier === tier);
    if (tierAssets.length === 0) return;

    const tierColor = tier === 'HIGH_VOL' ? RED : tier === 'MAJOR' ? GREEN : YELLOW;
    console.log(`${tierColor}${BOLD}${title}${RESET}`);

    const header = padRight('Symbol', 14) + padRight('Price', 12) + padRight('Vol 24h', 14) +
        padRight('ATR% 7d', 10) + padRight('ATR% 30d', 10) + padRight('ATR% 90d', 10) +
        padRight('StdDev', 10) + padRight('Range/Day', 10);
    console.log(`${DIM}${header}${RESET}`);
    console.log(`${DIM}${'─'.repeat(header.length)}${RESET}`);

    for (const p of tierAssets) {
        const m7 = p.metrics['7d'];
        const m30 = p.metrics['30d'];
        const m90 = p.metrics['90d'];

        console.log(
            padRight(p.symbol, 14) +
            padRight(`$${p.price.toFixed(2)}`, 12) +
            padRight(`$${formatNum(p.volume24hUsd)}`, 14) +
            padRight(m7 ? `${(m7.atrPercent * 100).toFixed(2)}%` : 'N/A', 10) +
            padRight(m30 ? `${(m30.atrPercent * 100).toFixed(2)}%` : 'N/A', 10) +
            padRight(m90 ? `${(m90.atrPercent * 100).toFixed(2)}%` : 'N/A', 10) +
            padRight(m30 ? `${(m30.stdDevReturns * 100).toFixed(3)}%` : 'N/A', 10) +
            padRight(m30 ? `${(m30.dailyRangePercent * 100).toFixed(2)}%` : 'N/A', 10)
        );
    }
    console.log('');
}

function padRight(s: string, width: number): string {
    return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function formatNum(n: number): string {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(2);
}

function avg(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ═══════ RUN ═══════
main().catch(err => {
    console.error(`${RED}Fatal Error:${RESET}`, err);
    process.exit(1);
});
