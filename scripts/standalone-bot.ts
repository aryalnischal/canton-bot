
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

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

// ===== STATE =====
const pendingSymbols = new Set<string>();
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const cooldownMap = new Map<string, number>(); // symbol → cooldown expiry timestamp
const MAX_POSITIONS = 3; // Max concurrent positions (dYdX equity tier: 10 orders, ~3 per position)

// ===================================================================
//  SIGNAL HANDLER — Process new signals and execute trades
// ===================================================================
async function handleSignals(
    signals: any[],
    account: any,
    engine: DydxExecutionService
) {
    if (signals.length === 0) {
        console.log(`${YELLOW}No signals found.${RESET}`);
        return;
    }

    for (const signal of signals) {
        const symbol = signal.symbol;

        // DUPLICATE GUARD
        const isAlreadyOpen = account?.openPositions && account.openPositions[symbol];
        if (isAlreadyOpen || pendingSymbols.has(symbol)) continue;

        // MAX POSITIONS GUARD
        const openCount = account?.openPositions
            ? Object.values(account.openPositions).filter((p: any) => parseFloat(p.size) !== 0).length
            : 0;
        if (openCount + pendingSymbols.size >= MAX_POSITIONS) {
            console.log(`${YELLOW}⚠️ MAX POSITIONS (${MAX_POSITIONS}) reached — skipping new entries${RESET}`);
            break; // No point checking more signals
        }

        // COOLDOWN GUARD
        const cooldownUntil = cooldownMap.get(symbol);
        if (cooldownUntil && Date.now() < cooldownUntil) {
            const minsLeft = ((cooldownUntil - Date.now()) / 60000).toFixed(0);
            console.log(`${YELLOW}⏳ COOLDOWN: ${symbol} — ${minsLeft}min remaining${RESET}`);
            continue;
        }

        console.log(`Signal: ${signal.action === 'BUY' ? GREEN : RED}${signal.action} ${symbol}${RESET} (Score: ${signal.score.toFixed(2)} | Conf: ${signal.confidence}%)`);

        // BLACKLIST CHECK
        try {
            if (await TradeAnalyzer.checkBlacklist(symbol)) {
                console.log(`${RED}⛔ ${symbol} BLACKLISTED (3+ losses in 24h)${RESET}`);
                continue;
            }
        } catch { /* DB not available */ }

        // CONFIDENCE GATE
        if (signal.confidence <= 25) {
            console.log(`${YELLOW}skipped (confidence ${signal.confidence}% < 25%)${RESET}`);
            continue;
        }

        if (signal.action === 'NEUTRAL') {
            console.log(`${YELLOW}Skipping ${symbol} (NEUTRAL / Volatility Guard)${RESET}`);
            continue;
        }

        // EXECUTE
        await executeTrade(signal, engine);
    }
}

// ===================================================================
//  TRADE EXECUTION — Place order with dynamic leverage & ATR stop loss
// ===================================================================
async function executeTrade(signal: any, engine: DydxExecutionService) {
    const { symbol, action, price } = signal;
    const isBuy = action === 'BUY';

    console.log(`${CYAN}>>> EXECUTING ${symbol}...${RESET}`);
    pendingSymbols.add(symbol);

    if (!price) {
        console.log(`${RED}✘ No Price for ${symbol}${RESET}`);
        pendingSymbols.delete(symbol);
        return;
    }

    // DYNAMIC LEVERAGE
    let targetLeverage = 3; // Default: 3x
    if (signal.confidence > 85) { targetLeverage = 10; console.log(`${GREEN}🚀🚀 MAX (${signal.confidence}%): 10x${RESET}`); }
    else if (signal.confidence > 77) { targetLeverage = 8; console.log(`${GREEN}🚀 HIGH (${signal.confidence}%): 8x${RESET}`); }
    else if (signal.confidence > 70) { targetLeverage = 5; console.log(`${GREEN}⚡ STRONG (${signal.confidence}%): 5x${RESET}`); }
    else { console.log(`${YELLOW}⚡ STANDARD (${signal.confidence}%): 3x${RESET}`); }

    // DYNAMIC POSITION SIZING — use actual free collateral, not fixed $50
    const acctState = await engine.getAccountState();
    const freeCol = parseFloat(acctState?.freeCollateral || '0');
    const baseCollateral = Math.floor(freeCol / MAX_POSITIONS);
    if (baseCollateral < 5) {
        console.log(`${RED}✘ Insufficient free collateral ($${freeCol.toFixed(2)}). Need at least $${MAX_POSITIONS * 5}.${RESET}`);
        pendingSymbols.delete(symbol);
        return;
    }
    const size = baseCollateral * targetLeverage;
    console.log(`${YELLOW}💰 Collateral: $${baseCollateral} × ${targetLeverage}x = $${size} notional${RESET}`);
    const tpPrice = isBuy ? price * 1.015 : price * 0.985;

    // ATR-BASED STOP LOSS
    let slDistance = 0.05;
    if (signal.candles?.length >= 14) {
        const atr = calculateATR(signal.candles, 14);
        const atrPct = atr / price;
        slDistance = Math.min(Math.max(atrPct * 2, 0.03), 0.10);
        console.log(`${YELLOW}🛡️ Dynamic SL: ATR=${(atrPct * 100).toFixed(2)}% → Distance: ${(slDistance * 100).toFixed(2)}%${RESET}`);
    }

    // Snapshot position BEFORE order
    const preAccount = await engine.getAccountState();
    const prePosSize = Math.abs(parseFloat(preAccount?.openPositions?.[symbol]?.size || '0'));

    try {
        const res = await engine.executeOrder(
            symbol, action, size, price, targetLeverage, false,
            {
                sl: isBuy
                    ? parseFloat((price * (1 - slDistance)).toFixed(4))
                    : parseFloat((price * (1 + slDistance)).toFixed(4)),
                tp: price,
            }
        );

        if (res.success) {
            console.log(`${GREEN}✔ ORDER SUBMITTED: ${res.txHash} ($${size}, ${targetLeverage}x)${RESET}`);

            // FILL VERIFICATION: Wait 3s then compare position size before vs after
            await new Promise(r => setTimeout(r, 3000));
            const postAccount = await engine.getAccountState();
            const pos = postAccount?.openPositions?.[symbol];
            const postPosSize = Math.abs(parseFloat(pos?.size || '0'));

            // Check if position actually CHANGED (not just pre-existing dust)
            if (postPosSize <= prePosSize) {
                console.log(`${RED}✘ FILL REJECTED: ${symbol} — position unchanged (pre: ${prePosSize}, post: ${postPosSize}). Skipping DB save.${RESET}`);
                pendingSymbols.delete(symbol);
                return;
            }

            console.log(`${GREEN}✔ FILL CONFIRMED: ${symbol} size=${pos!.size} (was ${prePosSize})${RESET}`);
            setTimeout(() => pendingSymbols.delete(symbol), 30000);

            try {
                await Trade.create({
                    id: res.txHash || `TX-${Date.now()}`,
                    symbol, action,
                    price: parseFloat(pos.entryPrice) || res.filledPrice || price,
                    size: Math.abs(postPosSize),
                    leverage: targetLeverage,
                    status: 'OPEN',
                    txHash: res.txHash,
                    strategy: 'AUTO_HEADLESS',
                    tp: parseFloat(tpPrice.toFixed(4)),
                    entryTime: Date.now(),
                    signalSnapshot: {
                        score: signal.score,
                        confidence: signal.confidence,
                        reasons: signal.reasons || [],
                        marketState: {}
                    }
                });
                console.log(`${GREEN}✔ DB SAVED${RESET}`);
            } catch (dbErr) {
                console.error(`${RED}✘ DB SAVE FAILED:${RESET}`, dbErr);
            }
        } else {
            console.log(`${RED}✘ FAILED: ${res.error}${RESET}`);
            pendingSymbols.delete(symbol);
        }
    } catch (err) {
        console.error("Execution Error:", err);
        pendingSymbols.delete(symbol);
    }
}

// ===================================================================
//  RECONCILIATION — Close "ghost" trades (DB=OPEN, dYdX=closed)
// ===================================================================
async function reconcileGhosts(engine: DydxExecutionService) {
    const account = await engine.getAccountState();
    if (!account) return;

    const openPositions = account.openPositions || {};
    const dbOpenTrades = await Trade.find({ status: 'OPEN' });

    for (const t of dbOpenTrades) {
        const pos = openPositions[t.symbol];
        const size = pos ? parseFloat(pos.size) : 0;
        const entryTime = t.entryTime || t.createdAt;
        const age = Date.now() - new Date(entryTime).getTime();

        if (age < 30000) continue; // Grace period

        if (!pos || size === 0) {
            console.log(`${CYAN}👻 RECONCILE: ${t.symbol} closed on-chain → marking CLOSED${RESET}`);
            t.status = 'CLOSED';
            t.exitReason = 'Limit/External Close (Reconciled)';
            t.exitTime = Date.now();
            await t.save();
            startCooldown(t.symbol);
        }
    }
}

// ===================================================================
//  POSITION MANAGEMENT — Soft stops, take profits, stale exits
// ===================================================================
async function managePositions(
    engine: DydxExecutionService,
    scanner: ScannerService
) {
    const account = await engine.getAccountState();
    if (!account?.openPositions) return;

    const positions = account.openPositions;

    // Quick scan: do any positions need active management?
    let needFreshSignals = false;
    for (const key in positions) {
        const p = positions[key];
        if (parseFloat(p.size) === 0) continue;
        const pnlPct = calcPnlPct(p);
        if (pnlPct < -5.0 || pnlPct > 0.5) { needFreshSignals = true; break; }
    }

    let freshSignals: any[] = [];
    if (needFreshSignals) {
        freshSignals = (await scanner.scanMarkets()).signals || [];
    }

    for (const key in positions) {
        const p = positions[key];
        const symbol = p.market;
        const size = parseFloat(p.size);
        if (size === 0) continue;

        const isLong = size > 0;
        const closeSide = isLong ? 'SELL' : 'BUY';
        const entryPrice = parseFloat(p.entryPrice);
        const currentPrice = parseFloat(p.oraclePrice || p.entryPrice);
        const uPnl = parseFloat(p.unrealizedPnl);
        const cost = Math.abs(size * entryPrice);
        const pnlPct = (uPnl / cost) * 100;

        console.log(`[MANAGE] ${symbol} (${isLong ? 'BUY' : 'SELL'}) PnL: ${pnlPct.toFixed(2)}% ($${uPnl.toFixed(2)})`);

        // 1. SOFT STOP (-5% threshold)
        if (pnlPct < -5.0) {
            await handleSoftStop(symbol, closeSide, size, currentPrice, pnlPct, uPnl, freshSignals, engine, isLong);
            continue;
        }

        // 2. PROFIT TAKING (ROE-based)
        await handleTakeProfit(symbol, closeSide, size, currentPrice, pnlPct, uPnl, engine, isLong);

        // 3. STALE GUARD (>4h with <1% gain)
        await handleStaleExit(p, symbol, closeSide, size, currentPrice, pnlPct, uPnl, engine, isLong);
    }
}

// ===== HELPERS =====

function calcPnlPct(p: any): number {
    const size = parseFloat(p.size);
    const uPnl = parseFloat(p.unrealizedPnl);
    const entry = parseFloat(p.entryPrice);
    const cost = Math.abs(size * entry);
    return (uPnl / cost) * 100;
}

function startCooldown(symbol: string) {
    cooldownMap.set(symbol, Date.now() + COOLDOWN_MS);
    console.log(`${YELLOW}⏳ ${symbol} cooldown started (30min)${RESET}`);
}

async function closeAndRecord(
    symbol: string, closeSide: 'BUY' | 'SELL', sizeUsd: number,
    currentPrice: number, pnlPct: number, uPnl: number,
    exitReason: string, engine: DydxExecutionService
) {
    await engine.executeOrder(symbol, closeSide, sizeUsd, currentPrice, 1, true);
    await Trade.updateMany(
        { symbol, status: 'OPEN' },
        { status: 'CLOSED', exitPrice: currentPrice, exitTime: Date.now(), exitReason, pnlValue: uPnl, pnlPercent: pnlPct }
    );
    startCooldown(symbol);
}

async function handleSoftStop(
    symbol: string, closeSide: 'BUY' | 'SELL', size: number,
    currentPrice: number, pnlPct: number, uPnl: number,
    signals: any[], engine: DydxExecutionService, isLong: boolean
) {
    const match = signals.find((s: any) => s.symbol === symbol);
    let shouldClose = false;
    let reason = "";

    if (!match) {
        shouldClose = true;
        reason = "Soft Stop: Signal Lost & Losing (>5%)";
    } else if (match.action !== (isLong ? 'BUY' : 'SELL') && match.confidence > 20) {
        shouldClose = true;
        reason = `Soft Stop: Signal Reversal (${match.action})`;
    } else if (match.action === (isLong ? 'BUY' : 'SELL') && match.confidence < 30) {
        shouldClose = true;
        reason = `Soft Stop: Thesis Weakened (${match.confidence}%)`;
    } else {
        console.log(`${YELLOW}🛡️ HOLDING ${symbol} despite -5% (Thesis Strong: ${match.confidence}%)${RESET}`);
    }

    if (shouldClose) {
        console.log(`${RED}🚨 MANAGED EXIT: ${symbol} (${reason})${RESET}`);
        await closeAndRecord(symbol, closeSide, Math.abs(size * currentPrice), currentPrice, pnlPct, uPnl, reason, engine);
    }
}

async function handleTakeProfit(
    symbol: string, closeSide: 'BUY' | 'SELL', size: number,
    currentPrice: number, pnlPct: number, uPnl: number,
    engine: DydxExecutionService, isLong: boolean
) {
    const matchedTrade = await Trade.findOne({ symbol, status: 'OPEN' });
    const leverage = matchedTrade?.leverage || 3;
    const roePct = pnlPct * leverage;

    // TP1: >14% ROE → Close 50%
    if (roePct > 14.0 && matchedTrade && !matchedTrade.isPartiallyClosed) {
        console.log(`${GREEN}💰 TP1: ${symbol} (+${roePct.toFixed(2)}% ROE) — Securing 50%${RESET}`);
        await engine.executeOrder(symbol, closeSide, Math.abs(size * currentPrice) * 0.5, currentPrice, 1, true);
        matchedTrade.isPartiallyClosed = true;
        await matchedTrade.save();
        console.log(`${GREEN}✔ TP1 Saved${RESET}`);
    }
    // TP2: >40% ROE → Close remainder
    else if (roePct > 40.0) {
        console.log(`${GREEN}🚀 TP2 MOONBAG: ${symbol} (+${roePct.toFixed(2)}% ROE) — Closing All${RESET}`);
        await closeAndRecord(symbol, closeSide, Math.abs(size * currentPrice), currentPrice, pnlPct, uPnl, "TP2 (Moonbag ROE 40%)", engine);
    }
}

async function handleStaleExit(
    p: any, symbol: string, closeSide: 'BUY' | 'SELL', size: number,
    currentPrice: number, pnlPct: number, uPnl: number,
    engine: DydxExecutionService, isLong: boolean
) {
    if (!p.createdAt) return;
    const durationHours = (Date.now() - new Date(p.createdAt).getTime()) / 3_600_000;

    if (durationHours > 4.0 && pnlPct < 1.0) {
        console.log(`${YELLOW}⌛ STALE: ${symbol} (${durationHours.toFixed(1)}h, ${pnlPct.toFixed(2)}%)${RESET}`);
        await closeAndRecord(symbol, closeSide, Math.abs(size * currentPrice), currentPrice, pnlPct, uPnl, `Stale (>${durationHours.toFixed(0)}h)`, engine);
    }
}

// ===================================================================
//  MAIN LOOP
// ===================================================================
async function main() {
    console.log(`${CYAN}=========================================${RESET}`);
    console.log(`${CYAN}   CANTON TRADING BOT - HEADLESS MODE    ${RESET}`);
    console.log(`${CYAN}=========================================${RESET}`);

    const engine = new DydxExecutionService();
    const scanner = new ScannerService();

    console.log("Connecting to MongoDB...");
    await dbConnect();
    console.log(`${GREEN}DB Connected.${RESET}`);

    console.log("Initializing Execution Engine...");
    await engine.getAccountState();
    console.log(`${GREEN}Engine Ready.${RESET}`);

    // ===== PREFLIGHT HEALTH CHECK =====
    console.log(`\n${CYAN}--- Preflight API Validation ---${RESET}`);
    let preflightPassed = true;

    // 1. dYdX API
    try {
        const acct = await engine.getAccountState();
        if (acct?.equity) {
            console.log(`${GREEN}✔ dYdX API     : OK (Balance: $${parseFloat(acct.equity).toFixed(2)})${RESET}`);
        } else {
            console.log(`${RED}✘ dYdX API     : No account data${RESET}`);
            preflightPassed = false;
        }
    } catch (e) {
        console.log(`${RED}✘ dYdX API     : FAILED${RESET}`, e);
        preflightPassed = false;
    }

    // 2. CoinGlass API
    try {
        const { fetchCoinglassData } = await import('../src/services/coinglass');
        const cg = await fetchCoinglassData('BTC-USD');
        console.log(`${GREEN}✔ CoinGlass API: OK (BTC FR: ${(cg.fundingRate * 100).toFixed(4)}%)${RESET}`);
    } catch (e) {
        console.log(`${YELLOW}⚠ CoinGlass API: Degraded (will use defaults)${RESET}`);
    }

    // 3. DeFiLlama (On-Chain)
    try {
        const { fetchOnChainMetrics } = await import('../src/services/on-chain');
        const oc = await fetchOnChainMetrics('global');
        console.log(`${GREEN}✔ DeFiLlama    : OK (TVL Change: ${oc.tvlChange >= 0 ? '+' : ''}${oc.tvlChange.toFixed(2)}%)${RESET}`);
    } catch (e) {
        console.log(`${YELLOW}⚠ DeFiLlama    : Degraded (will use defaults)${RESET}`);
    }

    // 4. MongoDB
    try {
        const count = await Trade.countDocuments();
        console.log(`${GREEN}✔ MongoDB      : OK (${count} trades in DB)${RESET}`);
    } catch (e) {
        console.log(`${YELLOW}⚠ MongoDB      : Degraded (trades won't persist)${RESET}`);
    }

    if (!preflightPassed) {
        console.log(`${RED}\n⛔ CRITICAL: dYdX API failed preflight. Cannot trade safely. Exiting.${RESET}`);
        process.exit(1);
    }

    console.log(`${GREEN}\n✅ All systems operational. Starting scan loop...${RESET}\n`);

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

            // B. Scan & Execute Signals
            const { signals } = await scanner.scanMarkets();
            await handleSignals(signals, account, engine);

            // C. Reconcile ghost trades
            await reconcileGhosts(engine);

            // D. Manage open positions
            await managePositions(engine, scanner);

        } catch (e) {
            console.error(`${RED}Loop Error:${RESET}`, e);
        }

        await new Promise(r => setTimeout(r, 30000));
    }
}

main();
