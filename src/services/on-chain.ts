
// REAL ON-CHAIN DATA SERVICE
// Replaces on-chain-mock.ts — No more Math.random()!
// Sources: DeFiLlama (free) + CoinGlass NetFlow (included in $29/mo plan)

const DEFILLAMA_API = 'https://api.llama.fi';
const COINGLASS_API = 'https://open-api-v4.coinglass.com/api';

// Cache (5min TTL — on-chain data changes slowly)
const cache = new Map<string, { data: OnChainMetrics; ts: number }>();
const CACHE_TTL = 300_000; // 5 minutes

export interface OnChainMetrics {
    netFlow: number;       // Negative = Outflows (Bullish)
    whaleScore: number;    // 0.0 - 1.0 (High = Accumulation)
    tvlChange: number;     // 24h Change %
    btcInflow: number;     // Positive = Selling Pressure (Bearish)
    usdcInflow: number;    // Positive = Buying Power (Bullish)
    isBullish: boolean;    // Summary Flag
    isBearish: boolean;    // Summary Flag
}

function getApiKey(): string {
    return process.env.COINGLASS_API_KEY || '';
}

function neutralMetrics(): OnChainMetrics {
    return {
        netFlow: 0,
        whaleScore: 0.5,
        tvlChange: 0,
        btcInflow: 0,
        usdcInflow: 0,
        isBullish: false,
        isBearish: false
    };
}

// --- DeFiLlama: TVL Change ---
async function fetchTVLChange(): Promise<number> {
    try {
        // Get total DeFi TVL over last 2 days
        const res = await fetch(`${DEFILLAMA_API}/v2/historicalChainTvl`, { cache: 'no-store' });
        if (!res.ok) return 0;

        const data = await res.json();
        if (!Array.isArray(data) || data.length < 2) return 0;

        // Last two data points
        const latest = data[data.length - 1]?.tvl || 0;
        const previous = data[data.length - 2]?.tvl || 0;

        if (previous === 0) return 0;
        const change = ((latest - previous) / previous) * 100;

        console.log(`[ON-CHAIN] DeFi TVL: $${(latest / 1e9).toFixed(2)}B (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`);
        return change;
    } catch (err: any) {
        console.warn('[ON-CHAIN] DeFiLlama TVL fetch failed:', err.message);
        return 0;
    }
}

export async function fetchOnChainMetrics(symbol: string): Promise<OnChainMetrics> {
    // Check cache
    const cached = cache.get('global'); // On-chain data is global, not per-symbol
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.data;
    }

    // Fetch TVL (only real data source on current plan)
    const tvlChange = await fetchTVLChange();

    // TVL-based decision (exchange flows not available on Hobbyist plan)
    const result: OnChainMetrics = {
        netFlow: 0,
        whaleScore: 0.5, // Neutral — no exchange flow data available
        tvlChange,
        btcInflow: 0,
        usdcInflow: 0,
        isBullish: tvlChange > 1.0,    // DeFi growing significantly
        isBearish: tvlChange < -1.0    // DeFi TVL declining
    };

    // Only log on fresh fetch (cached results are silent)
    console.log(`[ON-CHAIN] TVL: ${tvlChange >= 0 ? '+' : ''}${tvlChange.toFixed(2)}% → ${result.isBullish ? '🟢 BULLISH' : result.isBearish ? '🔴 BEARISH' : '⚪ NEUTRAL'}`);

    cache.set('global', { data: result, ts: Date.now() });
    return result;
}
