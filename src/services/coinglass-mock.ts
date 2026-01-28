
// MOCK COINGLASS SERVICE
// Returns simulated Liquidation and Open Interest Data for V4 Research

export interface CoinglassData {
    longLiq: number;       // USD Value
    shortLiq: number;      // USD Value
    oiChangePercent: number; // 24h Change
    longShortRatio: number;
}

export async function fetchCoinglassData(symbol: string): Promise<CoinglassData> {
    // Simulate Network Latency
    await new Promise(r => setTimeout(r, 100));

    // Generate Randomized realistic data
    // In a real scenario, this would hit https://open-api-v4.coinglass.com/api/futures

    // Bias: Randomly bullish or bearish
    const isBullish = Math.random() > 0.5;

    const longLiq = isBullish ? Math.random() * 1_000_000 : Math.random() * 10_000_000; // Bearish = High Long Liqs
    const shortLiq = isBullish ? Math.random() * 10_000_000 : Math.random() * 1_000_000;

    const oiChange = (Math.random() * 10) - 5; // -5% to +5%

    return {
        longLiq,
        shortLiq,
        oiChangePercent: oiChange,
        longShortRatio: isBullish ? 1.5 + Math.random() : 0.5 + Math.random()
    };
}
