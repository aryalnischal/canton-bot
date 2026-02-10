
import { generateV5Consensus } from './src/lib/v5/analysis-v5.ts';

// MOCK DATA: NEUTRAL (BLIND BACKTEST)
const MOCK_METRICS = [{
    symbol: 'BTC-USD',
    price: 50000,
    priceChange24h: 5.0,
    volumeChange24h: 10,
    high24h: 52000,
    low24h: 48000,
    fundingRate: 0.0001,
    open: 47500
}];

const MOCK_CANDLES = Array(50).fill({ c: 50000, v: 1000 }).map((c, i) => ({ ...c, c: 50000 + (i * 10) }));

function testBlindBacktest() {
    console.log("\n🧪 TEST 1: Blind Backtest (Missing Data)");
    const result = generateV5Consensus(
        MOCK_METRICS as any,
        MOCK_CANDLES,
        null, // No Orderbook
        { longShortRatio: 1, openInterestChange: 0, topTraderLsr: 1 } as any,
        { isBullish: false, isBearish: false, netFlow: 0, whaleScore: 0.5 } as any,
        0,
        0.0001
    );
    console.log(`Result: ${result.action} (Score: ${result.score.toFixed(2)})`);
    console.log(`Votes: V2=${result.votes.v2} V3=${result.votes.v3} V4=${result.votes.v4}`);
    if (result.score < 0.6) console.log("✅ EXPECTED: Weak/Neutral Score");
    else console.log("❌ UNEXPECTED: Score too high");
}

// SCENARIO 2: The "Perfect Dip Buy" (Consensus Long)
function testPerfectStorm() {
    console.log("\n🧪 TEST 2: Perfect Dip Buy (Full Brain Active)");

    // DIP METRICS (Price Crashing into Support)
    const DIP_METRICS = [{
        symbol: 'BTC-USD',
        price: 48000,
        priceChange24h: -5.0,
        volumeChange24h: 30,
        high24h: 53000,
        low24h: 47900,         // Near Lows
        fundingRate: -0.02,    // Shorts Paying Longs
        open: 52000
    }];

    // 60 Candles to satisfy MACD/AVG calculations
    // Pattern: Flat then Crash
    const DIP_CANDLES = Array(60).fill({ c: 52000, v: 5000 }).map((c, i) => {
        if (i < 40) return c; // Flat
        return { c: 52000 - ((i - 40) * 200), v: 20000 }; // Crash
    });
    // Last candle is Reversal Candle (Hammer)
    DIP_CANDLES[59] = { c: 48500, v: 60000 }; // Vol Surge (3x), Green Close > low

    const result = generateV5Consensus(
        DIP_METRICS as any,
        DIP_CANDLES,
        { bids: [{ size: 50 }], asks: [{ size: 1 }] }, // Bid Wall
        { longShortRatio: 0.5, openInterestChange: 10, topTraderLsr: 2.0, longLiq: 5000, shortLiq: 100 } as any,
        { isBullish: true, isBearish: false, netFlow: 1000, whaleScore: 0.9 } as any,
        50000, // Max Pain Above (Magnet)
        -0.02
    );

    console.log(`Result: ${result.action} (Score: ${result.score.toFixed(2)})`);
    console.log(`Votes: V2=${result.votes.v2} V3=${result.votes.v3} V4=${result.votes.v4}`);
    console.log("Reasons:", result.reasons);

    if (result.action === 'BUY' && result.confidence > 70) console.log("✅ EXPECTED: Strong BUY Signal (Dip Bought)");
    else console.log("❌ UNEXPECTED: Signal too weak");
}

function testVeto() {
    console.log("\n🧪 TEST 3: The Veto (Risk Guard)");

    const BREAKOUT_METRICS = [{
        symbol: 'BTC-USD',
        price: 54000,
        priceChange24h: 6.0,
        volumeChange24h: 20,
        high24h: 54000,
        low24h: 48000,
        fundingRate: -0.02,
        open: 50000
    }];
    const BREAKOUT_CANDLES = Array(50).fill({ c: 50000, v: 5000 }).map((c, i) => ({ ...c, c: 50000 + (i * 200) }));

    const result = generateV5Consensus(
        BREAKOUT_METRICS as any,
        BREAKOUT_CANDLES,
        null,
        { longShortRatio: 2.5 } as any,
        { isBullish: false, isBearish: true, netFlow: -1000, whaleScore: 0.2 } as any, // BEARISH OnChain VETO
        45000,
        0.0001
    );

    console.log(`Result: ${result.action} (Score: ${result.score.toFixed(2)})`);
    console.log("Reasons:", result.reasons);

    if (result.reasons.some(r => r.includes("VETO") || r.includes("Bearish"))) console.log("✅ EXPECTED: VETO Triggered");
    else console.log("❌ UNEXPECTED: Veto Failed");
}

testBlindBacktest();
testPerfectStorm();
testVeto();
