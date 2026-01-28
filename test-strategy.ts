
import { generateTradeSignal } from './src/lib/analysis';
import { ExchangeMetric } from './src/lib/types';

const LOG_PASS = (msg: string) => console.log(`✅ PASS: ${msg}`);
const LOG_FAIL = (msg: string, obj?: any) => {
    console.error(`❌ FAILED: ${msg}`);
    if (obj) console.log(JSON.stringify(obj, null, 2));
    process.exit(1);
};

function createMock(overrides: Partial<ExchangeMetric>): ExchangeMetric {
    return {
        symbol: "BTC", price: 100, priceChange24h: 0, volumeChange24h: 0,
        high24h: 105, low24h: 95, fundingRate: 0,
        rank: 1, exchange: 'test', pair: 'BTC/USDT', volume24h: 1000,
        openInterest: 100, openInterestChange24h: 0, longShortRatio: 1,
        longLiq24h: 0, shortLiq24h: 0,
        ...overrides
    };
}

console.log("🚀 STARTING CORE ENGINE VERIFICATION...\n");

// SCENARIO 1: THE "LIQUIDITY FLUSH" (SNIPER MODE)
// Condition: Price breaks High (105) + Volume Spike (>15%)
// Expectation: CONFIRMED BUY + "Sniper" or "Magnet" reason + High Confidence
const flushData = createMock({
    price: 106, // Breakout
    high24h: 105,
    low24h: 95,
    volumeChange24h: 20, // Huge Vol
    priceChange24h: 5.5 // Momentum
});
const flushSignal = generateTradeSignal([flushData], undefined, '24h', 'SAFE', new Date('2025-01-01T12:00:00Z'));

if (flushSignal.action === 'BUY' && flushSignal.reasons.some(r => r.includes("Magnet") || r.includes("Breakout"))) {
    LOG_PASS("Scenario 1: Liquidity Flush (Sniper) Triggered Correctly");
} else {
    LOG_FAIL("Scenario 1 Failed: Did not trigger Flush Sniper", flushSignal);
}


// SCENARIO 2: THE "FADE" (SMART REVERSAL)
// Condition: Price at High (104.5) + Low Volume (-5%) + Weak Momentum
// Expectation: SELL (Fade the top)
const fadeData = createMock({
    price: 104.8, // Near Top (105)
    high24h: 105,
    low24h: 95,
    volumeChange24h: -10, // Low Vol
    priceChange24h: 2.0 // Weak Trend
});
// FIX: 12:00 is Night Mode (02-14). Use 15:00 for Day.
const fadeSignal = generateTradeSignal([fadeData], undefined, '24h', 'SAFE', new Date('2025-01-01T15:00:00Z'));

if (fadeSignal.action === 'SELL' && fadeSignal.reasons.some(r => r.includes("FADE"))) {
    LOG_PASS("Scenario 2: Smart Reversal (Fade) Triggered Correctly");
} else {
    LOG_FAIL("Scenario 2 Failed: Did not trigger Fade at Resistance", fadeSignal);
}


// SCENARIO 3: NIGHT MODE SAFETY
// Condition: Weak Trend (3.5%) at 04:00 AM UTC
// Expectation: NEUTRAL / Dampened Score (Because it's night and trend is weak)
const nightData = createMock({
    price: 100,
    priceChange24h: 3.5, // Normally a BUY (Weak Trend)
    volumeChange24h: 0
});
const nightSignal = generateTradeSignal([nightData], undefined, '24h', 'SAFE', new Date('2025-01-01T04:00:00Z')); // 4 AM UTC

// In production, 3.5% might be enough for a Weak Buy (Score 1-2). 
// Night mode halves it. Score < Threshold (3) -> Neutral.
if (nightSignal.action === 'NEUTRAL' && nightSignal.reasons.some(r => r.includes("Dampening"))) {
    LOG_PASS("Scenario 3: Night Mode Safety (Dampening) Active");
} else {
    LOG_FAIL("Scenario 3 Failed: Night Mode did not dampen weak signal", nightSignal);
}


// SCENARIO 4: NIGHT MODE HUNTER
// Condition: LIQUIDITY FLUSH at 04:00 AM UTC
// Expectation: BUY (Undampened - "Smart Trade")
const nightSniperData = createMock({
    price: 106, // Breakout
    high24h: 105, // Valid Range
    low24h: 95,
    volumeChange24h: 25, // Massive Vol
    priceChange24h: 6
});
const nightSniper = generateTradeSignal([nightSniperData], undefined, '24h', 'SAFE', new Date('2025-01-01T04:00:00Z')); // 4 AM UTC

if (nightSniper.action === 'BUY' && nightSniper.reasons.some(r => r.includes("SMART TRADE"))) {
    LOG_PASS("Scenario 4: Night Mode Hunter (Smart Trade) Active");
} else {
    LOG_FAIL("Scenario 4 Failed: Night Hunter missed the Flush", nightSniper);
}


// SCENARIO 5: THE "TREND SAUCE" (MOMENTUM FOLLOWING)
// Condition: Strong Move (>5%) + Clean Range (Not at Top)
// Expectation: BUY + "MOMENTUM" Reason
const trendData = createMock({
    price: 102, // Mid-Range
    high24h: 110,
    low24h: 90,
    priceChange24h: 6.5, // Strong Trend
    volumeChange24h: 5
});
const trendSignal = generateTradeSignal([trendData], undefined, '24h', 'SAFE', new Date('2025-01-01T15:00:00Z'));

if (trendSignal.action === 'BUY' && trendSignal.reasons.some(r => r.includes("MOMENTUM"))) {
    LOG_PASS("Scenario 5: Pure Trend Sauce (Momentum) Triggered Correctly");
} else {
    LOG_FAIL("Scenario 5 Failed: Did not follow Strong Trend", trendSignal);
}


// SCENARIO 6: THE "TREND TRAP" (FOMO GUARD)
// Condition: Strong Trend (>5%) BUT Price is at the Top (Range Extreme)
// Expectation: NEUTRAL / SUPPRESSED (Don't Buy the Exact Top)
const trapData = createMock({
    price: 109.5, // At Top (110)
    high24h: 110,
    low24h: 90,
    priceChange24h: 6.5, // Strong Trend (FOMO bait)
    volumeChange24h: 5
});
const trapSignal = generateTradeSignal([trapData], undefined, '24h', 'SAFE', new Date('2025-01-01T15:00:00Z'));

// Should NOT Buy. Should be Neutral or Sell (Fade).
// The logic says: "Range Extreme: Suppressing Trend Follow"
if (trapSignal.action !== 'BUY' && trapSignal.reasons.some(r => r.includes("Suppressing"))) {
    LOG_PASS("Scenario 6: Trend Trap (FOMO Guard) Working");
} else {
    // If it decides to FADE (Sell), that's also acceptable/safe. Just NOT BUY.
    if (trapSignal.action === 'SELL') {
        LOG_PASS("Scenario 6: Trend Trap (FOMO Guard) successfully converted to FADE");
    } else {
        LOG_FAIL("Scenario 6 Failed: Bot FOMO'd into the Top", trapSignal);
    }
}


// SCENARIO 7: MAX PAIN (CROWDED LONGS)
// Condition: LSR High (3.5) + Weak Price Action
// Expectation: SELL/NEUTRAL (Bias Down) due to "Crowded Longs" punishment
const painData = createMock({
    price: 100,
    longShortRatio: 3.5, // Everyone is Long
    priceChange24h: 0.5, // Flat
    volumeChange24h: 0
});
const painSignal = generateTradeSignal([painData], undefined, '24h', 'SAFE', new Date('2025-01-01T15:00:00Z'));

// Should have negative score or reasons mentioning "Crowded Longs"
if (painSignal.reasons.some(r => r.includes("Crowded Longs"))) {
    LOG_PASS("Scenario 7: Max Pain (Crowded Longs) correctly identified");
} else {
    LOG_FAIL("Scenario 7 Failed: Ignored dangerously high LSR", painSignal);
}

console.log("\n✨ CORE ENGINE STATUS: OPERATIONAL");
