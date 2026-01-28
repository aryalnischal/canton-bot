
import { generateTradeSignal, TradeSignal, ManualAnalysisData } from '../lib/analysis';

// Mock Data Interfaces
interface PricePoint {
    price: number;
    high24h: number;
    low24h: number;
    time: number;
}

// 1. SCENARIO A: High Volatility Chop (Range 10%)
const generateHighVolChop = (): PricePoint[] => {
    const points: PricePoint[] = [];
    let price = 100;
    for (let i = 0; i < 20; i++) {
        price = i % 2 === 0 ? 105 : 95;
        points.push({ price, high24h: 105, low24h: 95, time: i });
    }
    return points;
};

// 2. SCENARIO B: Compression + Breakout
// Price stays tight (100-101), then rips to 110.
const generateBreakout = (): PricePoint[] => {
    const points: PricePoint[] = [];
    for (let i = 0; i < 10; i++) {
        points.push({ price: 100 + (Math.random()), high24h: 101, low24h: 100, time: i });
    }
    points.push({ price: 102, high24h: 101, low24h: 100, time: 10 }); // Break
    points.push({ price: 105, high24h: 102, low24h: 100, time: 11 }); // Pump
    points.push({ price: 110, high24h: 105, low24h: 100, time: 12 }); // Moon
    return points;
};

async function runSimulation() {
    console.log("🚀 STARTING HEURISTIC ISOLATION TEST...\n");

    const highVolData = generateHighVolChop();
    const breakoutData = generateBreakout();

    let chopTrades = 0;
    let chopPnL = 0;

    let breakoutTrades = 0;
    let breakoutPnL = 0;

    // SIMULATION 1: HIGH VOLATILITY CHOP
    console.log("🌊 SCENARIO 1: High Volatility Chop (Range 10%)");
    for (let i = 1; i < highVolData.length; i++) {
        const cur = highVolData[i];
        const prev = highVolData[i - 1];
        const change = ((cur.price - prev.price) / prev.price) * 100;

        // Corrected Call Signature: [metric], manual, timeframe, risk
        const analysis: TradeSignal = generateTradeSignal(
            [{ ...cur, priceChange24h: change, marketType: 'FUTURES', fundingRate: 0.01, openInterest: 0, volume24h: 0, pair: 'BTC/USDT', exchange: 'SIM', rank: 1, volumeChange24h: 0, openInterestChange24h: 0, longShortRatio: 1, longLiq24h: 0, shortLiq24h: 0 } as any],
            undefined,
            '15m',
            'AGGRESSIVE'
        );

        if (analysis.action !== 'NEUTRAL') {
            console.log(`Tick ${i}: Price ${cur.price} | Signal: ${analysis.action} | Reasons: ${analysis.reasons[0]}`);
            chopTrades++;
            chopPnL -= 50;
        }
    }

    // SIMULATION 2: COMPRESSION BREAKOUT
    console.log("\n💥 SCENARIO 2: Compression Breakout (Range 1%)");
    for (let i = 1; i < breakoutData.length; i++) {
        const cur = breakoutData[i];
        const prev = breakoutData[i - 1];
        const change = ((cur.price - prev.price) / prev.price) * 100;

        const analysis: TradeSignal = generateTradeSignal(
            [{ ...cur, priceChange24h: change, marketType: 'FUTURES', fundingRate: 0.01, openInterest: 0, volume24h: 0, pair: 'BTC/USDT', exchange: 'SIM', rank: 1, volumeChange24h: 0, openInterestChange24h: 0, longShortRatio: 1, longLiq24h: 0, shortLiq24h: 0 } as any],
            undefined,
            '15m',
            'AGGRESSIVE'
        );

        if (analysis.action === 'BUY' && cur.price >= 102) {
            console.log(`Tick ${i}: Price ${cur.price} | Signal: ${analysis.action} | Reasons: ${analysis.reasons[0]}`);
            breakoutTrades++;
            breakoutPnL += 200;
        }
    }

    console.log("\n📊 FINAL RESULTS (With Heuristic ML)");
    console.log("====================================");
    console.log(`🛡️  Chop Survival: ${chopTrades === 0 ? "PERFECT (0 Trades)" : `${chopTrades} Whipsaws ($${chopPnL})`}`);
    console.log(`🚀 Breakout Catch: ${breakoutTrades > 0 ? "SUCCESS" : "MISSED"}`);

    if (chopTrades === 0 && breakoutTrades > 0) {
        console.log("\n✅ CONCLUSION: ML Scaling Successfully Filtered Chop & Caught Pump.");
    } else {
        console.log("\n⚠️ CONCLUSION: Tuning Needed.");
    }
}

runSimulation();
