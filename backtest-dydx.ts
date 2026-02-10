
import {
    Network,
    IndexerClient
} from '@dydxprotocol/v4-client-js';
import { generateV5Consensus } from './src/lib/v5/analysis-v5.ts';
import { VirtualWallet } from './src/services/virtual-wallet.ts';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load Env
try {
    const envPath = path.resolve('.env.local');
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) process.env[k] = envConfig[k];
} catch (e) { }

// SCENARIOS
const SCENARIOS = [
    { name: 'Swing Trading (1 Year, Daily)', resolution: '1DAY', duration: 365 * 24 * 3600 * 1000 },
    { name: 'Day Trading (1 Month, 15 Mins)', resolution: '15MINS', duration: 30 * 24 * 3600 * 1000 }
];

const TARGET_ASSET = 'BTC-USD';

// Mainnet Client for Data
const indexer = new IndexerClient(Network.mainnet().indexerConfig);

async function fetchHistory(durationMs: number, resolution: string) {
    console.log(`📥 Fetching Data... (${resolution}, ${durationMs / (24 * 3600 * 1000)} days)`);

    let allCandles: any[] = [];
    let endCursor = new Date().toISOString();
    const startTime = Date.now() - durationMs;

    let hasMore = true;
    let retries = 0;

    while (hasMore) {
        try {
            const res = await (indexer as any).markets.getPerpetualMarketCandles(
                TARGET_ASSET,
                resolution,
                undefined, // fromISO
                endCursor, // toISO
                100        // limit
            );

            if (!res.candles || res.candles.length === 0) break;

            const formatted = res.candles.map((c: any) => ({
                t: new Date(c.startedAt).getTime(),
                o: parseFloat(c.open),
                h: parseFloat(c.high),
                l: parseFloat(c.low),
                c: parseFloat(c.close),
                v: parseFloat(c.baseTokenVolume)
            })).sort((a: any, b: any) => a.t - b.t);

            // Prepend because fetching backwards
            allCandles = [...formatted, ...allCandles];

            const oldest = formatted[0];
            if (oldest.t <= startTime) {
                hasMore = false;
            } else {
                endCursor = new Date(oldest.t).toISOString();
                if (formatted.length < 100) hasMore = false;
            }

            retries = 0;
            await new Promise(r => setTimeout(r, 1000));
            process.stdout.write(".");

        } catch (e: any) {
            if (String(e).includes('429') && retries < 5) {
                retries++;
                const wait = 5000 * retries;
                console.log(`\n⚠️ Rate Limit (429). Waiting ${wait / 1000}s...`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            console.error("Fetch Error:", e);
            break;
        }
    }

    allCandles = allCandles
        .filter((v, i, a) => i === 0 || v.t !== a[i - 1].t)
        .filter(c => c.t >= startTime);

    console.log(`\n✅ Loaded ${allCandles.length} candles.`);
    return allCandles;
}

async function runBacktest(scenario: any) {
    console.log(`\n================================`);
    console.log(`🚀 RUNNING: ${scenario.name}`);
    console.log(`================================`);

    const candles = await fetchHistory(scenario.duration, scenario.resolution);
    if (!candles || candles.length < 50) {
        console.warn("Not enough data.");
        return;
    }

    const wallet = new VirtualWallet(10000); // $10k Start
    let totalTrades = 0;

    // Determine Lookback for 24h metrics
    let lookback = 24;
    if (scenario.resolution === '1DAY') lookback = 1;
    else if (scenario.resolution === '15MINS') lookback = 96;

    // Simulation Loop
    // Need enough history for lookback
    const warmup = Math.max(50, lookback + 1);

    for (let i = warmup; i < candles.length; i++) {
        const candle = candles[i];

        // 1. Update Wallet
        wallet.updateEquity(candle.c);

        const historySlice = candles.slice(i - 49, i + 1);

        // 2. Check Exits (SL/TP)
        if (wallet.activePosition) {
            const pos = wallet.activePosition;
            const trail = 0.02; // 2% Trail
            if (pos.action === 'BUY') {
                if (candle.c > pos.entryPrice * 1.05) {
                    const newSl = candle.c * (1 - trail);
                    if (newSl > pos.sl) pos.sl = newSl;
                }
                if (candle.l <= pos.sl) { wallet.closePosition(pos.sl, 'SL', i); totalTrades++; }
                else if (candle.h >= pos.tp) { wallet.closePosition(pos.tp, 'TP', i); totalTrades++; }
            } else {
                if (candle.c < pos.entryPrice * 0.95) {
                    const newSl = candle.c * (1 + trail);
                    if (newSl < pos.sl) pos.sl = newSl;
                }
                if (candle.h >= pos.sl) { wallet.closePosition(pos.sl, 'SL', i); totalTrades++; }
                else if (candle.l <= pos.tp) { wallet.closePosition(pos.tp, 'TP', i); totalTrades++; }
            }
        }

        // 3. Entry Logic (V5 Consensus)
        if (!wallet.activePosition) {
            // Calculate Dynamic 24h Metrics
            const pastIndex = Math.max(0, i - lookback);
            const open24h = candles[pastIndex].o;

            const params = {
                price: candle.c,
                priceChange24h: ((candle.c - open24h) / open24h) * 100,
                volumeChange24h: 0,
                high24h: Math.max(...candles.slice(pastIndex, i + 1).map(c => c.h)),
                low24h: Math.min(...candles.slice(pastIndex, i + 1).map(c => c.l)),
                fundingRate: 0.0001,
                open: open24h
            };
            const metrics = [{ symbol: TARGET_ASSET, ...params }];

            // Proxies (Mock)
            const coinglass = { longShortRatio: 1.1, openInterestChange: 0, topTraderLsr: 1.2, longLiq: 0, shortLiq: 0, oiChangePercent: 0 };
            const onChain = { isBullish: true, isBearish: false, netFlow: 100, whaleScore: 0.7, tvlChange: 0, btcInflow: 0, usdcInflow: 0 };

            const v5 = generateV5Consensus(metrics as any, historySlice, null, coinglass, onChain, 0, 0.0001);

            // Entry - Threshold 0.35
            if (v5.action !== 'NEUTRAL' && v5.score > 0.35) {
                const size = wallet.balance * 0.2;
                const lev = 5;
                const tp = v5.action === 'BUY' ? candle.c * 1.08 : candle.c * 0.92;
                const sl = v5.action === 'BUY' ? candle.c * 0.96 : candle.c * 1.04;

                wallet.openPosition(TARGET_ASSET, v5.action, candle.c, lev, i);
                if (wallet.activePosition) {
                    (wallet.activePosition as any).tp = tp;
                    (wallet.activePosition as any).sl = sl;
                }
            }
        }
    }

    // Results
    const profit = wallet.balance - 10000;
    const roi = (profit / 10000) * 100;

    console.log(`------------- RESULTS -------------`);
    console.log(`Scenario:   ${scenario.name}`);
    console.log(`Trades:     ${totalTrades}`);
    console.log(`Final Bal:  $${wallet.balance.toFixed(2)}`);
    console.log(`Profit:     $${profit.toFixed(2)}`);
    console.log(`ROI:        ${roi.toFixed(2)}%`);
    console.log(`Max DD:     ${(wallet.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`-----------------------------------`);
}

async function runAll() {
    for (const scenario of SCENARIOS) {
        await runBacktest(scenario);
    }
}

runAll();
