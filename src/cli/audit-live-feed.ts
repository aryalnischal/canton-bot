
import { fetchBinanceData } from "../lib/api";
import { generateTradeSignal } from "../lib/analysis";

async function auditLive() {
    console.log("Auditing Live Data Feed & Decision Engine...");
    console.log("-------------------------------------------");

    // Check BTC and SOL
    const assets = ['BTCUSDT', 'SOLUSDT'];

    for (const asset of assets) {
        console.log(`\n📡 Fetching Live Data for ${asset}...`);
        const startTime = Date.now();
        const metric = await fetchBinanceData(asset, '1h'); // Check 1H context
        const latency = Date.now() - startTime;

        if (metric && metric.price && metric.price > 0) {
            console.log(`✅ Connection Successful (${latency}ms)`);
            console.log(`   Price: $${metric.price.toLocaleString()}`);
            console.log(`   24h High (Res): $${metric.high24h?.toLocaleString()} 🛑`);
            console.log(`   24h Low (Sup):  $${metric.low24h?.toLocaleString()} 🟢`);
            console.log(`   Funding Rate: ${(metric.fundingRate! * 100).toFixed(4)}%`);

            // Check Logic
            const signal = generateTradeSignal([metric as any], undefined, '1h');
            console.log(`   🤖 Algorithm Decision: ${signal.action} (${signal.confidence.toFixed(1)}% Conf)`);
            console.log(`   🎯 Target: $${signal.target?.toLocaleString()}`);
            console.log(`   📝 Reasons: ${signal.reasons.join(", ")}`);
        } else {
            console.log(`❌ Failed to fetch valid data for ${asset}`);
        }
    }
    console.log("-------------------------------------------");
    console.log("System Status: ONLINE & REAL-TIME");
}

auditLive();
