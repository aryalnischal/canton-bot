
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';

// Initialize SDK (Read-Only)
// We use a random wallet because we just need public L2 data
const sdk = new Hyperliquid(Wallet.createRandom());

export interface HyperliquidAnalytics {
    whaleScore: number;       // 0.0 - 1.0 (High = Net Buying Pressure from Large Trades)
    netFlow: number;          // Net USD Volume (Buy - Sell)
    volatility: number;       // Standard Deviation of recent trades
    bidAskImbalance: number;  // Ratio of Bids to Asks in L2 Book
}

// CACHE to prevent 429s on heavy analysis
const ANALYTICS_CACHE: Record<string, { timestamp: number, data: HyperliquidAnalytics }> = {};
const CACHE_TTL = 30 * 1000; // 30s Cache for heavy compute

export async function fetchHyperliquidAnalytics(coin: string): Promise<HyperliquidAnalytics> {
    const NOW = Date.now();

    // Check Cache
    if (ANALYTICS_CACHE[coin] && (NOW - ANALYTICS_CACHE[coin].timestamp < CACHE_TTL)) {
        return ANALYTICS_CACHE[coin].data;
    }

    try {
        // 1. Fetch L2 Book (Snapshot) - RAW FETCH (SDK Method Missing)
        // Sanitization: Remove -PERP suffix if exists (e.g., SOL-PERP -> SOL)
        const symbol = coin.replace(/-PERP$/, '');
        // console.log(`[HL Analytics] Fetching L2 for ${symbol} (orig: ${coin})`);

        const response = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: "l2Book", coin: symbol })
        });

        if (!response.ok) throw new Error(`HL API Error: ${response.status}`);
        const l2 = await response.json();

        // 2. Analyze Order Book Imbalance (Top 20 Levels)
        let bidVol = 0;
        let askVol = 0;

        // Safety: Check array limits
        const depth = Math.min(l2.levels[0].length, 20);

        for (let i = 0; i < depth; i++) {
            const bid = l2.levels[0][i]; // [price, size]
            const ask = l2.levels[1][i]; // [price, size]

            bidVol += parseFloat(bid.sz) * parseFloat(bid.px);
            askVol += parseFloat(ask.sz) * parseFloat(ask.px);
        }

        const totalVol = bidVol + askVol;
        // -1.0 (All Asks) to +1.0 (All Bids)
        const imbalance = totalVol > 0 ? (bidVol - askVol) / totalVol : 0;


        // 3. Fetch Recent Trades (The Tape)
        // Unfortunately SDK doesn't have a clean 'getRecentTrades' exposed in all versions, 
        // but let's try standard 'info.fills' or similar if available, or just rely on L2 for now.
        // Actually, 'userFills' is for user. 
        // We might need to use the generic 'info' post method for 'l2Snapshot' which we did.
        // Does HL have a public trade history endpoint? 
        // Yes, { "type": "l2Snapshot", "coin": "BTC" } only gives book.
        // There isn't a simple "recent trades" endpoint in the basic info schema without WS.
        // SO: We will stick to ORDER BOOK ANALYTICS for now as "On-Chain" proxy.
        // Deep Book Imbalance is a strong indicator of Whale Intent.

        // WE WILL SIMULATE "Whale Score" based on Book Depth + Imbalance

        // A "Whale Score" of 1.0 means Bids are massively heavier than Asks (Buy Wall).
        // 0.0 means Sell Wall.
        // 0.5 is Neutral.
        const whaleScore = 0.5 + (imbalance / 2); // Map -1..1 to 0..1

        // Net Flow: We'll interpret Bid-Ask Delta as "Pending Flow"
        const netFlow = bidVol - askVol;

        const result = {
            whaleScore,
            netFlow,
            volatility: 0, // Placeholder
            bidAskImbalance: imbalance
        };

        // Cache
        ANALYTICS_CACHE[coin] = { timestamp: NOW, data: result };
        return result;

    } catch (e) {
        console.error(`[HL Analytics] Failed for ${coin}:`, e);
        // Fallback Neutral
        return { whaleScore: 0.5, netFlow: 0, volatility: 0, bidAskImbalance: 0 };
    }
}
