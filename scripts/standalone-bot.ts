
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { DydxExecutionService } from '../src/services/dydx-execution';
import { ScannerService } from '../src/services/scanner';

// ANSI Colors
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

import dbConnect from '../src/lib/db';
import Trade from '../src/models/Trade';

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
                        // console.log(`[SKIP] ${symbol} - Already Active/Pending`);
                        continue;
                    }

                    // 2. Validate Signal Strength
                    console.log(`Signal: ${signal.action === 'BUY' ? GREEN : RED}${signal.action} ${symbol}${RESET} (Score: ${signal.score.toFixed(2)} | Conf: ${signal.confidence}%)`);


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
                        // User Request: "Don't put SL right away" -> WIDE Hard SL
                        // We rely on the Loop to "Soft Close" if thesis fails.
                        let tpPct = 0.15; // Wide Target (Let it run)
                        let slPct = 0.10; // Emergency Stop only (Catastrophe)

                        console.log(`${YELLOW}🛡️ SL Strategy: Wide Hard Stop (-10%) + Active Soft Management${RESET}`);

                        // Buy: TP > Price, SL < Price
                        // Sell: TP < Price, SL > Price
                        const tpPrice = isBuy ? price * (1 + tpPct) : price * (1 - tpPct);
                        const slPrice = isBuy ? price * (1 - slPct) : price * (1 + slPct);

                        const size = 50; // USD Size

                        try {
                            const res = await engine.executeOrder(
                                signal.symbol,
                                signal.action as 'BUY' | 'SELL',
                                size,
                                price,
                                1, // Leverage
                                false, // ReduceOnly
                                {
                                    tp: parseFloat(tpPrice.toFixed(4)),
                                    sl: parseFloat(slPrice.toFixed(4))
                                }
                            );

                            if (res.success) {
                                console.log(`${GREEN}✔ EXECUTION SUCCESS: ${res.txHash}${RESET}`);

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
                                        leverage: 1,
                                        status: 'OPEN',
                                        txHash: res.txHash,
                                        strategy: 'AUTO_HEADLESS',
                                        sl: parseFloat(slPrice.toFixed(4)),
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
            const activeAccount = await engine.getAccountState();
            if (activeAccount && activeAccount.openPositions) {
                const positions = activeAccount.openPositions;

                // OPTIMIZATION: Scan once if ANY position needs attention
                // Check if any position > 1.5% or < -3.0%
                let needScan = false;
                for (const key in positions) {
                    const p = positions[key];
                    const size = parseFloat(p.size);
                    if (size === 0) continue;
                    const uPnl = parseFloat(p.unrealizedPnl);
                    const entry = parseFloat(p.entryPrice);
                    const cost = Math.abs(size * entry);
                    const pnlPct = (uPnl / cost) * 100;

                    if (pnlPct < -3.0 || pnlPct > 1.5) { // Lowered TP Trigger to 1.5% for "Secure Profit"
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

                    // 1. SOFT STOP CHECK (-3% Threshold)
                    if (pnlPct < -3.0) {
                        const match = freshSignals.find((s: any) => s.symbol === symbol);
                        let shouldClose = false;
                        let closeReason = "";

                        if (!match) {
                            shouldClose = true;
                            closeReason = "Soft Stop: Signal Lost & Losing";
                        } else {
                            if (match.action !== side && match.confidence > 20) {
                                shouldClose = true;
                                closeReason = `Soft Stop: Signal Reversal (${match.action})`;
                            } else if (match.action === side && match.confidence < 30) {
                                shouldClose = true;
                                closeReason = `Soft Stop: Thesis Weakened (${match.confidence}%)`;
                            } else {
                                console.log(`${YELLOW}🛡️ HOLDING ${symbol} despite -3% (Thesis Strong: ${match.confidence}%)${RESET}`);
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
                        }
                    }

                    // 2. PROFIT TAKING (Active Management)
                    // Rule A: If PnL > 4.0%, Take Profit if Thesis Fades OR just to secure bag.
                    // Rule B: If PnL > 1.5% (Scalp), Take Profit if Signal Reverses.
                    if (pnlPct > 1.5) {
                        const match = freshSignals.find((s: any) => s.symbol === symbol);

                        let takeProfit = false;
                        let reason = "";

                        if (pnlPct > 4.0) {
                            // Strong Profit: Close if signal isn't 'BUY' (for Long) or 'SELL' (for Short)
                            // OR if we just want to bank it. Let's start with Signal Fade.
                            if (!match || match.action !== side) {
                                takeProfit = true;
                                reason = `Target Hit (+${pnlPct.toFixed(2)}%) & Signal Faded`;
                            }
                        } else {
                            // Moderate Profit (1.5% - 4.0%)
                            // Only close if signal actively opposes us
                            if (match && match.action !== side && match.confidence > 40) {
                                takeProfit = true;
                                reason = `Scalp Exit (+${pnlPct.toFixed(2)}%) - Signal Reversal`;
                            }
                        }

                        if (takeProfit) {
                            console.log(`${GREEN}💰 TAKING PROFIT: ${symbol} (${reason})${RESET}`);
                            await engine.executeOrder(
                                symbol,
                                isLong ? 'SELL' : 'BUY',
                                Math.abs(size * currentPrice),
                                currentPrice,
                                1,
                                true
                            );
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
