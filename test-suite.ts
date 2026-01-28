
import { generateTradeSignal, TradeSignal, ManualAnalysisData } from './src/lib/analysis';
import { ExchangeMetric } from './src/lib/types';

// MOCK DATA FACTORY
function createMetric(overrides: Partial<ExchangeMetric>): ExchangeMetric {
    return {
        symbol: "BTC",
        rank: 1,
        exchange: "Binance",
        pair: "BTC/USDT",
        price: 50000,
        priceChange24h: 0,
        fundingRate: 0.0001,
        volume24h: 1000000,
        volumeChange24h: 0,
        openInterest: 500000,
        openInterestChange24h: 0,
        longShortRatio: 1,
        longLiq24h: 0,
        shortLiq24h: 0,
        high24h: 51000,
        low24h: 49000,
        activeInterval: "24h",
        ...overrides
    };
}

function assert(condition: boolean, message: string, debugObj?: any) {
    if (!condition) {
        console.error(`❌ FAILED: ${message}`);
        if (debugObj) console.log("DEBUG OBJ:", JSON.stringify(debugObj, null, 2));
        process.exit(1);
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

console.log("Starting System Verification Suite... 🛡️");

// ---------------------------------------------------------
// 1. UNIT TESTING: Signal Generation
// ---------------------------------------------------------
console.log("\n[1] UNIT TESTING: Signal Logic");

// FIX: Use fixed DAY_TIME to prevent Night Mode dampening during tests
const DAY_TIME = new Date('2025-01-01T15:00:00Z'); // 15:00 UTC (Day)

// Test A: Strong Bullish Momentum (Needs > 5% to trigger w/o Vol)
const bullData = createMetric({ priceChange24h: 6.5, price: 50500 });
const bullSignal = generateTradeSignal([bullData], undefined, '24h', 'SAFE', DAY_TIME);
assert(bullSignal.action === 'BUY', "Strong Bullish Momentum (>5%) should BUY", bullSignal);

// Test B: Strong Bearish Momentum
const bearData = createMetric({ priceChange24h: -6.5, price: 49500 });
const bearSignal = generateTradeSignal([bearData], undefined, '24h', 'SAFE', DAY_TIME);
assert(bearSignal.action === 'SELL', "Strong Bearish Momentum (<-5%) should SELL");

// Test C: Weak Trend (Under Threshold)
const weakData = createMetric({ priceChange24h: 3.5 });
const weakSignal = generateTradeSignal([weakData], undefined, '24h', 'SAFE', DAY_TIME);
assert(weakSignal.action === 'NEUTRAL', "Weak Trend (3.5%) should be NEUTRAL (Safety)");

// Test D: Choppy Market (Flat)
const fatData = createMetric({ priceChange24h: 0.01 });
const flatSignal = generateTradeSignal([fatData], undefined, '24h', 'SAFE', DAY_TIME);
assert(flatSignal.action === 'NEUTRAL', "Flat Market should be NEUTRAL");

// ---------------------------------------------------------
// 2. REGRESSION TESTING: Defect Confirmation
// ---------------------------------------------------------
console.log("\n[2] REGRESSION TESTING: Bug Fixes");

// Defect #1: "Infinite Money" Glitch (Zero Open Price causing Infinity Change)
// Logic: If change is Infinity, score used to explode. Now, `analysis.ts` handles change logic, 
// but the hook fixes the division. However, we must ensure `analysis.ts` doesn't crash on extreme inputs.
const infinityData = createMetric({ priceChange24h: Infinity });
const infinitySignal = generateTradeSignal([infinityData]);
// We expect it to be handled safely (likely BUY due to huge change, or filtered). 
// Actually, Infinity usually implies Momentum. As long as it doesn't crash or return NaN confidence.
assert(!isNaN(infinitySignal.confidence), "Signal Confidence must not be NaN on Infinity input");

// Defect #2: "False Liquidity Flush" (Missing High/Low Data)
// PREVIOUS BUG: If high24h = 0, price > high24h triggers "Breakout" or "Flush".
const missingRangeData = createMetric({ high24h: 0, low24h: 0, volumeChange24h: 20, price: 50000 });
const flushSignal = generateTradeSignal([missingRangeData]);
// Should NOT trigger Flush because range is invalid.
const isFlush = flushSignal.reasons.some(r => r.includes("Liquidity Flush") || r.includes("Magnet"));
assert(!isFlush, "Missing Range (0) must NOT trigger Liquidity Flush signal");
assert(flushSignal.action === 'NEUTRAL', "Missing Range with High Vol should default NEUTRAL (if no trend)");

// ---------------------------------------------------------
// 3. EDGE CASE TESTING: Extreme Inputs
// ---------------------------------------------------------
console.log("\n[3] EDGE CASE TESTING: Extremes");

// Case A: Price = 0 (Data Feed Failure)
const zeroPriceData = createMetric({ price: 0 });
const zeroSignal = generateTradeSignal([zeroPriceData]);
assert(zeroSignal.action === 'NEUTRAL', "Price 0 must result in NEUTRAL signal");

// Case B: Negative Price (Impossible, but ensure no crash)
const negData = createMetric({ price: -100 });
const negSignal = generateTradeSignal([negData]);
assert(negSignal.action === 'NEUTRAL', "Negative Price must be safely handled (NEUTRAL)");

// Case C: Empty Metrics Array
const emptySignal = generateTradeSignal([]);
assert(emptySignal.action === 'NEUTRAL', "Empty Metrics must return NEUTRAL");

console.log("\n🎉 ALL SYSTEMS GO: Verification Complete.");
