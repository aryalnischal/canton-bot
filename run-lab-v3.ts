
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import { HyperliquidWS } from './src/services/hyperliquid-ws.ts';
import { generateTradeSignal } from './src/lib/analysis.ts';
import type { TradeSignal } from './src/lib/analysis.ts';
import { generateV3Signal } from './src/lib/v3/analysis-v3.ts';
import type { V3Signal } from './src/lib/v3/analysis-v3.ts';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load Env
try {
    const envPath = path.resolve('.env.local');
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
} catch (e) {
    console.error("No .env.local found");
}

const ASSETS = ['BTC', 'ETH', 'SOL', 'AVAX', 'SUI', 'ARB', 'TIA', 'OP', 'LDO'];
const orderbooks = new Map<string, any>();

async function runLab() {
    console.log("🔬 CANTON LABS: V3 HYBRID RESEARCH STARTED");
    console.log("------------------------------------------");

    // 1. Setup SDK & WS
    const pKey = process.env.HL_PRIVATE_KEY!;
    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet);
    const ws = new HyperliquidWS();

    // Subscribe to Orderbooks
    ASSETS.forEach(coin => ws.subscribeL2Book(coin));

    // Listen for WS Data
    ws.onMessage((msg: any) => {
        if (msg.channel === 'l2Book') {
            // DEBUG: Log first message to understand structure
            if (!orderbooks.has(msg.data.coin)) {
                console.log(`DEBUG WS DATA (${msg.data.coin}):`, JSON.stringify(msg.data).substring(0, 200));
            }
            orderbooks.set(msg.data.coin, msg.data);
        }
    });

    console.log("⏳ Waiting 5s for WS Warmup...");
    await new Promise(r => setTimeout(r, 5000));

    // 2. Simulation Loop
    setInterval(async () => {
        // console.clear();
        console.log(`\n--- SNAPSHOT: ${new Date().toLocaleTimeString()} ---`);
        console.log("Asset | V2.1 (Base) | V3 (Hybrid) | Filter | Confidence | MACD/OB");
        console.log("------+-------------+-------------+--------+------------+--------");

        try {
            // Fetch Global Context (24h stats) for V2.1
            const metaAndCtx = await sdk.info.perpetuals.getMetaAndAssetCtxs();
            const universe = metaAndCtx[0].universe;
            const context = metaAndCtx[1];

            for (const coin of ASSETS) {
                // Find Context
                const assetIdx = universe.findIndex((u: any) => u.name === `${coin}-PERP` || u.name === coin);
                if (assetIdx === -1) continue;

                const ctx = context[assetIdx];
                const stats = ctx.dayNtlVlm; // Rough approximation of "Metric"
                const price = parseFloat(ctx.markPx);
                const prevPrice = parseFloat(ctx.prevDayPx);
                const change24h = ((price - prevPrice) / prevPrice) * 100;

                // Construct V2.1 Metric Stub
                const metricStub: any = {
                    symbol: coin,
                    price: price,
                    priceChange24h: change24h,
                    high24h: price * 1.05, // Mock (SDK doesn't give High/Low easily in Context)
                    low24h: price * 0.95,  // Mock
                    volumeChange24h: 12, // Mock High Vol for testing
                    fundingRate: parseFloat(ctx.funding)
                };

                // Fetch Candles for V3 (Real History)
                // Fix: Use candleSnapshot with correct start/end times
                const endTime = Date.now();
                const startTime = endTime - (50 * 15 * 60 * 1000); // 50 candles * 15m

                const candles = await sdk.info.getCandleSnapshot(coin, '15m', startTime, endTime);
                // Convert SDK candles to { c, v } format
                // SDK returns: { t, T, o, c, h, l, v, n }
                const formattedCandles = candles.map((c: any) => ({
                    c: parseFloat(c.c),
                    v: parseFloat(c.v)
                }));

                // Get Orderbook
                const ob = orderbooks.get(coin);

                // --- RUN SIGNALS ---

                // V2.1
                const v2Signal = generateTradeSignal([metricStub], undefined, '15m');

                // V3
                const v3Signal = generateV3Signal(formattedCandles, ob);

                // --- COMPARE ---
                const v2Action = v2Signal.action;
                const v3Action = v3Signal.action;

                let filterStatus = "MATCH";
                if (v2Action !== 'NEUTRAL' && v3Action === 'NEUTRAL') filterStatus = "BLOCKED 🛡️";
                if (v2Action === 'NEUTRAL' && v3Action !== 'NEUTRAL') filterStatus = "NEW OPP ✨";
                if (v2Action !== v3Action && v2Action !== 'NEUTRAL' && v3Action !== 'NEUTRAL') filterStatus = "CONFLICT ⚠️";

                const macdIcon = v3Signal.factors.macd === 'BULLISH' ? '🟢' : '🔴';
                const obVal = (v3Signal.factors.obImbalance * 100).toFixed(0);

                console.log(
                    `${coin.padEnd(5)} | ` +
                    `${v2Action.padEnd(11)} | ` +
                    `${v3Action.padEnd(11)} | ` +
                    `${filterStatus.padEnd(6)} | ` +
                    `${v3Signal.confidence.toFixed(0)}%       | ` +
                    `${macdIcon} OB:${obVal}%`
                );

                // Log conflicts
                if (filterStatus.includes("BLOCKED")) {
                    console.log(`   -> Reason: ${v3Signal.reasons.join(', ')}`);
                }
            }

        } catch (e) {
            console.error("Loop Error:", e);
        }

    }, 10000); // Run every 10s
}

runLab();
