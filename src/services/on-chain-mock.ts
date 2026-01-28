
// MOCK ON-CHAIN DATA SERVICE (The "Big Picture" Radar)
// Simulates Glassnode / CryptoQuant / DeFiLlama metrics

export interface OnChainMetrics {
    netFlow: number;       // Negative = Outflows (Bullish)
    whaleScore: number;    // 0.0 - 1.0 (High = Accumulation)
    tvlChange: number;     // 24h Change %
    btcInflow: number;     // Positive = Selling Pressure (Bearish)
    usdcInflow: number;    // Positive = Buying Power (Bullish)
    isBullish: boolean;    // Summary Flag
    isBearish: boolean;    // Summary Flag
}

export async function fetchOnChainMetrics(symbol: string): Promise<OnChainMetrics> {
    // Latency sim
    await new Promise(r => setTimeout(r, 50));

    // GENERATE REALISTIC DATA (Randomized for Prototype)
    // -----------------------

    // 1. Exchange Net Flow (USD)
    // Range: -500M to +500M
    const netFlow = (Math.random() * 1_000_000_000) - 500_000_000;

    // 2. Whale Trend Score
    // Range: 0.1 to 0.9
    const whaleScore = 0.1 + (Math.random() * 0.8);

    // 3. DeFi TVL Change
    // Range: -5% to +5%
    const tvlChange = (Math.random() * 10) - 5;

    // 4. BTC Exchange Flows (New Python Logic)
    // Positive = BTC moving TO exchanges (Selling Risk)
    // Range: -2000 BTC to +2000 BTC
    const btcInflow = (Math.random() * 4000) - 2000;

    // 5. USDC Exchange Flows (New Python Logic)
    // Positive = USDC moving TO exchanges (Buying Power)
    // Range: -500M to +500M
    const usdcInflow = (Math.random() * 1_000_000_000) - 500_000_000;


    // DECISION LOGIC (The "Gatekeeper")
    // --------------------------------
    let bullScore = 0;
    let bearScore = 0;

    // Bullish Signals
    if (netFlow < -50_000_000) bullScore++; // Outflows (HODLing)
    if (whaleScore > 0.7) bullScore++;      // Whales Buying
    if (tvlChange > 0.5) bullScore++;       // DeFi Growing
    if (usdcInflow > 100_000_000) bullScore++; // Stablecoin Print

    // Bearish Signals
    if (netFlow > 50_000_000) bearScore++; // Inflows (Dumping)
    if (whaleScore < 0.3) bearScore++;     // Whales Selling
    if (btcInflow > 500) bearScore++;      // BTC to Exchange (Dump Risk)

    return {
        netFlow,
        whaleScore,
        tvlChange,
        btcInflow,
        usdcInflow,
        isBullish: bullScore >= 2 && bearScore < 2,
        isBearish: bearScore >= 2 && bullScore < 2
    };
}
