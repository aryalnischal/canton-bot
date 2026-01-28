
import { AIDataCollector } from './src/lib/ai-data-collector.ts';

async function test() {
    console.log("🧪 TESTING AI DATA COLLECTOR...");

    const dummyTrade = {
        id: "TEST-123",
        symbol: "BTC",
        action: "BUY" as const
    };

    const dummyFeatures = {
        rsi: 30,
        trend_slope: 2.5,
        volatility: 0.05,
        funding_rate: 0.0001,
        volume_surge: true,
        distance_from_sma: -0.02
    };

    // 1. Log Attempt
    AIDataCollector.logTradeAttempt(dummyTrade, dummyFeatures);

    // 2. Log Result
    AIDataCollector.labelTrade("TEST-123", { pnlPercent: 5.0 });

    console.log("✅ Check ai_trade_history.json content.");
}

test();
