
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import { HyperliquidWS } from './src/services/hyperliquid-ws.ts';
import { generateTradeSignal } from './src/lib/analysis.ts';
import { generateV3Signal } from './src/lib/v3/analysis-v3.ts';
import { generateV4Signal } from './src/lib/v4/analysis-v4.ts';
import { calculateMaxPain } from './src/services/deribit-api.ts';
import type { CoinglassData } from './src/services/coinglass-mock.ts';
import { fetchCoinglassData } from './src/services/coinglass-mock.ts';
import type { OnChainMetrics } from './src/services/on-chain-mock.ts';
import { fetchOnChainMetrics } from './src/services/on-chain-mock.ts';
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

// Circuit Breaker & Trailing State
let consecutiveLosses = 0;
let isPaused = false;
let pauseUntil = 0;
// Mock Position State for Trailing Stop Sim
const mockPositions = new Map<string, { entry: number, sl: number, highest: number, isLong: boolean }>();

async function runLab() {
    console.log("🦅 SUPER BOT LABS: PYTHON PORT (DEEP) STARTED");
    console.log("-------------------------------------------");
    console.log("Active: Ensemble ML, On-Chain (Flows/Whales), Spot-Arb, Smart Trailing");

    const pKey = process.env.HL_PRIVATE_KEY!;
    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet);
    const ws = new HyperliquidWS();

    ASSETS.forEach(coin => ws.subscribeL2Book(coin));

    ws.onMessage((msg: any) => {
        if (msg.channel === 'l2Book') {
            orderbooks.set(msg.data.coin, msg.data);
        }
    });

    console.log("⏳ Waiting 5s for WS Warmup...");
    await new Promise(r => setTimeout(r, 5000));

    setInterval(async () => {
        if (isPaused) {
            if (Date.now() > pauseUntil) {
                console.log("🟢 CIRCUIT BREAKER RESET. Resuming...");
                isPaused = false;
                consecutiveLosses = 0;
            } else {
                return;
            }
        }

        console.log(`\n--- SNAPSHOT: ${new Date().toLocaleTimeString()} ---`);
        console.log("Asset | Super Bot Action | Confidence | Leverage | On-Chain Status | Arb/Trail | Reasons");
        console.log("------+------------------+------------+----------+-----------------+-----------+-----------------");

        try {
            const metaAndCtx = await sdk.info.perpetuals.getMetaAndAssetCtxs();
            const universe = metaAndCtx[0].universe;
            const context = metaAndCtx[1];

            // Asset Rotation (Sort by Volume)
            const rankedAssets = ASSETS.map(coin => {
                const assetIdx = universe.findIndex((u: any) => u.name === `${coin}-PERP` || u.name === coin);
                if (assetIdx === -1) return { coin, vol: 0, ctx: null };
                return { coin, vol: parseFloat(context[assetIdx].dayNtlVlm), ctx: context[assetIdx] };
            }).sort((a, b) => b.vol - a.vol);

            for (const item of rankedAssets.slice(0, 6)) {
                const coin = item.coin;
                const ctx = item.ctx;
                if (!ctx) continue;

                const price = parseFloat(ctx.markPx);
                const funding = parseFloat(ctx.funding);

                // Fetch Data
                const endTime = Date.now();
                const startTime = endTime - (50 * 15 * 60 * 1000);
                const candles = await sdk.info.getCandleSnapshot(coin, '15m', startTime, endTime);
                const formattedCandles = candles.map((c: any) => ({ c: parseFloat(c.c), v: parseFloat(c.v) }));

                const ob = orderbooks.get(coin);
                const maxPain = await calculateMaxPain(coin);
                const coinglass = await fetchCoinglassData(coin);
                const onChain = await fetchOnChainMetrics(coin);

                // --- V4 ENGINE ---
                const v4 = generateV4Signal(formattedCandles, ob, coinglass, onChain, maxPain, funding);


                // --- PYTHON FEATURES PORT ---

                // 1. Spot-Perp Arbitrage
                // Python: spread = (current_price - spot_price) / spot_price; if > 0.01 hedge
                // Mock Spot Price (random deviation)
                const mockSpot = price * (1 + (Math.random() * 0.005 - 0.0025));
                const spread = (price - mockSpot) / mockSpot;
                let arbStatus = "---";
                if (Math.abs(spread) > 0.01) {
                    arbStatus = spread > 0 ? "Short Arb" : "Long Arb";
                    // Override Signal for Arb
                    v4.action = spread > 0 ? 'SELL' : 'BUY';
                    v4.reasons.push("Arbitrage Opportunity");
                }

                // 2. Mock Trailing Stop Simulation
                if (mockPositions.has(coin)) {
                    const pos = mockPositions.get(coin)!;
                    const isLong = pos.isLong;

                    // Update Highest/Lowest
                    if (isLong && price > pos.highest) pos.highest = price;
                    if (!isLong && price < pos.highest) pos.highest = price;

                    // Trigger Trail Update (Python Logic: >1% gain -> trail 1.5%)
                    let trailActive = false;
                    if (isLong && price > pos.entry * 1.01) {
                        pos.sl = price * (1 - 0.015);
                        trailActive = true;
                    } else if (!isLong && price < pos.entry * 0.99) {
                        pos.sl = price * (1 + 0.015);
                        trailActive = true;
                    }

                    if (trailActive) arbStatus = `Trail Active`;
                }


                // --- DISPLAY ---
                const onChainStr = onChain.isBullish ? "🟢 BULL Flows" : onChain.isBearish ? "🔴 BEAR Flows" : "⚪ Neutral";
                const reasons = v4.reasons.slice(0, 2).join(", "); // Top 2 reasons

                console.log(
                    `${coin.padEnd(5)} | ` +
                    `${v4.action.padEnd(16)} | ` +
                    `${v4.confidence.toFixed(1).padEnd(10)} | ` +
                    `${v4.leverage}x        | ` +
                    `${onChainStr.padEnd(15)} | ` +
                    `${arbStatus.padEnd(9)} | ` +
                    `${reasons}`
                );
            }

        } catch (e) {
            console.error("Loop Error:", e);
        }

    }, 8000);
}

runLab();
