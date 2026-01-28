import { useState, useEffect, useRef } from "react";
// import { useMarketData } from "@/hooks/use-market-data";
import { useRealTimeData } from "@/hooks/use-realtime-data"; // V2 REAL-TIME HOOK
import { useRealTime } from "@/context/RealTimeContext"; // WEBSOCKET CONTEXT
import { generateTradeSignal, TradeSignal, ManualAnalysisData } from "@/lib/analysis";
import { clientLogger } from "@/lib/client-logger";
import { SUPPORTED_ASSETS, fetchBinanceData } from "@/lib/api";
import { ArrowUpRight, ArrowDownRight, Activity, Percent, Zap, Trash2, Award, Settings, X, AlertTriangle } from "lucide-react";

import { DailyPerformance } from "./daily-performance";
import { DataInputForm } from "./data-input";
import { PnLCalculator } from "./pnl-calculator";
import { fetchTopVolumeAssets } from "@/lib/api";

// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// GLOBAL LOCKS (Prevent Duplicates across Re-Renders)
// ----------------------------------------------------------------------
// Note: We use module-level Sets for locks that persist across re-renders but clear on refresh.
// However, for strict React purity, we use useRef inside the component or a Context.
// Retaining module-level for global deduplication safety net.
const globalProcessedSignals = new Set<string>();

// V2.1 TREND GUARD HELPER (Raw Fetch for reliability)
async function fetchCandlesAndCheckTrend(symbol: string): Promise<{ trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL', sma50: number, price: number }> {
    try {
        const endTime = Date.now();
        const startTime = endTime - (60 * 60 * 60 * 1000); // 60 hours buffer for 50 candle calc

        // Use Internal Proxy to avoid Rate Limits (with cache)
        const response = await fetch(`/api/market?type=CANDLE_SNAPSHOT&symbol=${symbol}&interval=1h&startTime=${startTime}&endTime=${endTime}`);
        const candles = await response.json();

        if (!Array.isArray(candles) || candles.length < 50) {
            return { trend: 'NEUTRAL', sma50: 0, price: 0 };
        }

        // Sort just in case
        candles.sort((a: any, b: any) => a.t - b.t);

        const closes = candles.map((c: any) => parseFloat(c.c));
        const currentPrice = closes[closes.length - 1];

        // Calculate SMA 50
        const smaSlice = closes.slice(-50);
        const sma50 = smaSlice.reduce((a, b) => a + b, 0) / smaSlice.length;

        const trend = currentPrice > sma50 ? "BULLISH" : "BEARISH";
        return { trend, sma50, price: currentPrice };

    } catch (e) {
        console.error("Trend Fetch Error:", e);
        return { trend: 'NEUTRAL', sma50: 0, price: 0 };
    }
}


import { ActivityLog } from "./activity-log";
import { Terminal } from "lucide-react";

export function SignalScanner() {
    const [showLogs, setShowLogs] = useState(false);
    const [history, setHistory] = useState<any[]>([]);
    const [closedHistory, setClosedHistory] = useState<any[]>(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('canton_closed_history');
                return saved ? JSON.parse(saved) : [];
            } catch (e) { return []; }
        }
        return [];
    });

    // UI STATES
    const [timeframe, setTimeframe] = useState('AUTO'); // Controlled by UI, defaults to AUTO (logic inside hook handles this?)
    // Actually, useRealTimeData takes a concrete timeframe. 
    // If we want Auto-Switching, we need logic. For now, let's explicit '15m'.

    const [showReview, setShowReview] = useState(false);
    const [showManualInput, setShowManualInput] = useState(false);
    const [manualOverrides, setManualOverrides] = useState<Record<string, ManualAnalysisData>>({});

    // Safety Modals
    const [showConfirmLive, setShowConfirmLive] = useState(false);

    const [showCalculator, setShowCalculator] = useState(false);
    const [hotAssets, setHotAssets] = useState<any[]>([]);

    // NEW STATES
    const [isAutoTrade, setIsAutoTrade] = useState(false);
    const [ghostHistory, setGhostHistory] = useState<any[]>([]);

    const activeSymbols = useRef(new Set<string>()).current;
    const processedSignals = useRef(new Set<string>()).current;

    // REAL-TIME EQUITY
    const [equity, setEquity] = useState(250); // Default to safety base
    const [activePositions, setActivePositions] = useState<any[]>([]); // FROM API

    // ADOPTION LOGIC (New Safety Layer)
    const lastTradeTime = useRef(0); // GLOBAL THROTTLE REF
    const startupTimeRef = useRef(Date.now()); // Startup timestamp
    const lastGlobalTradeTime = useRef(Date.now() + 5 * 60 * 1000); // 5-Minute Startup Cooldown (No instant trades)

    // Config: 15-Minute Global Throttle (One trade at a time, no machine gun)
    const GLOBAL_THROTTLE_MS = 15 * 60 * 1000;

    // Adoption Logic: Wait for data warmth
    useEffect(() => {
        if (activePositions.length > 0) {
            // FIX: Delay Adoption to allow local state (addToHistory) to catch up from a fresh trade
            const timer = setTimeout(() => {
                setHistory(prevHistory => {
                    const newHistory = [...prevHistory];
                    let hasChanges = false;

                    let storageHistory: any[] = [];
                    try {
                        storageHistory = JSON.parse(localStorage.getItem('canton_signal_history') || '[]');
                    } catch (e) { storageHistory = []; }

                    activePositions.forEach(p => {
                        const rawCoin = p.coin || "";
                        const normalizedCoin = rawCoin.replace("-PERP", "");
                        const sym = normalizedCoin + "USDT";

                        const val = Math.abs(parseFloat(p.szi) * parseFloat(p.entryPx));
                        if (val < 1.0) return;

                        let isKnown = newHistory.find(h =>
                            h.symbol === sym ||
                            h.symbol === normalizedCoin ||
                            (h.symbol && h.symbol.includes(normalizedCoin))
                        );

                        if (!isKnown) {
                            const foundInStorage = storageHistory.find((h: any) =>
                                h.symbol === sym ||
                                h.symbol === normalizedCoin ||
                                (h.symbol && h.symbol.includes(normalizedCoin))
                            );

                            if (foundInStorage) {
                                console.log(`[SYNC] Found ${sym} in Storage. Recovering Strategy: ${foundInStorage.strategy}`);
                                newHistory.push(foundInStorage);
                                hasChanges = true;
                                isKnown = foundInStorage;
                            }
                        }

                        if (!isKnown) {
                            console.log(`[ADOPTION] Found Orphaned Position: ${sym}. Adopting...`);
                            const entryPrice = parseFloat(p.entryPx);
                            const sizeSz = parseFloat(p.szi);
                            const liqPrice = parseFloat(p.liquidationPx);
                            const isLong = sizeSz > 0;
                            const action = isLong ? 'BUY' : 'SELL';

                            let smartSl = isLong ? entryPrice * 0.95 : entryPrice * 1.05;
                            if (liqPrice > 0) {
                                const distance = Math.abs(entryPrice - liqPrice);
                                smartSl = isLong ? (entryPrice - distance * 0.5) : (entryPrice + distance * 0.5);
                            }

                            const adoptedTrade = {
                                id: `ADOPTED-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
                                timestamp: Date.now(),
                                symbol: sym,
                                timeframe: '4h',
                                action,
                                leverage: '5x',
                                strategy: 'ADOPTED',
                                price: entryPrice,
                                tp: isLong ? entryPrice * 1.04 : entryPrice * 0.96,
                                sl: smartSl,
                                size: Math.abs(parseFloat(p.positionValue || sizeSz * entryPrice)),
                                reason: "Adopted from Active Chain State"
                            };
                            newHistory.push(adoptedTrade);
                            hasChanges = true;
                        }
                    });

                    if (hasChanges) {
                        localStorage.setItem('canton_signal_history', JSON.stringify(newHistory));
                        return newHistory;
                    }
                    return prevHistory;
                });
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [activePositions]);

    // Poll Wallet Equity
    // REAL-TIME EQUITY & POSITIONS (WebSocket)
    const { userData, subscribeToUser } = useRealTime();
    const [walletData, setWalletData] = useState<any>(null);

    // 1. Subscribe to WS on Mount (using stored address or ENV)
    // Note: We need the wallet address. Ideally, it's in the API response or Config.
    // For now, we'll wait for the first Poll to get the address, then Upgrade to WS.
    const hasSubribedRef = useRef(false);

    // 2. Poll Wallet Equity (Fallback + Init)
    useEffect(() => {
        const fetchEquity = async () => {
            try {
                const res = await fetch('/api/wallet');
                const data = await res.json();
                if (data.success) {
                    // Update State (Fallback)
                    if (!userData) {
                        setEquity(data.equity);
                        setWalletData(data);
                        setActivePositions(data.positions);
                    }

                    // UPGRADE TO WEBSOCKET (Once we have the address)
                    // The API returns 'positions' but not explicitly the address in common response unless we add it.
                    // However, we can infer checks. 
                    // Actually, let's verify if /api/wallet returns the address.
                    // If not, we might need to fetch it or hardcode it from ENV if accessible (not in client).
                    // Assumption: The API 'data' object might contain metadata or we just rely on polling if address missing.

                    // Actually, let's look at `data.positions`. It doesn't have the address.
                    // But we can trigger the subscription if we know it. 
                    // Let's assume the backend provides it or we add it to the API.
                    if (data.address && !hasSubribedRef.current) {
                        console.log(`[WS] Upgrading to Real-Time: ${data.address}`);
                        subscribeToUser(data.address);
                        hasSubribedRef.current = true;
                    }
                }
            } catch (e) { /* Ignore poll errors */ }
        };
        fetchEquity();
        const timer = setInterval(fetchEquity, 10000); // Keep polling as backup
        return () => clearInterval(timer);
    }, [userData, subscribeToUser]);

    // 3. LISTEN TO WEBSOCKET EVENTS (Instant Sync)
    useEffect(() => {
        if (userData && userData.clearinghouseState) {
            const state = userData.clearinghouseState;

            // 1. Update Equity
            if (state.marginSummary) {
                setEquity(parseFloat(state.marginSummary.accountValue));
            }

            // 2. Update Positions (Map WS format to App format)
            if (state.assetPositions) {
                // WS Format: { position: { coin: "BTC", szi: "1.5", ... }, type: "oneWay" }
                // App Format: { coin: "BTC", szi: "1.5", entryPx: "...", ... } (Flattened)

                const mappedPositions = state.assetPositions.map((ap: any) => {
                    const pos = ap.position;
                    // Filter closed positions (szi = 0)
                    if (parseFloat(pos.szi) === 0) return null;

                    return {
                        coin: pos.coin,
                        szi: pos.szi,
                        entryPx: pos.entryPx,
                        positionValue: pos.positionValue,
                        liquidationPx: pos.liquidationPx || "0",
                        leverage: pos.leverage?.value || "0", // Check structure
                        unrealizedPnl: pos.unrealizedPnl,
                        returnOnEquity: pos.returnOnEquity
                    };
                }).filter((p: any) => p !== null);

                setActivePositions(mappedPositions);
                setWalletData((prev: any) => ({ ...prev, positions: mappedPositions }));
                // console.log("[WS] Positions Updated:", mappedPositions.length);
            }
        }
    }, [userData]);

    // ... (rest of render) ...



    // V5: SERVER-SIDE POLLING (The Master Bot)
    const [v5Signals, setV5Signals] = useState<any[]>([]);

    // BACKWARDS COMPATIBILITY: Keep Client Data for Pricing/Context Display
    const { data, isLoading } = useRealTimeData('15m');
    const isWarmingUp = isLoading;

    useEffect(() => {
        const fetchV5 = async () => {
            try {
                const res = await fetch('/api/v5/scan');
                const data = await res.json();
                if (data.success) {
                    setV5Signals(data.signals);

                    if (data.signals.length > 0) {
                        data.signals.forEach((sig: any) => {
                            if (sig.action !== 'NEUTRAL' && sig.leverage > 0) {
                                // Convert V5 Signal to Trade Format
                                const tradeSig: TradeSignal = {
                                    action: sig.action,
                                    leverage: sig.leverage + "x",
                                    confidence: sig.confidence,
                                    reasons: sig.reasons,
                                    target: sig.action === 'BUY' ? sig.price * 1.04 : sig.price * 0.96,
                                    stopLoss: sig.action === 'BUY' ? sig.price * 0.985 : sig.price * 1.015
                                };

                                // 1. AUTO-TRADE EXECUTOR
                                if (isAutoTrade) {
                                    addToHistoryRef.current(sig.symbol, tradeSig, sig.price, '15m');
                                }

                                // 2. V5 ADOPTION LOGIC (Fix Manual Label)
                                // If on-chain position exists matching this V5 signal, claim it!
                                const isActiveOnChain = activePositions.find(p => p.coin === sig.symbol);
                                if (isActiveOnChain) {
                                    // Check if we already track it as an OPEN trade
                                    /* We use a heuristic: if we have NO open trade for this symbol in history, but we have a signal + on-chain position, ADOPT IT. */
                                    // Note: history state is not directly accessible here easily without ref or dep loop. 
                                    // We rely on addToHistory's internal dedupe somewhat, OR we force it.
                                    // Actually addToHistory checks 'activeSymbols' hook state via Ref or internal Set? 
                                    // No, addToHistory checks 'processedSignals' or 'activeSymbols'.

                                    // Simplified: Just try to add it. addToHistory has locks. 
                                    // But we need to bypass locks for ADOPTION?
                                    // Let's rely on standard addToHistory for now.
                                    addToHistoryRef.current(sig.symbol, tradeSig, parseFloat(isActiveOnChain.entryPx), '15m');
                                }
                            }
                        });
                    }
                }
            } catch (e) { console.error("V5 Poll Error", e); }
        };

        fetchV5(); // Initial
        const timer = setInterval(fetchV5, 15000); // 15s Poll (Server handles rate limits)
        return () => clearInterval(timer);
    }, [isAutoTrade, activePositions]); // Re-start if Auto-Trade toggled OR positions change (to adopt)

    // 3. HELPERS
    const handleManualUpdate = (symbol: string, manualData: ManualAnalysisData) => {
        setManualOverrides(prev => {
            const newOverrides = { ...prev, [symbol]: manualData };
            localStorage.setItem('canton_manual_overrides', JSON.stringify(newOverrides));
            return newOverrides;
        });
        setShowManualInput(false);
    };

    // EXECUTION HANDLER
    const executeTradeImpl = async (symbol: string, action: 'BUY' | 'SELL', price: number, sizeUsd: number, leverage: number, reduceOnly: boolean = false, options?: { sl?: number, tp?: number, signalSnapshot?: any }) => {
        try {
            clientLogger.info(`[EXEC] Triggering ${action} ${symbol}...`, { price, size: sizeUsd });
            // Using console for now as clientLogger import might fail due to strictness
            // console.log(`[EXEC] Triggering ${action} ${symbol}...`);

            const res = await fetch('/api/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol,
                    action,
                    price,
                    size: sizeUsd,
                    leverage,
                    reduce_only: reduceOnly,
                    sl: options?.sl,
                    tp: options?.tp,
                    signalSnapshot: options?.signalSnapshot
                }) // Fixed closing brace
            });
            const result = await res.json();
            if (result.success) {
                clientLogger.trade(`[EXEC_SUCCESS] ${action} ${symbol}`, { tx: result.txHash });
                // console.log(`[EXEC_SUCCESS] ${action} ${symbol} TX: ${result.txHash}`);
            } else {
                clientLogger.error(`[EXEC_FAIL] ${symbol}`, { error: result.error });
                console.error(`[EXEC_FAIL] ${symbol} Error: ${result.error}`);
                // alert(`Execution Failed: ${result.error}`); // DISABLE ALERT SPAM
            }
            return result;
        } catch (e: any) {
            // clientLogger.error("[EXEC] Network Error", { error: e.message });
            console.error("[EXEC] Network Error", e);
            return { success: false, error: e.message };
        }
    };

    // PORTFOLIO SETTINGS
    const INITIAL_PORTFOLIO = 250; // User Production Capital
    const ALLOCATION_PCT = 0.15;   // 15% per trade (User Request)
    const MAX_TRADES = 7;          // Max 7 simultaneous trades
    const TAKER_FEE = 0.0005; // 0.05%
    const SPREAD = 0.0005;    // 0.05%

    // Circuit Breaker Logic
    const recentClosed = closedHistory.filter(t => Date.now() - t.exitTime < 24 * 3600 * 1000);
    const sortedClosed = [...recentClosed].sort((a, b) => b.exitTime - a.exitTime);
    let consecutiveLosses = 0;
    for (const t of sortedClosed) {
        if (t.status === 'LOSS') consecutiveLosses++;
        else break; // Streak broken
    }
    const isCircuitBroken = consecutiveLosses >= 3;

    const addToHistory = async (symbol: string, signal: TradeSignal, price: number, activeTf: string) => {
        // 0. SAFETY GUARD: INVALID PRICE
        if (!price || price <= 0 || isNaN(price)) {
            // console.warn(`[SAFETY] Prevented finding ${symbol} with invalid price: ${price}`);
            return;
        }

        // 0. SAFETY CHECKS (Before Locking)
        if (isCircuitBroken) return;

        // V2.1 TREND GUARD (Async Filter)
        if (isAutoTrade) {
            const trendData = await fetchCandlesAndCheckTrend(symbol);

            if (trendData.trend !== 'NEUTRAL') {
                // RULE: NEVER Short if Bullish, NEVER Long if Bearish
                if (signal.action === 'SELL' && trendData.trend === 'BULLISH') {
                    console.log(`[FILTER] Blocked SELL ${symbol}: Price (${trendData.price}) > SMA50 (${trendData.sma50.toFixed(2)})`);
                    return;
                }
                if (signal.action === 'BUY' && trendData.trend === 'BEARISH') {
                    console.log(`[FILTER] Blocked BUY ${symbol}: Price (${trendData.price}) < SMA50 (${trendData.sma50.toFixed(2)})`);
                    return;
                }
            }

            // RE-CHECK LOCKS (Async Gap Protection)
            const currentSignalKey = `${symbol}-${signal.action}-${new Date().getHours()}`;
            if (processedSignals.has(currentSignalKey)) return;
            if (activeSymbols.has(symbol)) return;
        }
        // ORIGINAL LOGIC MOVED HERE

        // Block trades during warmup (Synchronously)
        if (isWarmingUp && !manualOverrides[symbol]) {
            return;
        }

        // ... (Re-Entry Logic) ...
        const recentTrade = closedHistory.find(c =>
            c.symbol === symbol &&
            c.action === signal.action &&
            Date.now() - c.exitTime < 4 * 60 * 60 * 1000 // Look back 4 hours
        );

        // V2 STRATEGY UPDATE: COOLDOWN LOGIC
        // Default: 4 Hours for LOSS, 1 Hour for WIN.
        // EXCEPTION: If signal is a "LIQUIDITY SWEEP" (Sniping), bypass cooldown.
        // FIX: Removed "Magnet" from bypass to prevent churn loops.
        const isSweep = signal.reasons.some(r => r.includes("SWEEP"));

        if (recentTrade && !isSweep) {
            const timeSinceExit = Date.now() - recentTrade.exitTime;
            const hoursSince = timeSinceExit / (1000 * 60 * 60);
            const cooldownHours = recentTrade.status === 'LOSS' ? 4 : 1;

            if (hoursSince < cooldownHours) {
                // console.log(`[COOLDOWN] skipping ${symbol} (Last trade was ${hoursSince.toFixed(1)}h ago)`);
                return;
            }
        }

        // Create Unique Key
        const signalKey = `${symbol}-${signal.action}-${new Date().getHours()}`;

        // 1. DEDUPLICATION (Synchronous Global Lock)
        if (processedSignals.has(signalKey)) return;
        if (activeSymbols.has(symbol)) return;

        // 2. MAX TRADES CHECK (Robust On-Chain Check)
        const currentCount = (isAutoTrade && walletData?.positions)
            ? walletData.positions.filter((p: any) => parseFloat(p.position?.szi || p.szi) !== 0).length
            : activeSymbols.size;

        if (currentCount >= 7) {
            // console.log(`[SKIP] Max Trades Reached (${currentCount}/7). Skipping ${symbol}.`);
            return;
        }

        // 2.1 DUPLICATE ASSET CHECK (Strict On-Chain)
        // Prevent adding to an existing position (which increases size/risk)
        if (isAutoTrade && walletData?.positions) {
            const coin = symbol.replace('USDT', '');
            const existingPos = walletData.positions.find((p: any) =>
                p.position.coin === coin && parseFloat(p.position.szi) !== 0
            );
            if (existingPos) {
                // console.log(`[SKIP] Position already exists for ${coin}.`);
                return;
            }
        }

        // 2.5 GLOBAL THROTTLE (Prevent Machine Gun Execution)
        // A. Startup Grace Period (60s) to preventing firing on reload
        const uptime = (typeof window !== 'undefined') ? (Date.now() - (window as any)._startupTime) : 999999;
        // set _startupTime in useEffect on mount if needed, or use a Ref initialized to Date.now()
        // Better: Use a dedicated Ref

        if (Date.now() - startupTimeRef.current < 60000) {
            console.log(`[STARTUP] Waiting for Grace Period (${((60000 - (Date.now() - startupTimeRef.current)) / 1000).toFixed(0)}s)...`);
            return;
        }

        // B. Standard Throttle (30s)
        if (Date.now() - lastTradeTime.current < 30000) {
            // console.log(`[THROTTLE] Postponing ${symbol}...`);
            return;
        }

        // GLOBAL THROTTLE CHECK (V3 Fix - LocalStorage)
        // If the last GLOBAL trade (across ALL tabs) was less than 15 mins ago, blockage.
        const lastGlobal = typeof window !== 'undefined' ? parseInt(localStorage.getItem('last_global_trade_v3') || '0') : 0;
        const timeSinceGlobal = Date.now() - lastGlobal;
        const isTenX = signal.leverage === '10x';

        // Startup Check (First 5 mins of this session)
        const timeSinceStart = Date.now() - startupTimeRef.current;
        if (timeSinceStart < 5 * 60 * 1000) {
            console.log(`[STARTUP] Blocked ${symbol}. Warming up... ${(timeSinceStart / 1000).toFixed(0)}s < 300s`);
            return;
        }

        if (timeSinceGlobal < GLOBAL_THROTTLE_MS && !isTenX) {
            console.log(`[THROTTLE] Blocked ${symbol}. Global Timer: ${(timeSinceGlobal / 1000 / 60).toFixed(1)}m < 15m`);
            return;
        }

        // 3. CLAIM LOCK (Commitment)
        activeSymbols.add(symbol);
        processedSignals.add(signalKey);

        // UPDATE THROTTLE
        lastTradeTime.current = Date.now();

        // OPTIMISTIC LOCK: Claim Global Rights IMMEDIATELY to stop Race Conditions
        if (!isTenX) {
            localStorage.setItem('last_global_trade_v3', Date.now().toString());
        }

        // RACE CONDITION DEFENSE
        let currentHistory: any[] = [];
        try {
            currentHistory = JSON.parse(localStorage.getItem('canton_signal_history') || '[]');
            const existsInStorage = currentHistory.find((h: any) => h.symbol === symbol && !activeSymbols.has(symbol + "_force_override"));
            if (existsInStorage) {
                // console.warn(`Duplicate Prevented by Storage Check: ${symbol}`);
                // return; // TEMPORARILY DISABLED FOR DEBUGGING LIVE SIGNALS
            }
        } catch (e) { }

        // GENERATE NEW TRADE OBJECT
        let stratTag = 'TREND'; // Default
        if (signal.reasons.some(r => r.includes("MAGNET"))) stratTag = 'MAGNET';
        if (signal.reasons.some(r => r.includes("SWEEP"))) stratTag = 'SWEEP'; // V2 Update
        if (signal.reasons.some(r => r.includes("FADE"))) stratTag = 'FADE';
        if (signal.reasons.some(r => r.includes("10x"))) stratTag = 'SNIPER';
        if (manualOverrides[symbol]) stratTag = 'MANUAL';

        const newTrade = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            timestamp: Date.now(),
            symbol,
            timeframe: activeTf,
            action: signal.action,
            leverage: signal.leverage,
            strategy: stratTag,
            price: signal.action === 'BUY' ? price * (1 + SPREAD) : price * (1 - SPREAD), // Slippage/Spread

            tp: signal.target,
            // DYNAMIC STOP LOSS:
            sl: signal.stopLoss || (
                (stratTag === 'MAGNET' || stratTag === 'FADE')
                    ? (signal.action === 'BUY' ? price * 0.975 : price * 1.025) // 2.5% Wide SL
                    : (signal.action === 'BUY' ? price * 0.975 : price * 1.025)   // 2.5% Standard SL
            ),
            reason: signal.reasons[0],
            size: INITIAL_PORTFOLIO * ALLOCATION_PCT // $250 Allocation
        };

        // 4. PERSISTENCE (CRITICAL FIX: Always save to History to preserve Strategy Tag)
        // If we don't save here, the Poller will see it as an "Orphan" and label it "MANUAL".
        const updatedHistory = [newTrade, ...currentHistory].slice(0, 100);
        localStorage.setItem('canton_signal_history', JSON.stringify(updatedHistory));
        setHistory(updatedHistory);

        if (isAutoTrade) {
            // LIVE MODE
            // 1. Log Intent
            console.log(`[LIVE] Signal TRIGGERED: ${symbol} ${signal.action}. Executing...`);

            // AI LOGGING (Phase 9)
            if (signal.features) {
                fetch('/api/ai-log', {
                    method: 'POST',
                    body: JSON.stringify({
                        type: 'log',
                        trade: newTrade,
                        features: signal.features
                    })
                }).catch(e => console.error("[AI] Log Failed", e));
            }

            // 2. EXECUTE ON CHAIN
            executeTradeImpl(
                symbol,
                signal.action as 'BUY' | 'SELL',
                price,
                newTrade.size,
                parseInt(signal.leverage),
                false,
                {
                    sl: newTrade.sl,
                    tp: newTrade.tp,
                    signalSnapshot: {
                        score: signal.score || 0,
                        confidence: signal.confidence || 0,
                        reasons: signal.reasons || [],
                        // marketState: { ...data[symbol] } // Optional: Pass full market data if needed
                    }
                }
            );

            // UPDATE GLOBAL TIMER (Cross-Tab via LocalStorage)
            localStorage.setItem('last_global_trade_v3', Date.now().toString());
        }
    };

    // ... (Ghost History) ...

    const closeTrade = (trade: any, reason: string, customPrice?: number) => {
        const key = trade.symbol.replace("USDT", "");
        const metric = data[key] || data[trade.symbol] || Object.values(data).find((d: any) => d.pair.replace("/", "") === trade.symbol);

        const override = manualOverrides[trade.symbol] || manualOverrides[key];
        let currentPrice = customPrice || (override?.manualPrice) || (metric ? metric.price : trade.price);

        // SAFETY: If current price is invalid/zero, fall back to ENTRY price (0 PnL)
        // This prevents the "Infinite Profit" bug if API temporarily returns 0
        if (!currentPrice || currentPrice <= 0 || isNaN(currentPrice)) {
            console.warn(`[SAFETY] CloseTrade: Invalid Price ${currentPrice} for ${trade.symbol}. Defaulting to Entry.`);
            currentPrice = trade.price;
        }

        const lev = parseInt(trade.leverage) || 1;
        const entry = trade.price > 0 ? trade.price : currentPrice; // Guard Entry=0

        let pnlValue = 0;
        let finalPnlPercent = 0;
        let totalFee = 0;

        // ONLY CALCULATE PNL IF WE HAVE VALID PRICES
        if (currentPrice > 0 && entry > 0) {
            const rawChange = (currentPrice - entry) / entry;
            const grossPnlPercent = (trade.action === 'BUY' ? rawChange : -rawChange) * lev;

            const currentSize = trade.size || 100;
            totalFee = currentSize * (TAKER_FEE * 2);

            pnlValue = (grossPnlPercent * currentSize) - totalFee;
            finalPnlPercent = pnlValue / currentSize;
        }

        const closedTrade = {
            ...trade,
            exitPrice: currentPrice,
            exitTime: Date.now(),
            pnlValue,
            pnlPercent: finalPnlPercent * 100,
            status: pnlValue >= 0 ? "WIN" : "LOSS",
            exitReason: reason,
            fees: totalFee
        };

        // AI LABELLING (Phase 9)
        fetch('/api/ai-log', {
            method: 'POST',
            body: JSON.stringify({
                type: 'label',
                id: trade.id,
                result: { pnlPercent: finalPnlPercent * 100 }
            })
        }).catch(e => console.error("[AI] Label Failed", e));

        // AUTOPSY (Phase 25): Trigger Post-Mortem Analysis
        if (trade.status === 'OPEN') { // Only autopsy newly closed trades
            // Delay slightly to ensure DB has finalized status if async
            setTimeout(() => {
                fetch('/api/analysis/autopsy', {
                    method: 'POST',
                    body: JSON.stringify({ tradeId: trade.id })
                }).catch(e => console.error("[AUTOPSY] Failed to trigger", e));
            }, 2000);
        }

        setHistory(prev => prev.filter(h => h.id !== trade.id));

        // PERSIST CLOSED HISTORY (Fix Re-Entry Guard)
        const newClosedHistory = [closedTrade, ...closedHistory].slice(0, 500);
        setClosedHistory(newClosedHistory);
        localStorage.setItem('canton_closed_history', JSON.stringify(newClosedHistory));

        // RELEASE LOCK
        activeSymbols.delete(trade.symbol);
    };

    // 4. AUTO-CLOSE & SAFETY LOGIC
    useEffect(() => {
        if (isLoading) return;

        history.forEach(trade => {
            const key = trade.symbol.replace("USDT", "");
            let metric = data[key] || data[trade.symbol] || Object.values(data).find((d: any) => d.pair.replace("/", "") === trade.symbol);

            // Check overrides
            const override = manualOverrides[trade.symbol] || manualOverrides[`${key}/USDT`];
            let currentPrice = metric?.price;

            if (override?.manualPrice) currentPrice = override.manualPrice;
            if (!currentPrice || currentPrice <= 0) return; // Safety

            const lev = parseInt(trade.leverage) || 1;
            const entry = trade.price;
            let exitReason = null;

            // Calc PnL
            const rawChange = (currentPrice - entry) / entry;
            const pnlPercent = (trade.action === 'BUY' ? rawChange : -rawChange) * lev;

            // TP/SL Logic
            const dist = Math.abs(trade.tp - entry);
            const tp1 = trade.action === 'BUY' ? entry + (dist * 0.5) : entry - (dist * 0.5);

            // EMERGENCY: Liquidation Check (From Live Chain Data)
            // matching active position logic...
            const livePos = activePositions.find(p => (p.coin + "USDT") === trade.symbol);
            if (livePos && livePos.liquidationPx) {
                const liqPx = parseFloat(livePos.liquidationPx);
                const safetyBufferPct = 0.05; // 5% buffer

                if (trade.action === 'BUY') {
                    if (currentPrice < liqPx * (1 + safetyBufferPct)) {
                        exitReason = "⚠️ LIQUIDATION RISK (Emergency Close)";
                    }
                } else {
                    if (currentPrice > liqPx * (1 - safetyBufferPct)) {
                        exitReason = "⚠️ LIQUIDATION RISK (Emergency Close)";
                    }
                }
            }

            // --- SMART EXIT: TREND FLIP (The "Correlation" Fix) ---
            // Issue: V2.1 enters well but holds losers if trend flips.
            // Fix: Check if the "Brain" (Analysis) now hates this trade.
            // We re-run the signal generator on CURRENT data.
            // Note: metric is already defined above as 'metric' variable.
            if (!exitReason && metric) {
                const currentSignal = generateTradeSignal([metric], override, '15m');

                // If I am LONG, and Brain says "SELL" (Strongly) -> GET OUT
                if (trade.action === 'BUY' && currentSignal.action === 'SELL') {
                    // Check Score Strength to avoid noise (whipsaw)
                    // If confidence > 60 or specific reason
                    if (currentSignal.confidence > 50) {
                        exitReason = `📉 TREND FLIP (Smart Exit) - Signal: ${currentSignal.action}`;
                    }
                }
                // If I am SHORT, and Brain says "BUY" -> GET OUT
                if (trade.action === 'SELL' && currentSignal.action === 'BUY') {
                    if (currentSignal.confidence > 50) {
                        exitReason = `📈 TREND FLIP (Smart Exit) - Signal: ${currentSignal.action}`;
                    }
                }
            }

            if (trade.action === 'BUY') {
                if (!trade.tp1Hit && currentPrice >= tp1) exitReason = "PARTIAL_TP";
                else if (currentPrice >= trade.tp) exitReason = "TARGET_HIT";
                else if (currentPrice <= trade.sl) exitReason = "STOP_LOSS";
            } else {
                if (!trade.tp1Hit && currentPrice <= tp1) exitReason = "PARTIAL_TP";
                else if (currentPrice <= trade.tp) exitReason = "TARGET_HIT";
                else if (currentPrice >= trade.sl) exitReason = "STOP_LOSS";
            }

            // Breakeven (+0.6% Profit)
            // Was 1.0%, lowered to catch smaller moves and prevent winners turning to losers in chop.
            if (pnlPercent > 0.006 && !trade.isBreakeven) {
                // Move SL to Entry + 0.1% (Cover fees)
                const newSl = trade.action === 'BUY' ? entry * 1.001 : entry * 0.999;
                setTimeout(() => setHistory(prev => prev.map(t => t.id === trade.id ? { ...t, sl: newSl, isBreakeven: true } : t)), 0);
            }

            // Ratchet / Trailing Stop (+1.5% Profit)
            // Was 3.0%, lowered to 1.5% to trail tighter.
            if (pnlPercent > 0.015) {
                // Trail distance: 0.5% price distance (adjusted for lev)
                // If 10x lev, we want to trail by ~0.5% price move.
                const trailDist = (currentPrice * 0.005);

                let newTrailSl = 0;
                let update = false;
                if (trade.action === 'BUY') {
                    newTrailSl = currentPrice - trailDist;
                    if (newTrailSl > trade.sl) update = true;
                } else {
                    newTrailSl = currentPrice + trailDist;
                    if (newTrailSl < trade.sl) update = true;
                }
                if (update) setTimeout(() => setHistory(prev => prev.map(t => t.id === trade.id ? { ...t, sl: newTrailSl } : t)), 0);
            }

            // Execution
            if (exitReason) {
                // HARD STOP SIMULATION:
                // If it's a Stop Loss or Target Hit, assume we got filled AT that price equal to SL/TP.
                // For PARTIAL_TP (Market Order), use currentPrice (or TP1 price if we want to be precise, but current is fine for triggers)
                let executionPrice = currentPrice;
                if (exitReason === 'STOP_LOSS') executionPrice = trade.sl;
                if (exitReason === 'TARGET_HIT') executionPrice = trade.tp;
                if (exitReason === 'PARTIAL_TP') executionPrice = tp1; // Precise fill at TP1 level

                // Re-calculate PnL based on execution price
                const finalRawChange = (executionPrice - entry) / entry;
                const finalPnlPercent = (trade.action === 'BUY' ? finalRawChange : -finalRawChange) * lev;

                const currentSize = trade.size || 250;
                // Partial: Close 50%. Full: Close 100% of REMAINING size.
                const closeSize = exitReason === "PARTIAL_TP" ? currentSize * 0.5 : currentSize;

                const totalFee = closeSize * (TAKER_FEE * 2);
                const pnlValue = (finalPnlPercent * closeSize) - totalFee;

                const closedTrade = {
                    ...trade,
                    exitPrice: executionPrice,
                    exitTime: Date.now(),
                    pnlValue,
                    pnlPercent: finalPnlPercent * 100,
                    status: pnlValue >= 0 ? "WIN" : "LOSS",
                    exitReason: exitReason === "PARTIAL_TP" ? "TP1 (Scaler)" : exitReason,
                    size: closeSize,
                    fees: totalFee
                };

                // LOG THE CLOSED PORTION
                setClosedHistory(prev => [closedTrade, ...prev].slice(0, 500));

                if (isAutoTrade) {
                    // LIVE EXECUTION: Close the trade on-chain
                    const closeAction = trade.action === 'BUY' ? 'SELL' : 'BUY';
                    const closeLog = `[AUTO-CLOSE] Triggering ${closeAction} ${trade.symbol} (${exitReason})`;
                    console.log(closeLog);

                    // Fire and Forget (Async)
                    // Use slightly aggressive limit price to ensure fill (Market-like)
                    // executeTradeImpl handles the API call
                    executeTradeImpl(trade.symbol, closeAction, currentPrice, currentSize, parseInt(trade.leverage)).then(res => {
                        if (res && res.success) {
                            console.log(`[AUTO-CLOSE] Success: ${trade.symbol}`);
                        } else {
                            console.error(`[AUTO-CLOSE] Failed: ${trade.symbol}`, res);
                        }
                    });
                }

                if (exitReason === "PARTIAL_TP") {
                    // KEEP RUNNER: Update the active trade instead of removing it
                    setHistory(prev => prev.map(t => {
                        if (t.id === trade.id) {
                            return {
                                ...t,
                                size: currentSize - closeSize, // Remaining Size (50%)
                                tp1Hit: true, // Don't trigger TP1 again
                                isBreakeven: true, // Auto-move SL to Breakeven on TP1 if not already
                                sl: trade.action === 'BUY' ? Math.max(trade.sl, entry * 1.002) : Math.min(trade.sl, entry * 0.998) // Secure the runner
                            };
                        }
                        return t;
                    }));
                } else {
                    // FULL CLOSE: Remove from Active
                    setHistory(prev => prev.filter(h => h.id !== trade.id));
                    // RELEASE LOCK
                    activeSymbols.delete(trade.symbol);
                }
            }
        });
    }, [data, history]);

    // 5. BACKGROUND MULTI-SCANNER (Fixed Stale Closure)
    // We use a Ref to access the latest addToHistory (which has access to current isWarmingUp state)
    // without resetting the interval on every render.
    const addToHistoryRef = useRef(addToHistory);
    useEffect(() => {
        addToHistoryRef.current = addToHistory;
    });

    useEffect(() => {
        const scanAll = async () => {
            // console.log("🕵️ BACKGROUND SCAN STARTING...");
            const intervals = ['15m', '1h', '4h', '1d'];

            // Sequential Scan to avoid API Rate Limits
            for (const tf of intervals) {
                for (const symbol of SUPPORTED_ASSETS) {
                    try {
                        // Fetch & Scan without updating UI state (silent scan)
                        // We use the same fetchBinanceData function
                        const metric = await fetchBinanceData(symbol, tf);
                        if (!metric || !metric.price) continue;

                        // Generate Signal
                        // Note: We don't have override data here easily, so we skip manual overrides for background scan
                        // This is purely for algorithmic detection.
                        const signal = generateTradeSignal([metric as any], undefined, tf);

                        if (signal.action !== 'NEUTRAL') {
                            // console.log(`[BG-SCAN] Found ${symbol} ${tf} ${signal.action}`);
                            // Add to history (safety checks in addToHistory will handle duplication)
                            // Use the REF to get the fresh function instance
                            addToHistoryRef.current(symbol, signal, metric.price, tf);
                        }
                    } catch (e) {
                        // console.warn(`[BG-SCAN] Error scanning ${symbol} ${tf}`, e);
                    }
                    // Tiny delay to be nice to API
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        };

        // Run immediately after 3s Warmup (4s mark)
        setTimeout(() => scanAll(), 4000);

        // Then every 30s
        const timer = setInterval(scanAll, 30000);
        return () => clearInterval(timer);
    }, []);

    const intervals = [
        { id: '15m', label: '15 Min (Scalp)' },
        { id: '1h', label: '1 Hour (Day)' },
        { id: '4h', label: '4 Hour (Swing)' },
        { id: '1d', label: '1 Day (Trend)' },
    ];

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/10">
                <div className="flex items-center gap-6">


                    <DailyPerformance history={history} closedHistory={closedHistory} currentEquity={equity} />

                    {/* AUTOMATED TRADING TOGGLE */}
                    <button
                        onClick={() => {
                            if (!isAutoTrade) {
                                setShowConfirmLive(true);
                            } else {
                                setIsAutoTrade(false);
                            }
                        }}
                        className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all ${isAutoTrade
                            ? "bg-red-500/20 border-red-500 hover:bg-red-500/30 text-red-500 animate-pulse"
                            : "bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-400"
                            }`}
                    >
                        <Zap className={`h-3 w-3 ${isAutoTrade ? "fill-red-500" : ""}`} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                            {isAutoTrade ? "LIVE TRADING: ON" : "SIMULATION ONLY"}
                        </span>
                    </button>

                    {/* CIRCUIT BREAKER ALERT */}
                    {isCircuitBroken && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-rose-500/20 border border-rose-500 rounded-full animate-pulse">
                            <Zap className="h-3 w-3 text-rose-500" />
                            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">CIRCUIT BREAKER: TRADING HALTED</span>
                            <button
                                onClick={() => {
                                    if (confirm("⚠️ DANGER: Resetting Circuit Breaker will resume trading immediately. Confirmation required.")) {
                                        // To reset, we need to clear the recent loss history or just 'acknowledge' it.
                                        // Hard Reset: Clear Closed History (Simulated Reset) or we add a 'acknowledged' flag.
                                        // User asked to 'start fresh', so clearing history is valid.
                                        setClosedHistory([]);
                                    }
                                }}
                                className="ml-2 bg-rose-900/50 hover:bg-rose-800 text-[9px] px-2 py-0.5 rounded border border-rose-700 text-white"
                            >
                                RESET
                            </button>
                        </div>
                    )}

                    {/* GHOST TRADER STATS */}
                    {ghostHistory.length > 0 && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/50 rounded-full">
                            <span className="text-[10px] uppercase text-purple-400 font-bold tracking-wider">👻 Ghost PnL:</span>
                            <span className={`text-xs font-mono font-bold ${ghostHistory.reduce((acc, h) => {
                                const currentPrice = data[h.symbol.replace("USDT", "")]?.price || h.price;
                                const entry = h.price > 0 ? h.price : 0;
                                let pnl = 0;
                                if (entry > 0 && currentPrice > 0) {
                                    pnl = (h.action === 'BUY' ? (currentPrice - entry) / entry : (entry - currentPrice) / entry) * 100 * 10;
                                }
                                return acc + pnl;
                            }, 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}>
                                ${ghostHistory.reduce((acc, h) => {
                                    const currentPrice = data[h.symbol.replace("USDT", "")]?.price || h.price;
                                    const pnlPct = (h.action === 'BUY' ? (currentPrice - h.price) / h.price : (h.price - currentPrice) / h.price) * 10;
                                    return acc + (100 * pnlPct); // $100 bet
                                }, 0).toFixed(2)}
                            </span>
                            <span className="text-[9px] text-purple-500/50">({ghostHistory.length} Off-Hours Trades)</span>
                        </div>
                    )}

                    {isWarmingUp && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/50 rounded-full animate-pulse">
                            <Activity className="h-3 w-3 text-amber-500" />
                            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">System Warning Up...</span>
                        </div>
                    )}
                    {isCircuitBroken && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-red-600/10 border border-red-500/50 rounded-full animate-pulse">
                            <AlertTriangle className="h-3 w-3 text-red-500" />
                            <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">
                                CIRCUIT BREAKER: TRADING HALTED ({consecutiveLosses} LOSSES)
                            </span>
                        </div>
                    )}
                    <div className="hidden md:block h-8 w-px bg-white/10"></div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase text-zinc-400 font-bold tracking-wider">Portfolio (Live)</span>
                        <div className="flex items-center gap-2 text-sm font-mono">
                            <span className={history.length >= MAX_TRADES ? "text-red-400" : "text-emerald-400"}>
                                Cap: ${equity ? equity.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '---'}
                            </span>
                            <span className="text-zinc-600">/</span>
                            <span className="text-white">${equity ? equity.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '---'}</span>
                        </div>
                    </div>
                </div>
                {/* HOT ASSETS SCANNER */}
                <div className="hidden lg:flex items-center gap-4 border-l border-white/10 pl-6">
                    <div className="flex items-center gap-1 text-[10px] uppercase text-orange-400 font-bold tracking-wider">
                        <Zap className="h-3 w-3" /> Market Heat
                    </div>
                    <div className="flex gap-3">
                        {hotAssets.slice(0, 3).map(a => (
                            <div key={a.symbol} className="flex items-center gap-1 text-xs bg-white/5 px-2 py-1 rounded border border-white/5">
                                <span className="font-bold">{a.symbol.replace("USDT", "")}</span>
                                <span className={a.change >= 0 ? 'text-green-400' : 'text-red-400'}>{a.change.toFixed(1)}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex gap-2">
                <button
                    onClick={() => setShowCalculator(true)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all"
                >
                    <Settings className="h-3 w-3" /> Sim PnL
                </button>
                <button
                    onClick={() => setShowManualInput(!showManualInput)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${showManualInput ? 'bg-primary text-primary-foreground' : 'bg-white/10 hover:bg-white/20'}`}
                >
                    <Settings className="h-3 w-3" />
                    Manual Alpha
                </button>
                {/* Timeframe Toggles */}
                <div className="flex items-center bg-white/5 rounded-lg p-1 border border-white/10">
                    <button onClick={() => setTimeframe('AUTO')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${timeframe === 'AUTO' ? 'bg-indigo-500/20 text-indigo-400' : 'text-muted-foreground'}`}>AUTO</button>
                    {intervals.map(i => (
                        <button key={i.id} onClick={() => setTimeframe(i.id)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${timeframe === i.id ? 'bg-indigo-500/20 text-indigo-400' : 'text-muted-foreground'}`}>{i.label.split(' ')[0]}</button>
                    ))}
                </div>
            </div>


            {showCalculator && <PnLCalculator onClose={() => setShowCalculator(false)} />}

            {
                showManualInput && (
                    <div className="animate-in slide-in-from-top-4 fade-in duration-300">
                        <DataInputForm onUpdate={handleManualUpdate} />
                    </div>
                )
            }

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {isLoading && Object.keys(data).length === 0 ? (
                    <div className="col-span-full text-center py-20 text-muted-foreground animate-pulse">Connecting to Global Feeds...</div>
                ) : (
                    Array.from(new Set([...SUPPORTED_ASSETS, ...Object.keys(manualOverrides).map(k => k.replace("/", ""))])).map(symbol => {
                        const key = symbol.replace("USDT", "");
                        const pair = `${key}/USDT`;
                        let metric = data[key] || data[symbol] || Object.values(data).find((d: any) => d.pair.replace("/", "") === symbol);
                        const override = manualOverrides[pair] || manualOverrides[symbol];

                        const isCC = symbol === 'CCUSDT';

                        // Fallback to manual metric if metric is missing OR has 0 price
                        if ((!metric || metric.price === 0) && override) {
                            metric = {
                                exchange: 'MANUAL', pair,
                                price: override.manualPrice || 0,
                                priceChange24h: override.manualChange || 0,
                                volume24h: 0, openInterest: 0, fundingRate: override.manualFunding || 0,
                                marketType: 'FUTURES', high24h: 0, low24h: 0,
                                rank: 0, volumeChange24h: 0, openInterestChange24h: 0, longShortRatio: 0,
                                longLiq24h: 0, shortLiq24h: 0
                            };
                        }

                        // SPECIAL: Render CC even if 0 price (Offline Mode)
                        // If no metric, skip. But if Metric exists (Offline stub) and it IS CC, allow it.
                        if (!metric) return null;
                        if (metric.price === 0 && !isCC) return null; // Filter out bad load for others, but keep CC

                        const signal = generateTradeSignal([metric], override, timeframe);
                        const activeTrades = history.filter(h => h.symbol === symbol && !closedHistory.find(c => c.id === h.id));

                        return (
                            <ScannerCard
                                key={symbol} symbol={symbol} metric={metric} signal={signal} activeTrades={activeTrades}
                                onSignal={(s) => addToHistory(symbol, s, metric.price, timeframe)}
                            />
                        );
                    })
                )}
            </div>

            {/* LIVE SIGNAL FEED TABLE - STRATEGY ENABLED ZINC THEME */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden shadow-xl">
                <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                    <h3 className="font-semibold text-sm flex items-center gap-2 text-zinc-200">
                        <ArrowUpRight className="h-4 w-4 text-emerald-400" /> Active Positions
                    </h3>
                    <div className="flex gap-2">
                        {walletData?.positions?.some((p: any) => parseFloat(p.position?.szi || p.szi) !== 0) && (
                            <button
                                onClick={async () => {
                                    if (confirm("☢️ CLOSE ALL POSITIONS? This will market sell everything on-chain.")) {
                                        const positions = walletData.positions.filter((p: any) => parseFloat(p.position?.szi || p.szi) !== 0);
                                        for (const item of positions) {
                                            const p = item.position || item;
                                            const sym = p.coin + "USDT";
                                            const szi = parseFloat(p.szi);
                                            const action = szi > 0 ? "SELL" : "BUY";
                                            const sizeUsd = Math.abs(szi * parseFloat(p.entryPx));

                                            // Close it
                                            await executeTradeImpl(
                                                sym,
                                                action,
                                                parseFloat(p.entryPx), // price (approx)
                                                sizeUsd, // size
                                                1, // lev
                                                true // reduceOnly
                                            );
                                            // Wait 500ms to avoid rate limit
                                            await new Promise(r => setTimeout(r, 500));
                                        }
                                        alert("All Close Orders Sent.");
                                    }
                                }}
                                className="text-[10px] bg-red-600 hover:bg-red-500 text-white flex gap-1 items-center transition-colors px-2 py-1 rounded font-bold shadow-lg shadow-red-900/20"
                            >
                                <Trash2 className="h-3 w-3" /> CLOSE ALL
                            </button>
                        )}
                        {history.length > 0 && <button onClick={() => setHistory([])} className="text-[10px] text-zinc-500 hover:text-zinc-300 flex gap-1 items-center transition-colors border border-zinc-800 px-2 py-1 rounded"><Trash2 className="h-3 w-3" /> Clear UI</button>}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">

                        <thead className="bg-white/5 uppercase text-[10px] text-zinc-400 tracking-wider">
                            <tr>
                                <th className="p-3">Asset</th>
                                <th className="p-3">Strategy</th>
                                <th className="p-3">Size</th>
                                <th className="p-3">Lev</th>
                                <th className="p-3 text-right">Entry</th>
                                <th className="p-3 text-right">Mark</th>
                                <th className="p-3 text-right">PnL</th>
                                <th className="p-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {isAutoTrade && walletData?.positions ? (
                                walletData.positions.map((item: any, i: number) => {
                                    const p = item.position || item;
                                    const szi = parseFloat(p.szi);
                                    const entryPx = parseFloat(p.entryPx);
                                    if (szi === 0) return null;

                                    // DUST FILTER: Ignore positions < $1 Value
                                    if (Math.abs(szi * entryPx) < 1.0) return null;

                                    const sym = p.coin + "USDT";
                                    const internal = history.find(h => h.symbol === sym);

                                    const trade = {
                                        symbol: sym,
                                        action: parseFloat(p.szi) > 0 ? "BUY" : "SELL",
                                        entryPrice: parseFloat(p.entryPx),
                                        size: Math.abs(parseFloat(p.szi) * parseFloat(p.entryPx)),
                                        unrealizedPnl: parseFloat(p.unrealizedPnl || p.unrealized_pnl),
                                        leverage: p.leverage || { type: 'cross', value: 20 }, // Default if missing (Hyperliquid)
                                        isLive: true,
                                        price: parseFloat(p.entryPx),
                                        strategy: internal?.strategy || "ON-CHAIN"
                                    };

                                    // RENDER ROW DIRECTLY HERE TO AVOID MAP RETURN ISSUES
                                    // ... duplicate row logic needed or helper function ...
                                    // Actually, let's just construct the display array above the return if possible.
                                    // But since we are inside JSX, we must use map.

                                    // Reuse the logic below? 
                                    // The previous code block (lines 865+) was mapping `displayPositions`.
                                    // I will just populate `displayPositions` cleanly before the JSX return.
                                    return trade;
                                }).filter(Boolean).map((trade: any, i: number) => {
                                    // FIX: Look up FULL symbol first (ZECUSDT), then try stripped (ZEC)
                                    const currentPrice = data[trade.symbol]?.price || data[trade.symbol.replace("USDT", "")]?.price || trade.entryPrice || trade.price;
                                    const isBuy = trade.action === 'BUY';
                                    const pnlVal = trade.unrealizedPnl;

                                    // Calculate Liq Dist
                                    let liqDistStr = "---";
                                    let liqRiskColor = "text-zinc-500";

                                    if (activePositions) {
                                        const livePos = activePositions.find(p => (p.coin + "USDT") === trade.symbol);
                                        if (livePos && livePos.liquidationPx) {
                                            const liqPx = parseFloat(livePos.liquidationPx);
                                            const distPct = Math.abs((currentPrice - liqPx) / currentPrice) * 100;
                                            liqDistStr = `Liq: ${distPct.toFixed(1)}%`;
                                            if (distPct < 10) liqRiskColor = "text-red-500 font-bold animate-pulse";
                                            else if (distPct < 25) liqRiskColor = "text-amber-500";
                                            else liqRiskColor = "text-emerald-500/50";
                                        }
                                    }

                                    return (
                                        <tr key={i} className={`hover:bg-white/5 transition-colors ${trade.isLive ? 'bg-emerald-500/5' : ''}`}>
                                            <td className="p-3 font-medium">
                                                <div className="flex items-center gap-2">
                                                    <span className={isBuy ? "text-emerald-400" : "text-rose-400"}>{trade.symbol.replace("USDT", "")}</span>
                                                    <span className={`text-[9px] px-1 rounded ${isBuy ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                                                        {trade.action}
                                                    </span>
                                                    <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 rounded">ON-CHAIN</span>
                                                </div>
                                                <div className={`text-[9px] mt-0.5 ${liqRiskColor}`}>{liqDistStr}</div>
                                            </td>
                                            <td className="p-3 text-zinc-400 text-xs">
                                                {trade.strategy === 'ON-CHAIN' ? <span className="text-zinc-500 flex items-center gap-1">🔗 Manual</span> : <span className="text-blue-400 font-mono">{trade.strategy}</span>}
                                            </td>
                                            <td className="p-3 text-zinc-400">${Math.abs(trade.size).toFixed(0)}</td>
                                            <td className="p-3 text-amber-400 font-mono text-xs">
                                                {trade.leverage?.type === 'cross' ? 'C' : 'I'}{trade.leverage?.value || trade.leverage || '?'}x
                                            </td>
                                            <td className="p-3 text-zinc-400 text-right">{trade.entryPrice}</td>
                                            <td className="p-3 text-zinc-400 text-right">{currentPrice?.toFixed(4)}</td>
                                            <td className={`p-3 text-right font-bold ${pnlVal >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                ${pnlVal?.toFixed(2)}
                                            </td>
                                            <td className="p-3 text-right">
                                                <button
                                                    onClick={async () => {
                                                        if (confirm(`Close ${trade.symbol} position?`)) {
                                                            const closeAction = trade.action === 'BUY' ? 'SELL' : 'BUY';
                                                            const currentPrice = data[trade.symbol]?.price || trade.price;
                                                            // Use executeTradeImpl
                                                            // 3rd arg is Price (we use current), 4th is Size (Position Size), 5th is Leverage
                                                            await executeTradeImpl(
                                                                trade.symbol,
                                                                closeAction,
                                                                currentPrice,
                                                                trade.size, // Size in USD
                                                                1, // Leverage (Close doesn't strictly need lev matching if ReduceOnly, but API takes it)
                                                                true // Reduce Only
                                                            );
                                                            // Optimistic UI Update might be tricky with Wallet Polling, but the poll will clear it in 10s.
                                                            // Force refresh if possible or just alert.
                                                            // For now, let it be naturally removed by poll.
                                                        }
                                                    }}
                                                    className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-bold transition-all"
                                                >
                                                    Close
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                // No positions or Sim Mode if needed (simplifying for now as the fix)
                                <tr><td colSpan={7} className="p-4 text-center text-zinc-500 italic">No Active Trades</td></tr>
                            )}
                        </tbody>
                        {/* Remove duplicate no positions msg since handled within IIFE */}
                    </table>
                    {/* Clean up history.length check since logic is now internal */}
                </div>
            </div>

            {/* CLOSED LEDGER - STRATEGY ENABLED ZINC THEME */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden shadow-xl">
                <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                    <h3 className="font-bold text-zinc-300 text-sm">Closed Ledger</h3>
                    {(closedHistory.length > 0 || history.length > 0) && (
                        <div className="flex gap-2">
                            {closedHistory.length > 0 && (
                                <button
                                    onClick={() => {
                                        if (confirm("Clear Closed History Only?")) {
                                            setClosedHistory([]);
                                            localStorage.removeItem('canton_closed_history');
                                        }
                                    }}
                                    className="text-[10px] text-zinc-400 hover:text-zinc-200 flex gap-1 items-center transition-colors border border-zinc-800 px-2 py-1 rounded bg-zinc-900"
                                >
                                    <Trash2 className="h-3 w-3" /> Clear Log
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    if (confirm("⚠️ FACTORY RESET: This will clear ALL active trades, history, and reset your session. Are you sure?")) {
                                        setHistory([]);
                                        setClosedHistory([]);
                                        localStorage.removeItem('canton_signal_history');
                                        localStorage.removeItem('canton_closed_history');
                                    }
                                }}
                                className="text-[10px] text-rose-500 hover:text-rose-400 flex gap-1 items-center transition-colors border border-rose-900/30 px-2 py-1 rounded bg-rose-950/10"
                            >
                                <Trash2 className="h-3 w-3" /> FACTORY RESET
                            </button>
                        </div>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-zinc-900/80 uppercase text-[10px] text-zinc-500 tracking-wider">
                            <tr>
                                <th className="p-3">Asset</th>
                                <th className="p-3">Strat</th>
                                <th className="p-3">Time In</th>
                                <th className="p-3">Time Out</th>
                                <th className="p-3 text-right">Size</th>
                                <th className="p-3 text-right">PnL</th>
                                <th className="p-3 text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/50">
                            {closedHistory.map((h, i) => (
                                <tr key={i} className="hover:bg-zinc-800/20 transition-colors">
                                    <td className="p-3 text-zinc-300 font-medium">
                                        {h.symbol} <span className={`text-[10px] ${h.action === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>{h.action}</span>
                                    </td>
                                    <td className="p-3">
                                        <span className={`text-[10px] px-1 rounded border ${h.strategy === 'MAGNET' ? 'text-purple-400 border-purple-900' :
                                            h.strategy === 'SNIPER' ? 'text-amber-400 border-amber-900' :
                                                h.strategy === 'SWEEP' ? 'text-fuchsia-400 border-fuchsia-900 shadow-[0_0_10px_rgba(232,121,249,0.3)]' : // V2 GLOW
                                                    h.strategy === 'FADE' ? 'text-cyan-400 border-cyan-900' :
                                                        'text-zinc-600 border-zinc-800'
                                            }`}>
                                            {h.strategy || 'TREND'}
                                        </span>
                                    </td>
                                    <td className="p-3 text-zinc-600 text-xs">{new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                    <td className="p-3 text-zinc-600 text-xs">{new Date(h.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                    <td className="p-3 text-right text-zinc-500 text-xs">${(h.size || 100).toFixed(0)}</td>
                                    <td className={`p-3 text-right font-bold ${h.pnlValue >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        ${h.pnlValue.toFixed(2)}
                                    </td>
                                    <td className="p-3 text-right text-xs text-zinc-500">
                                        {h.pnlValue > 0 && h.exitReason === 'STOP_LOSS' ? (
                                            <span className="text-emerald-400 font-bold">Trailing Stop 🛡️</span>
                                        ) : (
                                            h.exitReason || h.status
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {/* CONFIRM LIVE TRADING MODAL (Correctly Placed) */}
            {showConfirmLive && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-zinc-900 border border-red-500 rounded-2xl p-6 max-w-md w-full shadow-2xl shadow-red-900/20">
                        <div className="flex items-center gap-3 text-red-500 mb-4">
                            <AlertTriangle className="h-8 w-8" />
                            <h3 className="text-xl font-bold uppercase tracking-wider">Danger Zone</h3>
                        </div>

                        <p className="text-zinc-300 mb-6 leading-relaxed">
                            You are about to enable <strong className="text-white">LIVE AUTOMATED TRADING</strong>.
                            <br /><br />
                            • Real orders will be placed on <strong>Hyperliquid</strong>.<br />
                            • Your balance of <strong>$250</strong> is at risk.<br />
                            • Ensure your <strong>.env.local</strong> keys are correct.
                        </p>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowConfirmLive(false)}
                                className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    setIsAutoTrade(true);
                                    setShowConfirmLive(false);
                                }}
                                className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold tracking-wider transition-colors shadow-lg shadow-red-900/50"
                            >
                                ENABLE LIVE TRADING
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}

function ScannerCard({ symbol, metric, signal, activeTrades, onSignal }: { symbol: string, metric: any, signal: TradeSignal, activeTrades?: any[], onSignal: (s: TradeSignal) => void }) {
    // Auto-Report / Ghost Trigger
    useEffect(() => {
        // Trigger if Active OR if it's a "Blocked" signal (Ghost candidate)
        const isGhostCandidate = signal.reasons.some(r => r.includes("OFF-HOURS"));

        if (signal.action !== 'NEUTRAL' || isGhostCandidate) {
            const timer = setTimeout(() => onSignal(signal), 100);
            return () => clearTimeout(timer);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signal.action, symbol, JSON.stringify(signal.reasons)]);

    const isBuy = signal.action === 'BUY';
    const isSell = signal.action === 'SELL';

    return (
        <div className={`rounded-xl border p-4 ${isBuy ? 'bg-green-500/5 border-green-500/30' : isSell ? 'bg-red-500/5 border-red-500/30' : 'bg-white/5 border-white/10'} relative min-h-[140px] flex flex-col justify-between`}>
            <div>
                <div className="flex justify-between items-start mb-2">
                    <div>
                        <h3 className="font-bold text-lg">{symbol.replace("USDT", "")}</h3>
                        <div className="text-2xl font-mono">${metric.price.toLocaleString()}</div>
                    </div>
                    <div className="px-2 py-1 rounded text-xs font-bold border border-white/10 bg-white/5">
                        {metric.marketType === 'SPOT' && <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded mr-2">SPOT</span>}
                        {signal.action} {signal.leverage}
                    </div>
                </div>

                {/* STATUS BAR: Show for NEUTRAL too if reason exists */}
                {(signal.action !== 'NEUTRAL' || signal.reasons.length > 0) && (
                    <div className={`mt-3 p-2 rounded text-xs space-y-1 ${signal.action !== 'NEUTRAL' ? 'bg-black/20' : 'bg-white/5 border border-white/5'}`}>
                        {signal.action !== 'NEUTRAL' && (
                            <>
                                <div className="flex justify-between"><span>TP:</span> <span className="text-green-500 font-bold">${(signal.target || 0).toFixed(2)}</span></div>
                                <div className="flex justify-between"><span>SL:</span> <span className="text-red-500 font-bold">${(signal.stopLoss || 0).toFixed(2)}</span></div>
                            </>
                        )}
                        <div className={`text-[10px] mt-1 ${signal.action === 'NEUTRAL' ? 'text-zinc-400 italic' : 'opacity-70'}`}>
                            {signal.reasons[0] || "Scanning..."}
                        </div>
                    </div>
                )}
            </div>

            {activeTrades && activeTrades.length > 0 && (
                <div className="mt-4 text-center text-xs font-bold bg-white/10 py-2 rounded border border-white/5 text-emerald-400 animate-pulse">
                    {activeTrades.length > 1
                        ? `${activeTrades.length} ACTIVE POSITIONS`
                        : `ACTIVE ${activeTrades[0].action} (${activeTrades[0].leverage})`
                    }
                </div>
            )}
        </div>
    );
}

