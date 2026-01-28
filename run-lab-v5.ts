
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import { HyperliquidWS } from './src/services/hyperliquid-ws.ts';
import { generateV5Consensus } from './src/lib/v5/analysis-v5.ts';
import { calculateMaxPain } from './src/services/deribit-api.ts';
import { fetchCoinglassData } from './src/services/coinglass-mock.ts';
import { fetchOnChainMetrics } from './src/services/on-chain-mock.ts';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load Env
try {
    const envPath = path.resolve('.env.local');
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) process.env[k] = envConfig[k];
} catch (e) {
    console.error("No .env.local found");
}

const ASSETS = ['BTC', 'ETH', 'SOL', 'AVAX', 'SUI', 'ARB', 'TIA', 'OP', 'LDO', 'DOGE', 'XRP', 'SEI'];
const orderbooks = new Map<string, any>();

async function runLabV5() {
    console.log("\n🦅 V5 CONSENSUS LAB: THE MASTER BOT");
    console.log("===================================");
    console.log("Voting Members: V2(Trend) + V3(Liq) + V4(Neural) + V5(OnChain)");
    console.log("Goal: High Win Rate via Unanimity.\n");

    const pKey = process.env.HL_PRIVATE_KEY!;
    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet);
    const ws = new HyperliquidWS();

    // Subscribe to all assets
    ASSETS.forEach(coin => ws.subscribeL2Book(coin));

    ws.onMessage((msg: any) => {
        if (msg.channel === 'l2Book') {
            orderbooks.set(msg.data.coin, msg.data);
        }
    });

    console.log("⏳ Warming up Sockets (5s)...");
    await new Promise(r => setTimeout(r, 5000));

    setInterval(async () => {
        console.log(`\n--- V5 CONSENSUS SCAN: ${new Date().toLocaleTimeString()} ---`);
        console.log("Asset | V2 (Trend) | V3 (Liq) | V4 (Neural) | V5 (Chain) | CONSENSUS | LEV | Confidence");
        console.log("------+------------+----------+-------------+------------+-----------+-----+-----------");

        try {
            // Asset Rotation: Get Top 6 by Volume
            const metaAndCtx = await sdk.info.perpetuals.getMetaAndAssetCtxs();
            const universe = metaAndCtx[0].universe;
            const context = metaAndCtx[1];

            const rankedAssets = ASSETS.map(coin => {
                const assetIdx = universe.findIndex((u: any) => u.name === `${coin}-PERP` || u.name === coin);
                if (assetIdx === -1) return { coin, vol: 0, ctx: null };
                return { coin, vol: parseFloat(context[assetIdx].dayNtlVlm), ctx: context[assetIdx] };
            }).sort((a, b) => b.vol - a.vol).slice(0, 8); // Top 8

            for (const item of rankedAssets) {
                const coin = item.coin;
                const ctx = item.ctx;
                if (!ctx) continue;

                // Market Data
                const price = parseFloat(ctx.markPx);
                const funding = parseFloat(ctx.funding);
                const metrics = [{
                    symbol: coin,
                    price: price,
                    priceChange24h: parseFloat(ctx.dayNtlVlm) > 0 ? (parseFloat(ctx.markPx) - parseFloat(ctx.prevDayPx)) / parseFloat(ctx.prevDayPx) * 100 : 0, // Approx
                    volumeChange24h: 0, // WS doesn't give this easily, mock 0
                    high24h: parseFloat(ctx.prevDayPx) * 1.05, // Mock High (API limit) - In real V5 used Candle High
                    low24h: parseFloat(ctx.prevDayPx) * 0.95, // Mock Low
                    fundingRate: funding,
                    open: parseFloat(ctx.prevDayPx)
                }];
                // Refined Metric: Use actual 24h change from context if available, otherwise calc

                // Fetch Deep Data
                const endTime = Date.now();
                const startTime = endTime - (100 * 15 * 60 * 1000);
                const candles = await sdk.info.getCandleSnapshot(coin, '15m', startTime, endTime);
                const formattedCandles = candles.map((c: any) => ({ c: parseFloat(c.c), v: parseFloat(c.v) }));

                // Fix Metric Range with Real Data
                if (formattedCandles.length > 0) {
                    // metrics[0].high24h = Math.max(...formattedCandles.map(c => c.c)); // Simple high
                    // metrics[0].low24h = Math.min(...formattedCandles.map(c => c.c));
                    // 15m is too short for 24h high/low, stick to context or fetch daily
                }

                const ob = orderbooks.get(coin);
                const maxPain = await calculateMaxPain(coin);
                const coinglass = await fetchCoinglassData(coin);
                const onChain = await fetchOnChainMetrics(coin);

                // --- EXECUTE V5 CONSENSUS ---
                const v5 = generateV5Consensus(
                    metrics as any,
                    formattedCandles,
                    ob,
                    coinglass,
                    onChain,
                    maxPain,
                    funding
                );

                // Formatter
                const fmt = (s: string) => {
                    if (s === 'BUY' || s === 'BULLISH') return "🟢 BUY ";
                    if (s === 'SELL' || s === 'BEARISH') return "🔴 SELL";
                    return "⚪ ----";
                };

                const consensusColor = v5.action === 'BUY' ? "🟢 LONG " : (v5.action === 'SELL' ? "🔴 SHORT" : "⚪ HOLD ");

                console.log(
                    `${coin.padEnd(5)} | ` +
                    `${fmt(v5.votes.v2)}   | ` +
                    `${fmt(v5.votes.v3)}   | ` +
                    `${fmt(v5.votes.v4)}   | ` +
                    `${fmt(v5.votes.onChain as any).padEnd(7)}    | ` +
                    `${consensusColor.padEnd(9)} | ` +
                    `${(v5.leverage + "x").padEnd(3)} | ` +
                    `${v5.confidence}%`
                );

                if (v5.action !== 'NEUTRAL') {
                    console.log(`      > Reasons: ${v5.reasons.join(", ")}`);
                }
            }

        } catch (e) {
            console.error("Loop Error:", e);
        }

    }, 10000);
}

runLabV5();
