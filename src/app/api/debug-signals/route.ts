
import { NextResponse } from 'next/server';
import { fetchBinanceData } from '../../../lib/api';
import { generateTradeSignal } from '../../../lib/analysis';

export async function GET() {
    try {
        const assets = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT", "DOGEUSDT"];
        const results = [];

        console.log("🔍 RUNNING SIGNAL DIAGNOSTIC V2...");

        for (const symbol of assets) {
            // Fetch Real Data
            const metric = await fetchBinanceData(symbol, "15m");

            // Run Logic
            // Note: We use 'SAFE' mode as per default config
            const signal = generateTradeSignal([metric as any], undefined, "15m");

            results.push({
                symbol,
                price: metric.price,
                change24h: metric.priceChange24h?.toFixed(2) + "%",
                volChange: metric.volumeChange24h?.toFixed(2) + "%",
                score: signal.score, // Introspection
                action: signal.action,
                reasons: signal.reasons
            });
        }

        return NextResponse.json({ success: true, timestamp: new Date().toISOString(), analysis: results });

    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
