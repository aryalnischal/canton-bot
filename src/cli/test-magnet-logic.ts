
import { generateTradeSignal, ManualAnalysisData } from "../lib/analysis";
import { ExchangeMetric } from "../lib/types";

function runTest() {
    console.log("Testing Liquidation Magnet Logic...");
    console.log("-----------------------------------");

    // Mock Metric (BTC at 95k)
    const mockMetric = {
        pair: 'BTC/USDT',
        price: 95000,
        priceChange24h: -1.5, // Automated Trend Down
        volume24h: 10000,
        fundingRate: 0.001,
        openInterest: 500000,
        exchange: 'Binance',
        rank: 1,
        volumeChange24h: 0,
        openInterestChange24h: 0,
        longShortRatio: 1,
        longLiq24h: 0,
        shortLiq24h: 0,
        high24h: 96000,
        low24h: 94000
    } as ExchangeMetric;

    // Scenario 1: Magnet Active (Bearish)
    // User sees Liquidation at 93k. Price is dumping.
    const input1: ManualAnalysisData = {
        liqSupportPrice: 93000, // Target
        manualPrice: 94000,     // Current Price closer to target
        manualChange: -2.0,     // Strong Momentum Down
    };

    const signal1 = generateTradeSignal([mockMetric], input1, '15m');
    console.log(`\nTest Case 1: Bearish Magnet (Target 93k)`);
    console.log(`Action: ${signal1.action}`);
    console.log(`Target: $${signal1.target}`); // Should be 93000
    console.log(`Confidence: ${signal1.confidence.toFixed(1)}%`);
    console.log(`Reasons:`, signal1.reasons);

    if (signal1.target === 93000 && signal1.action === 'SELL' && signal1.reasons.some(r => r.includes("MAGNET"))) {
        console.log("✅ PASS: Bearish Magnet detected correctly.");
    } else {
        console.log("❌ FAIL: Bearish Magnet logic invalid.");
    }

    // Scenario 2: No Magnet (Trend Opposing Target) in range
    // User wants short to 93k, but price is pumping +2%
    const input2: ManualAnalysisData = {
        liqSupportPrice: 93000,
        manualChange: 2.0, // Momentum UP
    };

    const signal2 = generateTradeSignal([mockMetric], input2, '15m');
    console.log(`\nTest Case 2: Invalid Magnet (Counter-Trend)`);
    console.log(`Action: ${signal2.action}`);
    console.log(`Reasons:`, signal2.reasons);

    if (!signal2.reasons.some(r => r.includes("MAGNET"))) {
        console.log("✅ PASS: Magnet ignored when trend opposes direction.");
    } else {
        console.log("❌ FAIL: Magnet triggered incorrectly against trend.");
    }
}

runTest();
