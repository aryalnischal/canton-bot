import type { ExchangeMetric } from "./types.ts";

export type SignalAction = 'BUY' | 'SELL' | 'NEUTRAL';

export interface TradeSignal {
    action: SignalAction;
    leverage: string;
    target?: number;
    stopLoss?: number;
    confidence: number;
    score?: number;      // Internal Score
    threshold?: number;  // Trigger Level
    reasons: string[];
    // Features for AI
    features?: {
        rsi: number;
        trend_slope: number;
        volatility: number;
        funding_rate: number;
        volume_surge: boolean;
        distance_from_sma: number;
    };
}

// ... (Rest of file interface) ...



export interface ManualAnalysisData {
    manualPrice?: number;
    manualChange?: number;
    manualFunding?: number;
    liqResistancePrice?: number;
    liqResistanceVol?: number;
    liqSupportPrice?: number;
    liqSupportVol?: number;
    // New Multi-Timeframe Max Pain Levels (CoinGlass)
    liq15m?: number;
    liq1h?: number;
    liq4h?: number;
    bias?: 'LONG' | 'SHORT'; // Directional Bias
    minScore?: number;       // Custom Score Threshold
    liq1w?: number;
    strategy?: 'SCALP' | 'SWING';
}

// Synthetic CC Logic
function calculateSyntheticCC(btcMetric: ExchangeMetric): TradeSignal {
    if (!btcMetric) return { action: 'NEUTRAL', leverage: '1x', confidence: 0, reasons: ["Waiting for BTC data"] };

    // Logic: CC flows follow BTC Beta but with lag.
    // If BTC Strong Trend -> CC likely to follow with 2x volatility.

    const btcTrend = btcMetric.priceChange24h; // This is actually Interval Change now
    const action: SignalAction = btcTrend > 1.5 ? 'BUY' : (btcTrend < -1.5 ? 'SELL' : 'NEUTRAL');

    return {
        action,
        leverage: '2x', // Lower leverage for Synthetic/Illiquid
        target: 0,
        confidence: 60, // Lower confidence for synthetic
        reasons: [`Synthetic Signal derived from BTC Trend (${btcTrend.toFixed(2)}%)`, "Correlation: 0.85"]
    };
}

export type RiskMode = 'SAFE' | 'AGGRESSIVE';



export interface BacktestResult {
    scenarioName: string;
    signal: SignalAction;
    isWin: boolean;
    duration: string;
    pnl: number;
    finalBalance: number;
    description: string;
}

// Added overrideDate for Backtesting purposes
// Removing unused 'riskMode' param to fix lint
export function generateTradeSignal(metrics: ExchangeMetric[], manualOverride?: ManualAnalysisData, timeframe: string = '24h', _riskMode: RiskMode = 'SAFE', overrideDate?: Date): TradeSignal {
    const m = metrics[0];
    let score = 0;
    const reasons: string[] = []; // Fix: Use const since array is mutable
    let action: SignalAction = 'NEUTRAL';
    let target = undefined;
    let stopLoss = undefined;
    let leverage = '5x';

    if (!m) return { action: 'NEUTRAL', confidence: 0, reasons: ["No Data"], leverage: '1x' };

    // --- SESSION AWARENESS (Day vs Night) ---
    // User Strategy: "Day = Trend/Liquidity", "Night = Low Vol/ML/Sniper"
    // Using UTC. CST Day (8-20) = 14:00 - 02:00 UTC.
    // Night = 02:00 - 14:00 UTC.
    const now = overrideDate || new Date();
    const utcHour = now.getUTCHours();
    const isNight = (utcHour >= 2 && utcHour < 14);

    const change = m.priceChange24h;
    const funding = m.fundingRate;
    const volChange = m.volumeChange24h || 0;
    const isHighVol = volChange > 10;

    try {
        // 1. VOLATILITY CHECK
        // const isCompressed = volChange < -15; // Unused

        // "Massive Liquidity Flush": Volume Spike > 15% + Extreme Price Move (Wick)
        // CRITICAL FIX: Ensure High/Low are non-zero before comparing
        const hasValidRange = m.high24h > 0 && m.low24h > 0;
        const isLiquidityFlush = hasValidRange && (
            (m.price > m.high24h * 0.99 && volChange > 15) ||
            (m.price < m.low24h * 1.01 && volChange > 15)
        );

        // --- STRATEGY V2: LIQUIDITY SWEEP (V-SHAPE REVERSAL) ---
        // Setup: Break 24h High/Low -> Wick -> Reversal Close
        // Requires: High Volatility (Liquidation Fuel)

        // Bullish Sweep: Price DIPPED below Low, but is now ABOVE it (Reclaimed)
        const openPx = m.open || m.price; // Fallback to current price if open undefined (rare)
        const isBullishSweep = hasValidRange && m.low24h > openPx * 0.5 && (
            m.price > m.low24h && m.price < m.low24h * 1.015 && volChange > 15
        );

        // Bearish Sweep: Price SPIKED above High, but is now BELOW it (Reclaimed)
        const isBearishSweep = hasValidRange && m.high24h < openPx * 1.5 && (
            m.price < m.high24h && m.price > m.high24h * 0.985 && volChange > 15
        );

        const isLiquiditySweep = isBullishSweep || isBearishSweep;

        // 2. TREND SCORING (CONDITIONAL)
        const minMove = timeframe === '15m' ? 0.35 : 1.0;
        let threshold = 2.5; // BALANCED TRIGGER (Was 4.0 — too restrictive, caused zero trades)

        // STOCHASTIC / RSI PROXY (Smart Entry)
        // Range Position: 0 = Low, 1 = High
        const stoch = (m.price - m.low24h) / (m.high24h - m.low24h);
        const isOverbought = stoch > 0.88; // Strict Top
        const isOversold = stoch < 0.12;   // Strict Bottom

        // BACKWARDS COMPATIBILITY ALIASES (Fix TS Errors)
        const isAtTop = isOverbought;
        const isAtBottom = isOversold;

        // LOGIC UPDATE: RSI FILTER
        // Reject BUYS at Resistance unless it's a massive breakout (Flush)
        const isRsiUnsafe = (change > 0 && isOverbought) || (change < 0 && isOversold);

        if (Math.abs(change) > minMove) {
            const trendDir = change > 0 ? 1 : -1;
            let weight = 2.0;

            if (isRsiUnsafe && !isLiquiditySweep) {
                // RSI GUARD: If Overbought and NO Volume Spike -> Reversal Risk
                weight = -2.0; // Penalize Trend
                reasons.push(`⚠️ RSI Extreme (${stoch.toFixed(2)}): Suppressing Trend (Risk of Reversal)`);
            } else if (isLiquiditySweep) {
                // SWEEP OVERRIDE: Ignore the Trend Score (which is usually oppsite/bearish during a Bullish Sweep)
                // We rely purely on the Sweep Bonus later.
                weight = 0;
                reasons.push("🌊 SWEEP OVERRIDE: Ignoring Trend Score (Reversal Mode)");
            } else {
                // ADDITIVE BONUSES
                if (Math.abs(change) > 1.5) {
                    weight += 1.0;
                    reasons.push(`📈 Solid Trend (>1.5%)`);
                }
                if (isHighVol) {
                    weight += 1.0;
                    reasons.push("🔊 High Volume Confirmation");
                }
            }

            score += trendDir * weight;
            if (weight > 0) reasons.push(`Trend (${timeframe}): ${change.toFixed(2)}%`);

            // MOMENTUM BOOST (Only if not at extreme or if flushing)
            if (Math.abs(change) > 5.0 && (!isRsiUnsafe || isLiquiditySweep)) {
                score += trendDir * 1.5; // Boost
                reasons.push("🚀 MOMENTUM: Strong Move (>5%)");
            }
        } else if (Math.abs(change) > 0.02) {
            score += 0.1; // Flat (Hold)
        } else {
            score += 0.1;
            reasons.push("Market Flat - Scanning Order Book...");
        }

        // 3. MAX PAIN LOGIC (Real Data Source)
        // We use Funding Rate & Premium as proxies for Crowding since direct Liq data is limited.

        // High Positive Funding (>0.03% per hour) = Longs paying Shorts -> Crowded Longs.
        // High Negative Funding (<-0.03%) = Shorts paying Longs -> Crowded Shorts.

        const fundingRate = m.fundingRate || 0; // Hourly typically
        const painScore = 0;

        // CROWDED LONGS -> Pain is Down
        if (fundingRate > 0.0003) {
            score -= 1.5;
            reasons.push(`🩸 Max Pain: Crowded Longs (Fund ${(fundingRate * 100).toFixed(4)}%) -> Bias Short`);
        }

        // CROWDED SHORTS -> Pain is Up
        else if (fundingRate < -0.0003) {
            score += 1.5;
            reasons.push(`🩸 Max Pain: Crowded Shorts (Fund ${(fundingRate * 100).toFixed(4)}%) -> Bias Long`);
        }

        // IMPLIED SQUEEZE (Price Up + OI Down = Short Covering)
        // We use volume/OI correlation if available, or just Price vs Funding divergence.
        // If Price is dumping but Funding is POSITIVE -> Longs trapped (Bag holders)
        if (change < -3.0 && fundingRate > 0.0001) {
            score -= 2.0; // Accelerate the dump
            reasons.push("📉 Trapped Longs: Price dropping while Funding Positive");
        }

        // Define LSR for downstream logic (Fallback since API doesn't provide it)
        const lsr = m.longShortRatio || 1.0;

        if (m.high24h && m.low24h && m.price > 0) {
            // Unused vars: distToHigh, distToLow


            // FADE / MAGNET SCORING
            if (isAtTop) {
                // Close to Top
                if (isBearishSweep) {
                    // SWEEP DETECTED: Price touched High, Grabbed Liquidity, and Rejected.
                    score -= 5.0; // STRONG SELL
                    reasons.push("🧹 SWEEP: Bearish Liquidity Grab at Highs");
                } else if (isLiquidityFlush) {
                    // CONTEXT AWARENESS: Breakout or Squeeze?
                    if (lsr > 2.5) {
                        score -= 4.5; // AGGRESSIVE SHORT (Trap)
                        reasons.push(`🩸 Fakeout Detected: Flush into Crowded Longs (LSR ${lsr.toFixed(1)})`);
                    } else {
                        score += 4.5; // BOOST: Instant Trigger for Breakout (User Request: Hunt Liq)
                        reasons.push("🧲 High Liquidity Magnet (Confirmed Breakout)");
                    }
                } else {
                    // SAFETY: Don't Fade a Rocket (Strong Momentum Guard)
                    if (change > 8) {
                        // EXCEPTION: If Crazy Crowded, Short the Euphoria
                        if (lsr > 3.0) {
                            score -= 3.0;
                            reasons.push("🩸 Euphoria Short: Excessive Longs in Uptrend");
                        } else {
                            score -= 0.5; // Slight dampening, but NO SELL signal.
                            reasons.push("🚀 Strong Trend: Respecting Momentum (No Fade)");
                        }
                    } else {
                        score -= 2.5; // FADE (Reversal) - Reduced from 3.0 for safety
                        reasons.push("🛑 Resistance FADE: Selling the Top");
                    }
                }
            }

            if (isAtBottom) {
                // Close to Bottom
                if (isBullishSweep) {
                    // SWEEP DETECTED: Price touched Low, Grabbed Liquidity, and Reclaimed.
                    score += 5.0; // STRONG BUY
                    reasons.push("🧹 SWEEP: Bullish Liquidity Grab at Lows");
                } else if (isLiquidityFlush) {
                    score -= 2.0; // Breakdown (Magnet)
                    reasons.push("🧲 Low Liquidity Magnet (Breakdown Mode)");
                } else {
                    score += 3.0; // FADE (Reversal) - Stronger than trend
                    reasons.push("💎 Support FADE: Buying the Bottom");
                }
            }
        }

        // --- NIGHT MODE SMART LOGIC (24/7 ACTIVE) ---
        // User Directive: "Don't stop at night. Be Smart. Hunt Flushes."
        // Strategy:
        // 1. If it's a FLUSH (High Vol + Magnet) -> FULL CONVICTION (Sniper).
        // 2. If it's a Generic Trend (Mid-range) -> Dampen (Avoid Chop).

        if (isNight && !manualOverride) {
            // Check if we are in a "Smart" setup (Sweep or Magnet)
            // Magnet = Price at edges (High/Low)
            const isSmartSetup = isLiquiditySweep || (Math.abs(score) >= 4.5);

            if (isSmartSetup) {
                // ACTIVE NIGHT TRADING
                reasons.push("🌙 Night Mode: 🟢 SMART TRADE DETECTED (Sweep/Magnet)");
                // No dampening. Let it fly.
            } else if (Math.abs(score) < 5) {
                // PASSIVE SAFETY
                score = score * 0.5; // Dampen weak trends to avoid chop
                reasons.push("🌙 Night Mode: 🛡️ Dampening Weak Trend (Safety)");
            }
        }

        // 5. MANUAL OVERRIDES
        if (manualOverride) {
            if (manualOverride.bias === 'LONG') score += 5;
            if (manualOverride.bias === 'SHORT') score -= 5;
            if (manualOverride.minScore) threshold = manualOverride.minScore;
        }

        // 6. FINAL DECISION
        if (score >= threshold) action = 'BUY';
        if (score <= -threshold) action = 'SELL';

        // DEBUG LOGGING
        // console.log(`[ANALYSIS] ${m.symbol} Score: ${score.toFixed(2)}, Threshold: ${threshold}, Action: ${action}`);
        if (action === 'NEUTRAL' && Math.abs(score) > 2) {
            console.log(`[ANALYSIS] REJECTED ${m.symbol}: Score ${score.toFixed(2)} vs Threshold ${threshold} (Too Weak)`);
        }

    } catch (e) {
        console.error("Analysis Error", e);
        reasons.push("Error calculating signal");
    }

    const confidence = Math.min(Math.abs(score) * 15 + 30, 95);

    // SMART LEVERAGE ENGINE
    const isAlt = !['BTC', 'ETH'].includes(m.symbol?.replace("USDT", "") || "");
    const absScore = Math.abs(score);

    // Default: Conservative Entry
    leverage = '3x';

    // DYNAMIC LEVERAGE TIERS (Score-Based)
    if (absScore >= 5.5) leverage = '5x';  // Solid Trend
    if (absScore >= 7.5) leverage = '8x';  // High Conviction
    if (absScore >= 9.0) leverage = '10x'; // Sniper Setup

    // SWEEP BONUS: Liquidity Sweeps are high probability, merit higher leverage
    // We map reason string since isLiquiditySweep isn't in scope here cleanly without passing it, 
    // but we can trust the score reflection or check reasons.
    const isSweepTrace = reasons.some(r => r.includes("SWEEP") || r.includes("Magnet"));

    if (isSweepTrace) {
        // Boost Sweeps to minimum 8x
        const currentLevVal = parseInt(leverage.replace("x", ""));
        if (currentLevVal < 8) leverage = '8x';

        // If it's a "Perfect Sweep" (Score > 8), go 10x
        if (absScore >= 8) leverage = '10x';
    }

    // Safety Cap for Alts (Max 8x for Alts unless it's a 10/10 or Sweep)
    if (isAlt && leverage === '10x' && absScore < 10 && !isSweepTrace) leverage = '8x';

    // ADAPTIVE TP: If volatility is low (change < 2%), aim for 2%, else 4%
    // EXCEPTION: If Liquidity Flush (Breakout), turn on GREED MODE (Aim for 6-8%)
    let baseTargetPct = Math.abs(change) < 2.0 ? 0.02 : 0.04;

    // Check if we detected a Flush earlier (Need to recreate flag or check reasons? No, rely on logic)
    // Actually, `score` reflects the Flush (+4.5)
    // If Score > 6 (Boosted), aim higher.
    if (Math.abs(score) >= 6) baseTargetPct = 0.08; // 8% Target for High Conviction Breakouts

    if (action === 'BUY') {
        const structuralTp = (m.high24h > m.price * 1.02) ? m.high24h : (m.price * (1 + baseTargetPct));
        target = manualOverride?.liqResistancePrice || structuralTp;

        // RISK MANAGEMENT FIX (Jan 4)
        // New: Target 4% EQUITY Risk. Distance = TargetRisk / Leverage
        const targetEquityRisk = 0.04; // 4% Max Loss ($10 on $250)

        let levVal = parseInt(leverage.replace("x", "")) || 3;
        const riskPct = targetEquityRisk / levVal; // Dynamic Distance Scaling (e.g. 7x -> 0.57%)

        stopLoss = (m.low24h > 0 && m.low24h > m.price * (1 - riskPct))
            ? m.low24h * 0.999 // If structural low is tighter, use it
            : m.price * (1 - riskPct); // Else use fixed risk

        // Layered TP Info
        reasons.push(`🎯 TP1: $${(m.price * 1.01).toFixed(m.price < 10 ? 4 : 2)} (1%)`);
        reasons.push(`🎯 TP2: $${(m.price * 1.025).toFixed(m.price < 10 ? 4 : 2)} (2.5%)`);
        reasons.push(`🎯 TP3: $${(m.price * 1.05).toFixed(m.price < 10 ? 4 : 2)} (Moon)`);

        if (leverage === '10x') reasons.push("🚀 10x SNIPER MODE: High Confidence Range Play");
        if (baseTargetPct === 0.02) reasons.push("📉 Low Volatility: Reduced Target to 2%");
    }

    if (action === 'SELL') {
        const structuralTp = (m.low24h > 0 && m.low24h < m.price * 0.98) ? m.low24h : (m.price * (1 - baseTargetPct));
        target = manualOverride?.liqSupportPrice || structuralTp;

        // RISK MANAGEMENT FIX (Jan 4)
        const targetEquityRisk = 0.04; // 4% Max Loss
        let levVal = parseInt(leverage.replace("x", "")) || 3;
        const riskPct = targetEquityRisk / levVal;

        stopLoss = (m.high24h > 0 && m.high24h < m.price * (1 + riskPct))
            ? m.high24h * 1.001
            : m.price * (1 + riskPct);

        // Layered TP Info
        reasons.push(`🎯 TP1: $${(m.price * 0.99).toFixed(m.price < 10 ? 4 : 2)} (1%)`);
        reasons.push(`🎯 TP2: $${(m.price * 0.975).toFixed(m.price < 10 ? 4 : 2)} (2.5%)`);
        reasons.push(`🎯 TP3: $${(m.price * 0.95).toFixed(m.price < 10 ? 4 : 2)} (Dump)`);

        if (leverage === '10x') reasons.push("🚀 10x SNIPER MODE: High Confidence Range Play");
        if (baseTargetPct === 0.02) reasons.push("📉 Low Volatility: Reduced Target to 2%");
    }

    // AI Feature Construction
    // Note: RSI is currently not calculated in this scope, defaulting to 50 until integrated with Candle History.
    const features = {
        rsi: 50,
        trend_slope: Math.abs(change), // Proxy for slope
        volatility: Math.abs(m.high24h - m.low24h) / m.price, // ATR proxy
        funding_rate: funding,
        volume_surge: isHighVol,
        distance_from_sma: 0 // Placeholder until SMA is passed in
    };

    return {
        action,
        leverage,
        target,
        stopLoss,
        confidence: Math.min(Math.abs(score) * 10, 100),
        score,
        reasons: (action === 'NEUTRAL' && reasons.length === 0) ? ["Choppy condition"] : reasons,
        features // Pass to Scanner
    };
}

export function simulateBacktest(scenarios: any[], initialCapital: number): BacktestResult[] {
    let balance = initialCapital;
    const results: BacktestResult[] = [];

    scenarios.forEach(scenario => {
        const signal = generateTradeSignal([], scenario.data);

        const isWin = signal.action === scenario.expectedResult;
        let pnl = 0;

        if (signal.action !== 'NEUTRAL') {
            if (isWin) {
                pnl = balance * 0.15;
            } else {
                pnl = -balance * 0.05;
            }
        }

        balance += pnl;

        results.push({
            scenarioName: scenario.name,
            signal: signal.action,
            isWin,
            duration: scenario.duration,
            pnl,
            finalBalance: balance,
            description: scenario.description
        });
    });

    return results;
}
