
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { DydxExecutionService } from '../src/services/dydx-execution';
import { ScannerService } from '../src/services/scanner';
import { calculateATR } from '../src/lib/indicators';

// ANSI Colors
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

import dbConnect from '../src/lib/db';
import Trade from '../src/models/Trade';
import { TradeAnalyzer } from '../src/services/trade-analyzer';

async function main() {
    console.log(`${CYAN}=========================================${RESET}`);
    console.log(`${CYAN}   CANTON TRADING BOT - HEADLESS MODE    ${RESET}`);
    console.log(`${CYAN}=========================================${RESET}`);

    // 1. Initialize Services
    const engine = new DydxExecutionService();
    const scanner = new ScannerService();

    // Connect to DB
    console.log("Connecting to MongoDB...");
    await dbConnect();
    console.log(`${GREEN}DB Connected.${RESET}`);

    // Wait for Engine Init
    console.log("Initializing Execution Engine...");
    await engine.getAccountState(); // Triggers await
    console.log(`${GREEN}Engine Ready.${RESET}`);

    // 2. Loop
    // TRACKING: Keep track of pending orders to prevent "Machine Gun" duplicates
    // The Account State is polled, so it might be 1-2s stale.
    // We use a local Set to block immediate re-entry.
    const pendingSymbols = new Set<string>();

    // COOLDOWN: 30-minute cooloff after a trade closes on a symbol
    // Prevents re-entering the same asset immediately after close
    const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
    const cooldownMap = new Map<string, number>(); // symbol → timestamp of close

    while (true) {
        try {
            console.log(`\n-----------------------------------------`);
            console.log(`[${new Date().toLocaleTimeString()}] Scanning Markets...`);

            // A. Check Balance
            const account = await engine.getAccountState();
            if (account) {
                const equity = parseFloat(account.equity || '0');
                const freeCol = parseFloat(account.freeCollateral || '0');
                console.log(`Balance: ${GREEN}$${equity.toFixed(2)}${RESET} | Free: $${freeCol.toFixed(2)}`);
            }

            // B. Scan
            const { signals } = await scanner.scanMarkets();

            if (signals.length === 0) {
                console.log(`${YELLOW}No signals found.${RESET}`);
            } else {
                for (const signal of signals) {
                    // 1. Check if we already have a position
                    const symbol = signal.symbol;

                    // STRICT DUPLICATE GUARD
                    const isAlreadyOpen = account?.openPositions && account.openPositions[symbol];
                    const isPending = pendingSymbols.has(symbol);

                    if (isAlreadyOpen || isPending) {
                        continue;
                    }

                    // COOLDOWN GUARD (30min after last close)
                    const cooldownUntil = cooldownMap.get(symbol);
                    if (cooldownUntil && Date.now() < cooldownUntil) {
                        const minsLeft = ((cooldownUntil - Date.now()) / 60000).toFixed(0);
                        console.log(`${YELLOW}⏳ COOLDOWN: ${symbol} — ${minsLeft}min remaining before re-entry${RESET}`);
                        continue;
                    }

                    // 2. Validate Signal Strength
                    console.log(`Signal: ${signal.action === 'BUY' ? GREEN : RED}${signal.action} ${symbol}${RESET} (Score: ${signal.score.toFixed(2)} | Conf: ${signal.confidence}%)`);

                    // FIX #5: BLACKLIST CHECK (Skip symbols with 3+ recent losses)
                    try {
                        const isBlacklisted = await TradeAnalyzer.checkBlacklist(symbol);
                        if (isBlacklisted) {
                            console.log(`${RED}⛔ ${symbol} BLACKLISTED (3+ losses in 24h). Skipping.${RESET}`);
                            continue;
                        }
                    } catch { /* DB not available, skip check */ }

                    // C. Auto-Execute (If High Confidence)
                    // Threshold: 45% (Matches 'Active Scalp' logic in analysis-v5)
                    if (signal.confidence > 45) {
                        // 3. CHECK ACTION (Fix: Don't execute NEUTRAL signals from Volatility Guard)
                        if (signal.action === 'NEUTRAL') {
                            console.log(`${YELLOW}Skipping ${signal.symbol} (NEUTRAL Action / Volatility Guard)${RESET}`);
                            continue;
                        }

                        console.log(`${CYAN}>>> EXECUTING ${signal.symbol}...${RESET}`);
                        // LOCK IMMEDIATELY
                        pendingSymbols.add(symbol);

                        // Execute with Risk Management
                        // TP: 4% | SL: 2%
                        const price = signal.price;
                        if (!price) {
                            console.log(`${RED}✘ No Price for ${signal.symbol}${RESET}`);
                            pendingSymbols.delete(symbol);
                            continue;
                        }

                        const isBuy = signal.action === 'BUY';

                        // DYNAMIC TP/SL LOGIC (ENTRY)
                        // User Request: "TP1 at 0.8% (was 0.5%), TP2 at 1.5% (was 1.0%)"
                        let tpPct = 0.015; // Hard Target 1.5% (TP2)

                        console.log(`${YELLOW}🛡️ SL Strategy: Hard TP (+1.5%) & Soft Management Only (No Hard SL)${RESET}`);

                        // Buy: TP > Price, SL < Price
                        const tpPrice = isBuy ? price * (1 + tpPct) : price * (1 - tpPct);

                        // We do NOT place a Hard SL (User request). 
                        // We rely on the Loop's Soft SL (-5%) to close if needed.


                        // DYNAMIC LEVERAGE & SIZING (User Request)
                        // "Most coins max 10x" -> Adjusted Tiers:
                        // > 85% -> 10x
                        // > 77% -> 8x
                        // > 70% -> 5x
                        // > 45% -> 3x (Standard)

                        const BASE_COLLATERAL = 50; // $50 Risk per trade
                        let targetLeverage = 3;     // Default: 3x (Low/Medium Conviction)

                        if (signal.confidence > 85) {
                            targetLeverage = 10;
                            console.log(`${GREEN}🚀🚀 MAX CONVICTION (${signal.confidence}%): Boosting Leverage to 10x${RESET}`);
                        } else if (signal.confidence > 77) {
                            targetLeverage = 8;
                            console.log(`${GREEN}🚀 HIGH CONVICTION (${signal.confidence}%): Boosting Leverage to 8x${RESET}`);
                        } else if (signal.confidence > 70) {
                            targetLeverage = 5;
                            console.log(`${GREEN}⚡ STRONG CONVICTION (${signal.confidence}%): Boosting Leverage to 5x${RESET}`);
                        } else {
                            console.log(`${YELLOW}⚡ STANDARD ENTRY (${signal.confidence}%): Using 3x Leverage${RESET}`);
                        }

                        const size = BASE_COLLATERAL * targetLeverage; // $150 to $500

                        try {
                            // DYNAMIC ATR-BASED STOP LOSS
                            // Adapts to each asset's actual volatility:
                            // - BTC (~1.5% daily range) → ~3% SL
                            // - HYPE/alts (~6% range)   → ~8% SL (capped)
                            // Uses 2× ATR so normal volatility doesn't trigger the SL.
                            let slDistance = 0.05; // Fallback: 5%
                            if (signal.candles && signal.candles.length >= 14) {
                                const atr = calculateATR(signal.candles, 14);
                                const atrPct = atr / price;
                                slDistance = Math.min(Math.max(atrPct * 2, 0.015), 0.08); // 2×ATR, clamped 1.5%-8%
                                console.log(`${YELLOW}🛡️ Dynamic SL: ATR=$${atr.toFixed(4)} (${(atrPct * 100).toFixed(2)}%) → SL Distance: ${(slDistance * 100).toFixed(2)}%${RESET}`);
                            } else {
                                console.log(`${YELLOW}🛡️ SL: No candle data, using fallback 5%${RESET}`);
                            }

                            const res = await engine.executeOrder(
                                signal.symbol,
                                signal.action as 'BUY' | 'SELL',
                                size,
                                price,
                                targetLeverage, // Leverage (Informational for generic engines, effectively Size/Collateral)
                                false, // ReduceOnly
                                {
                                    // ATR-BASED STOP LOSS (Volatility Adaptive)
                                    sl: isBuy
                                        ? parseFloat((price * (1 - slDistance)).toFixed(4))
                                        : parseFloat((price * (1 + slDistance)).toFixed(4)),

                                    // LAYERED TP (Exchange-Level Safety Net)
                                    // Pass entry price so placeTriggers() creates 3 reduce-only
                                    // TP orders at +5%/+12%/+30% (25%/25%/50% of position).
                                    tp: price,
                                }
                            );

                            if (res.success) {
                                console.log(`${GREEN}✔ EXECUTION SUCCESS: ${res.txHash} (Size: $${size}, Lev: ${targetLeverage}x)${RESET}`);

                                // Keep Lock for 30s to allow account poll to catch up
                                setTimeout(() => pendingSymbols.delete(symbol), 30000);

                                // D. SAVE TO DB (WITH REASONING)
                                try {
                                    await Trade.create({
                                        id: res.txHash || `TX-${Date.now()}`,
                                        symbol: signal.symbol,
                                        action: signal.action,
                                        price: res.filledPrice || price,
                                        size: res.filledSize || size,
                                        leverage: targetLeverage, // SAVE ACTUAL LEVERAGE
                                        status: 'OPEN',
                                        txHash: res.txHash,
                                        strategy: 'AUTO_HEADLESS',
                                        tp: parseFloat(tpPrice.toFixed(4)),
                                        entryTime: Date.now(),
                                        // SNAPSHOT
                                        signalSnapshot: {
                                            score: signal.score,
                                            confidence: signal.confidence,
                                            reasons: signal.reasons || [],
                                            marketState: {}
                                        }
                                    });
                                    console.log(`${GREEN}✔ DB SAVED (Reasoning Logged)${RESET}`);
                                } catch (dbErr) {
                                    console.error(`${RED}✘ DB SAVE FAILED:${RESET}`, dbErr);
                                }

                            } else {
                                console.log(`${RED}✘ EXECUTION FAILED: ${res.error}${RESET}`);
                                pendingSymbols.delete(symbol); // Unlock
                            }
                        } catch (err) {
                            console.error("Execution Error:", err);
                            pendingSymbols.delete(symbol); // Unlock
                        }
                    } else {
                        console.log(`${YELLOW}skipped (confidence ${signal.confidence}% < 45%)${RESET}`);
                    }
                }
            }

            // -----------------------------------------
            // D. POSITION MANAGEMENT (Soft Stop Logic & Active TP)
            // -----------------------------------------
            // -----------------------------------------
            // D. RECONCILIATION ("Ghost" Trades)
            // If DB says OPEN but dYdX says NO POSITION -> It hit Limit TP/SL.
            // -----------------------------------------
            const activeAccount = await engine.getAccountState();

            if (activeAccount) {
                const openPositions = activeAccount.openPositions || {};

                // Get ALL OPEN trades from DB
                const dbOpenTrades = await Trade.find({ status: 'OPEN' });

                for (const t of dbOpenTrades) {
                    // Check if this symbol exists in dYdX positions
                    const pos = openPositions[t.symbol];
                    const size = pos ? parseFloat(pos.size) : 0;

                    // GRACE PERIOD: Don't close trades created < 30s ago
                    // (Prevents race condition where DB is faster than dYdX API)
                    const entryTime = t.entryTime || t.createdAt;
                    const age = Date.now() - new Date(entryTime).getTime();
                    if (age < 30000) continue;

                    if (!pos || size === 0) {
                        console.log(`${CYAN}👻 RECONCILIATION: ${t.symbol} is closed on-chain but OPEN in DB. Marking CLOSED.${RESET}`);

                        // We don't know exact exit price without fetching fills, 
                        // so we assume it hit TP or SL.
                        // For now, mark as CLOSED so it stops appearing as "Open $0 PnL".
                        t.status = 'CLOSED';
                        t.exitReason = 'Limit/External Close (Reconciled)';
                        t.exitTime = Date.now();
                        await t.save();
                        // Start 30min cooldown
                        cooldownMap.set(t.symbol, Date.now() + COOLDOWN_MS);
                        console.log(`${YELLOW}⏳ ${t.symbol} cooldown started (30min)${RESET}`);
                    }
                }
            }

            if (activeAccount && activeAccount.openPositions) {
                const positions = activeAccount.openPositions;

                // OPTIMIZATION: Scan once if ANY position needs attention
                // Check if any position > 0.5% (TP1) or < -5.0% (Soft SL)
                let needScan = false;
                for (const key in positions) {
                    const p = positions[key];
                    const size = parseFloat(p.size);
                    if (size === 0) continue;
                    const uPnl = parseFloat(p.unrealizedPnl);
                    const entry = parseFloat(p.entryPrice);
                    const cost = Math.abs(size * entry);
                    const pnlPct = (uPnl / cost) * 100;

                    if (pnlPct < -5.0 || pnlPct > 0.5) { // Active Management Zone
                        needScan = true;
                        break;
                    }
                }

                let freshSignals: any[] = [];
                if (needScan) {
                    const scanRes = await scanner.scanMarkets();
                    freshSignals = scanRes.signals || [];
                }

                for (const key in positions) {
                    const p = positions[key];
                    const symbol = p.market;
                    const size = parseFloat(p.size);
                    if (size === 0) continue;

                    const isLong = size > 0;
                    const side = isLong ? 'BUY' : 'SELL';
                    const entryPrice = parseFloat(p.entryPrice);
                    const currentPrice = parseFloat(p.oraclePrice || p.entryPrice);
                    const uPnl = parseFloat(p.unrealizedPnl);
                    const cost = Math.abs(size * entryPrice);
                    const pnlPct = (uPnl / cost) * 100;

                    console.log(`[MANAGE] ${symbol} (${side}) PnL: ${pnlPct.toFixed(2)}% ($${uPnl.toFixed(2)})`);

                    // 1. SOFT STOP CHECK (-5% Threshold - WIDENED)
                    if (pnlPct < -5.0) {
                        const match = freshSignals.find((s: any) => s.symbol === symbol);
                        let shouldClose = false;
                        let closeReason = "";

                        if (!match) {
                            shouldClose = true;
                            closeReason = "Soft Stop: Signal Lost & Losing (>5%)";
                        } else {
                            if (match.action !== side && match.confidence > 20) {
                                shouldClose = true;
                                closeReason = `Soft Stop: Signal Reversal (${match.action})`;
                            } else if (match.action === side && match.confidence < 30) {
                                shouldClose = true;
                                closeReason = `Soft Stop: Thesis Weakened (${match.confidence}%)`;
                            } else {
                                console.log(`${YELLOW}🛡️ HOLDING ${symbol} despite -5% (Thesis Strong: ${match.confidence}%)${RESET}`);
                            }
                        }

                        if (shouldClose) {
                            console.log(`${RED}🚨 MANAGED EXIT: ${symbol} (${closeReason})${RESET}`);
                            await engine.executeOrder(
                                symbol,
                                isLong ? 'SELL' : 'BUY',
                                Math.abs(size * currentPrice),
                                currentPrice,
                                1,
                                true
                            );

                            // UPDATE DB
                            await Trade.updateMany(
                                { symbol: symbol, status: 'OPEN' },
                                {
                                    status: 'CLOSED',
                                    exitPrice: currentPrice,
                                    exitTime: Date.now(),
                                    exitReason: closeReason,
                                    pnlValue: uPnl,
                                    pnlPercent: pnlPct
                                }
                            );
                            // Start 30min cooldown
                            cooldownMap.set(symbol, Date.now() + COOLDOWN_MS);
                            console.log(`${YELLOW}⏳ ${symbol} cooldown started (30min)${RESET}`);
                        }
                    }

                    // 2. PROFIT TAKING (ROE Based)
                    // User Request: "14% ROE then let runner run"

                    // A. Determine Leverage (from DB if possible, else estimate)
                    const matchedTrade = await Trade.findOne({ symbol: symbol, status: 'OPEN' });
                    const leverage = matchedTrade ? matchedTrade.leverage : 3; // Default 3x if missing

                    // B. Calculate ROE
                    // ROE = (Unrealized PnL / Margin) * 100
                    // Simplified: ROE = (Price Move %) * Leverage
                    const roePct = pnlPct * leverage;

                    // TP1: > 14% ROE -> Close 50%
                    if (roePct > 14.0) {

                        // Check if already partially closed
                        if (matchedTrade && !matchedTrade.isPartiallyClosed) {
                            console.log(`${GREEN}💰 TP1 HIT: ${symbol} (+${roePct.toFixed(2)}% ROE) - Securing 50%${RESET}`);
                            await engine.executeOrder(
                                symbol,
                                isLong ? 'SELL' : 'BUY',
                                Math.abs(size * currentPrice) * 0.5, // 50% Size
                                currentPrice,
                                1,
                                true // ReduceOnly
                            );

                            // UPDATE DB FLAG
                            if (matchedTrade) {
                                matchedTrade.isPartiallyClosed = true;
                                await matchedTrade.save();
                                console.log(`${GREEN}✔ TP1 Flag Saved${RESET}`);
                            }
                        }

                        // TP2: > 40% ROE (Moonbag / Runner)
                        // Only close remainder if it really rips.
                        else if (roePct > 40.0) {
                            console.log(`${GREEN}🚀 TP2 MOONBAG: ${symbol} (+${roePct.toFixed(2)}% ROE) - Closing Remainder${RESET}`);
                            await engine.executeOrder(
                                symbol,
                                isLong ? 'SELL' : 'BUY',
                                Math.abs(size * currentPrice), // Full Remainder
                                currentPrice,
                                1,
                                true // ReduceOnly
                            );

                            // UPDATE DB
                            await Trade.updateMany(
                                { symbol: symbol, status: 'OPEN' },
                                {
                                    status: 'CLOSED',
                                    exitPrice: currentPrice,
                                    exitTime: Date.now(),
                                    exitReason: "TP2 (Moonbag ROE 40%)",
                                    pnlValue: uPnl,
                                    pnlPercent: pnlPct
                                }
                            );
                            // Start 30min cooldown
                            cooldownMap.set(symbol, Date.now() + COOLDOWN_MS);
                            console.log(`${YELLOW}⏳ ${symbol} cooldown started (30min)${RESET}`);
                        }
                    }

                    // 3. STALE GUARD (Time-Based Exit - 4 Hours)
                    if (p.createdAt) {
                        const entryTime = new Date(p.createdAt).getTime();
                        const durationMs = Date.now() - entryTime;
                        const durationHours = durationMs / (1000 * 60 * 60);

                        if (durationHours > 4.0 && pnlPct < 1.0) {
                            console.log(`${YELLOW}⌛ STALE EXIT: ${symbol} (Open ${durationHours.toFixed(1)}h, PnL ${pnlPct.toFixed(2)}%) - Freeing Capital${RESET}`);
                            await engine.executeOrder(
                                symbol,
                                isLong ? 'SELL' : 'BUY',
                                Math.abs(size * currentPrice),
                                currentPrice,
                                1,
                                true
                            );

                            // UPDATE DB
                            await Trade.updateMany(
                                { symbol: symbol, status: 'OPEN' },
                                {
                                    status: 'CLOSED',
                                    exitPrice: currentPrice,
                                    exitTime: Date.now(),
                                    exitReason: `Stale (>4h)`,
                                    pnlValue: uPnl,
                                    pnlPercent: pnlPct
                                }
                            );
                            // Start 30min cooldown
                            cooldownMap.set(symbol, Date.now() + COOLDOWN_MS);
                            console.log(`${YELLOW}⏳ ${symbol} cooldown started (30min)${RESET}`);
                        }
                    }
                }
            }

        } catch (e) {
            console.error(`${RED}Loop Error:${RESET}`, e);
        }

        // Wait 30s
        await new Promise(r => setTimeout(r, 30000));
    }
}

main();
