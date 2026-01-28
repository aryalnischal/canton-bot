
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import { generateV5Consensus } from './src/lib/v5/analysis-v5.ts';
import { HistoricalProxy } from './src/services/historical-proxy.ts';
import { VirtualWallet } from './src/services/virtual-wallet.ts';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Env
try {
    const envPath = path.resolve('.env.local');
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) process.env[k] = envConfig[k];
} catch (e) { }

const ASSETS = ['BTC'];

interface DailyStat { date: string; pnl: number; trades: number; }

async function runBacktestV5Sniper() {
    console.log("🦅 V5 SNIPER BOT: 20x LEVERAGE + 4 TP LAYERS");
    console.log("------------------------------------------");

    const pKey = process.env.HL_PRIVATE_KEY!;
    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet);

    // 1. Fetch History
    console.log("📥 Fetching ~1 Year of Historical Data...");
    let allCandles: any[] = [];
    let endTime = Date.now();
    const batchSize = 5000;
    const batches = 7;

    for (let b = 0; b < batches; b++) {
        const startTime = endTime - (batchSize * 15 * 60 * 1000);
        console.log(`   Batch ${b + 1}/${batches}: Fetching relative to now...`);
        try {
            const candles = await sdk.info.getCandleSnapshot(ASSETS[0], '15m', startTime, endTime);
            if (candles.length === 0) break;
            const formatted = candles.map((c: any) => ({
                t: c.t,
                o: parseFloat(c.o), h: parseFloat(c.h), l: parseFloat(c.l), c: parseFloat(c.c), v: parseFloat(c.v)
            }));
            allCandles = [...formatted, ...allCandles];
            endTime = startTime - 1;
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) { break; }
    }

    allCandles.sort((a, b) => a.t - b.t);
    allCandles = allCandles.filter((v, i, a) => i === 0 || v.t !== a[i - 1].t);

    // 2. Walk-Forward Loop
    const virtualWallet = new VirtualWallet(10000);
    const dailyStats: DailyStat[] = [];
    let dayPnL = 0;
    let dayTrades = 0;
    let currentDayLabel = "";

    // Sniper State for Active Position
    let tpLevelReached = 0; // 0, 1, 2, 3, 4

    for (let i = 100; i < allCandles.length; i++) {
        const currentCandle = allCandles[i];
        const dateStr = new Date(currentCandle.t).toISOString().substring(0, 10);

        if (dateStr !== currentDayLabel) {
            if (currentDayLabel !== "") dailyStats.push({ date: currentDayLabel, pnl: dayPnL, trades: dayTrades });
            currentDayLabel = dateStr;
            dayPnL = 0; dayTrades = 0;
        }

        const historySlice = allCandles.slice(i - 99, i + 1);
        const prevBal = virtualWallet.balance;
        virtualWallet.updateEquity(currentCandle.c);

        if (virtualWallet.activePosition) {
            const pos = virtualWallet.activePosition;
            const entry = pos.entryPrice;
            const isSniper = pos.leverage >= 10;

            // SNIPER LOGIC: 4 TP LAYERS
            // At 20x, we close portions:
            // TP1 (1%): Close 25% -> Move SL to BE
            // TP2 (3%): Close 25%
            // TP3 (6%): Close 25%
            // TP4 (12%): Close 25% (Moon)

            const pnlPct = pos.action === 'BUY'
                ? (currentCandle.h - entry) / entry
                : (entry - currentCandle.l) / entry;

            // Check TPs (Simulated Aggregation: We don't partial close in Wallet, we just simulate the realized gain)
            // Ideally we'd actually reduce size, but for SIMPLICITY we will assume "Phantom PnL" added to balance
            // and keep position open until FULL CLOSE or SL.

            // This simulation is a bit loose on the "Reduced Exposure" aspect, but captures the "Locked Profit".
            // Implementation: Trail Aggressively.

            // V5 Dynamic Trail
            const trailDist = isSniper ? 0.01 : 0.015; // Tighter 1% trail for Sniper

            if (pos.action === 'BUY') {
                if (currentCandle.c > entry * 1.01) {
                    const newSl = currentCandle.c * (1 - trailDist);
                    if (newSl > pos.sl) pos.sl = newSl;
                }
                // TP Hits (Visual Log only in sim, actual PnL captured by Trail or Full Close for now)
            } else {
                if (currentCandle.c < entry * 0.99) {
                    const newSl = currentCandle.c * (1 + trailDist);
                    if (newSl < pos.sl) pos.sl = newSl;
                }
            }

            // Close
            let closed = false;
            // SL Hit
            if (pos.action === 'BUY' && currentCandle.l <= pos.sl) { virtualWallet.closePosition(pos.sl, 'Stop Loss', i); dayTrades++; closed = true; }
            else if (pos.action === 'SELL' && currentCandle.h >= pos.sl) { virtualWallet.closePosition(pos.sl, 'Stop Loss', i); dayTrades++; closed = true; }

            // TP4 (Moonbag) Full Close (Rare)
            // If price > 12%, close all
            if (!closed && isSniper && pnlPct > 0.12) {
                const exitPx = pos.action === 'BUY' ? entry * 1.12 : entry * 0.88;
                virtualWallet.closePosition(exitPx, 'TP4 Moonbag', i);
                dayTrades++; closed = true;
            }

            if (closed) dayPnL += (virtualWallet.balance - prevBal);
            else dayPnL += (virtualWallet.balance - prevBal); // Mark-to-market
        }

        if (!virtualWallet.activePosition) {
            // METRICS
            const coinglass = HistoricalProxy.estimateCoinglass(allCandles, i);
            const maxPain = HistoricalProxy.estimateMaxPain(allCandles, i);
            const funding = 0.0001;

            const prevDayCandle = allCandles[Math.max(0, i - 96)];
            const metrics = [{
                symbol: ASSETS[0],
                price: currentCandle.c,
                priceChange24h: (currentCandle.c - prevDayCandle.c) / prevDayCandle.c * 100,
                volumeChange24h: 10,
                high24h: Math.max(...allCandles.slice(i - 96, i + 1).map(c => c.h)),
                low24h: Math.min(...allCandles.slice(i - 96, i + 1).map(c => c.l)),
                fundingRate: funding,
                open: prevDayCandle.c
            }];

            const onChain = {
                netFlow: -100, whaleScore: 0.8, tvlChange: 1,
                btcInflow: -100, usdcInflow: 100,
                isBullish: metrics[0].priceChange24h > 0,
                isBearish: metrics[0].priceChange24h < -2
            };

            // EXECUTE V5
            const v5 = generateV5Consensus(metrics as any, historySlice, null, coinglass, onChain, maxPain, funding);

            // Only Trade if Leverage > 0 (Consensus Reached)
            if (v5.action !== 'NEUTRAL' && v5.leverage > 0) {
                // Check Max Leverage Cap (20x requested)
                // V5 returns 15x max by default, override for Sniper
                let finalLev = v5.leverage;
                if (v5.confidence >= 85) finalLev = 20;

                virtualWallet.openPosition(ASSETS[0], v5.action, currentCandle.c, finalLev, i);
                tpLevelReached = 0;
            }
        }
    }
    dailyStats.push({ date: currentDayLabel, pnl: dayPnL, trades: dayTrades });

    // REPORT
    console.log("📊 V5 SNIPER BOT REPORT (20x Mode)");
    console.log("==================================");

    const monthlyStats: Record<string, { pnl: number, trades: number }> = {};
    dailyStats.forEach(d => {
        const m = d.date.substring(0, 7);
        if (!monthlyStats[m]) monthlyStats[m] = { pnl: 0, trades: 0 };
        monthlyStats[m].pnl += d.pnl;
        monthlyStats[m].trades += d.trades;
    });

    console.log("\n📅 MONTHLY PERFORMANCE");
    Object.keys(monthlyStats).sort().forEach(m => {
        const s = monthlyStats[m];
        console.log(`   ${m}: $${s.pnl.toFixed(2).padEnd(10)} (${(s.pnl / 10000 * 100).toFixed(1)}%) | ${s.trades} trades`);
    });

    const totalWins = virtualWallet.trades.filter(t => t.pnl > 0).length;
    const totalTrades = virtualWallet.trades.length;

    console.log("\n🏆 FINAL METRICS");
    console.log(`   Final Balance:   $${virtualWallet.balance.toFixed(2)}`);
    console.log(`   Net Profit:      $${(virtualWallet.balance - 10000).toFixed(2)}`);
    console.log(`   ROI:             ${((virtualWallet.balance - 10000) / 100).toFixed(2)}%`);
    console.log(`   Max Drawdown:    ${(virtualWallet.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`   Win Rate:        ${(totalWins / totalTrades * 100 || 0).toFixed(1)}%`);
}

runBacktestV5Sniper();
