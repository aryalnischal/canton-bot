import { ManualAnalysisData } from "./analysis";

export interface MarketScenario {
    name: string;
    description: string;
    data: ManualAnalysisData;
    expectedResult: string;
    duration: string; // e.g. "4h", "2d"
}

export const HISTORICAL_SCENARIOS: MarketScenario[] = [
    {
        name: "BTC All-Time High Flush (Nov '21)",
        description: "Price making huge moves, massive funding, then OI drops.",
        expectedResult: "SELL",
        duration: "6h", // Intraday flush
        data: {
            manualPrice: 69000,
            manualFunding: 0.05,
            liqResistancePrice: 70000,
            liqSupportPrice: 60000,
            liqResistanceVol: 1000000,
            liqSupportVol: 5000000,
        }
    },
    {
        name: "ETH Merge Dump (Sept '22)",
        description: "Buy the rumor, sell the news. High OI, negative price action.",
        expectedResult: "SELL",
        duration: "2d", // Multi-day unwind
        data: {
            manualPrice: 1780,
            manualFunding: 0.02,
            liqResistancePrice: 2000,
            liqSupportPrice: 1500,
            liqResistanceVol: 200000,
            liqSupportVol: 800000,
        }
    },
    {
        name: "SOL Reversal Pump (Jan '23)",
        description: "Price stabilized, funding negative (shorts paying), big resistance above.",
        expectedResult: "BUY",
        duration: "12h", // Strong bounce
        data: {
            manualPrice: 9.80,
            manualFunding: -0.03,
            liqResistancePrice: 14.50,
            liqSupportPrice: 8.00,
            liqResistanceVol: 5000000,
            liqSupportVol: 100000,
        }
    },
    {
        name: "SLOW BLEED (Swing)",
        description: "Multi-day grind down. Funding negative but price not bouncing.",
        expectedResult: "SELL",
        duration: "5d", // Swing trade
        data: {
            manualPrice: 0.45,
            manualChange: -5.5,
            manualFunding: -0.005,
            liqResistancePrice: 0.60,
            liqSupportPrice: 0.40,
            liqResistanceVol: 200000,
            liqSupportVol: 8000000,
            strategy: 'SWING'
        }
    },
    {
        name: "DOGE Memecoin Rush (Scalp)",
        description: "Massive volume spike, funding flying positive, price lagging.",
        expectedResult: "SELL",
        duration: "2h", // Quick scalp
        data: {
            manualPrice: 0.15,
            manualChange: 15.0,
            manualFunding: 0.15,
            liqResistancePrice: 0.16,
            liqSupportPrice: 0.12,
            liqResistanceVol: 2000000,
            liqSupportVol: 500000,
            strategy: 'SCALP'
        }
    }
];
