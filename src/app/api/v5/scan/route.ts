
import { NextResponse } from 'next/server';
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import { generateV5Consensus } from '@/lib/v5/analysis-v5';
import { calculateMaxPain } from '@/services/deribit-api';

import { fetchHyperliquidAnalytics } from '@/services/hyperliquid-analytics'; // REAL ANALYTICS
// Removed: fetchCoinglassData, fetchOnChainMetrics (Mocks)

// Initialize SDK (Stateless per request, or cached? Next.js caches modules)
// For speed, we initialize once if possible, but safely inside handler
const pKey = process.env.HL_PRIVATE_KEY!;
// Note: In Next.js Edge/Serverless, global vars might reset. Wallet creation is cheap.
const wallet = pKey ? new Wallet(pKey) : Wallet.createRandom(); // Read-only scan doesn't need real money wallet, but SDK might check checks
const sdk = new Hyperliquid(wallet);

// SIMPLE CACHE (Global Scope in Module)
// NOTE: "Global" vars in Next.js dev mode might reset on recompilation.
// In prod, they persist across warm lambda invocations.
let metaCache: { data: any, timestamp: number } | null = null;
let resultCache: { data: any, timestamp: number } | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 Minutes (Strong Caching for Universe)
const RESULT_TTL = 30 * 1000;    // 30s Result Cache (Relieve Rate Limits)

// LOCKING
let isScanning = false;

// HELPER: Retry Wrapper
async function fetchCandlesWithRetry(coin: string, attempt = 1): Promise<any> {
    try {
        return await sdk.info.getCandleSnapshot(coin, '15m', Date.now() - 24 * 60 * 60 * 1000, Date.now());
    } catch (e: any) {
        if (attempt <= 4 && (String(e).includes('429') || e?.code === 429)) {
            // Exponential Backoff: 1s, 2s, 4s, 8s
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.warn(`⚠️ Rate Limit (Candles ${coin}). Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return fetchCandlesWithRetry(coin, attempt + 1);
        }
        // Fallback: Return empty candles instead of crashing scan?
        console.warn(`❌ Failed to fetch candles for ${coin} after ${attempt} attempts.`);
        return [];
    }
}

export async function GET() {
    try {
        // console.log("🦅 API: V5 Consensus Scan Request...");

        // 0. CHECK RESULT CACHE
        if (resultCache && (Date.now() - resultCache.timestamp < RESULT_TTL)) {
            // console.log("   Serving Cached Results (Debounce).");
            return NextResponse.json(resultCache.data);
        }

        // 0.5 LOCKING (Prevent Overlap)
        if (isScanning) {
            console.log("   Scan In-Progress. Returning Stale/Empty.");
            if (resultCache) return NextResponse.json({ ...resultCache.data, loading: true });
            return NextResponse.json({ success: true, signals: [], status: "scanning" });
        }

        isScanning = true;
        console.log("   Build: Starting Fresh Scan (Live Price)...");

        try {
            // 1. Asset Rotation (Top Volume) - WITH ROBUST CACHE & FALLBACK
            let metaAndCtx;
            const now = Date.now();

            // Check Freshness
            if (metaCache && (now - metaCache.timestamp < CACHE_TTL)) {
                metaAndCtx = metaCache.data;
            } else {
                try {
                    // Try Fetching New Data
                    metaAndCtx = await sdk.info.perpetuals.getMetaAndAssetCtxs();
                    metaCache = { data: metaAndCtx, timestamp: now };
                    console.log("   [META] Updated Universe Cache");
                } catch (metaError: any) {
                    // Handle 429 EXPLICITLY: Use Stale Cache if available
                    if ((String(metaError).includes('429') || metaError?.code === 429)) {
                        if (metaCache) {
                            console.warn("   ⚠️ [META] Rate Limit. Serving STALE Universe Cache.");
                            metaAndCtx = metaCache.data;
                            // Extend timestamp slightly to avoid hammering in a loop
                            metaCache.timestamp = now;
                        } else {
                            console.warn("   ⚠️ [META] Rate Limit on Cold Start. Backing off.");
                            isScanning = false;
                            return NextResponse.json({ success: true, signals: [], status: "rate_limited_startup", warning: "Cold Start Rate Limit" });
                        }
                    } else {
                        throw metaError;
                    }
                }
            }

            const universe = metaAndCtx[0].universe;
            const context = metaAndCtx[1];

            // Filter Top 10 Liquid Assets
            const assets = universe
                .map((u: any, index: number) => ({ universe: u, ctx: context[index], coin: u.name }))
                .map((item: any) => ({
                    ...item,
                    vol: parseFloat(item.ctx.dayNtlVlm)
                }))
                .sort((a: any, b: any) => b.vol - a.vol)
                .slice(0, 10);

            // 2. Sequential Processing 
            const results = [];

            for (const item of assets) {
                const { coin, ctx } = item;

                try {
                    // Fetch Candles with Retry
                    const candles = await fetchCandlesWithRetry(coin);

                    const [maxPain, hlAnalytics] = await Promise.all([
                        calculateMaxPain(coin).catch(() => 0),
                        fetchHyperliquidAnalytics(coin).catch(() => ({ whaleScore: 0.5, netFlow: 0, volatility: 0, bidAskImbalance: 0 }))
                    ]);

                    // SYNTHETIC COINGLASS (Derived from Real HL Data)
                    // Logic: Positive Funding = Longs Paying Shorts (Bullish Leverage). 
                    // However, extremely high funding often signals top.
                    // Here we map Funding to Sentiment Ratio.
                    const funding = parseFloat(ctx.funding);
                    // Standard Base: 1.0. 
                    // If Funding is 0.01% (0.0001) -> Ratio 1.1 (+10% Bullish)
                    // If Funding is -0.01% -> Ratio 0.9
                    const impliedLsr = 1 + (funding * 1000);

                    const syntheticCoinglass = {
                        longShortRatio: impliedLsr,
                        openInterestChange: 0, // Needs DB history to track real delta
                        topTraderLsr: impliedLsr, // Proxy
                        longLiq: 0, // Requires Liquidation Listeners
                        shortLiq: 0,
                        oiChangePercent: 0
                    };

                    // REAL ON-CHAIN (Derived from L2 Book & Tape)
                    const realOnChain = {
                        isBullish: hlAnalytics.whaleScore > 0.6 && hlAnalytics.netFlow > 0,
                        isBearish: hlAnalytics.whaleScore < 0.4 && hlAnalytics.netFlow < 0,
                        netFlow: hlAnalytics.netFlow,
                        whaleScore: hlAnalytics.whaleScore,
                        tvlChange: 0,
                        btcInflow: 0,
                        usdcInflow: 0
                    };

                    // Format
                    const formattedCandles = candles.map((c: any) => ({ c: parseFloat(c.c), v: parseFloat(c.v) }));
                    const currentPrice = parseFloat(ctx.markPx);

                    const metrics = [{
                        symbol: coin + "USDT",
                        price: currentPrice,
                        priceChange24h: (parseFloat(ctx.markPx) - parseFloat(ctx.prevDayPx)) / parseFloat(ctx.prevDayPx) * 100,
                        volumeChange24h: 0,
                        high24h: parseFloat(ctx.prevDayPx) * 1.05,
                        low24h: parseFloat(ctx.prevDayPx) * 0.95,
                        fundingRate: parseFloat(ctx.funding),
                        open: parseFloat(ctx.prevDayPx)
                    }];

                    if (formattedCandles.length > 0) {
                        const prices = formattedCandles.map((c: any) => c.c);
                        metrics[0].high24h = Math.max(...prices);
                        metrics[0].low24h = Math.min(...prices);
                    }

                    // Run V5
                    const consensus = generateV5Consensus(
                        metrics as any,
                        formattedCandles,
                        null,
                        syntheticCoinglass,
                        realOnChain,
                        maxPain,
                        parseFloat(ctx.funding)
                    );

                    results.push({
                        symbol: coin + "USDT",
                        ...consensus,
                        price: currentPrice
                    });

                    // DELAY 1s (Increased from 500ms for safety)
                    await new Promise(r => setTimeout(r, 1000));

                } catch (err) {
                    console.warn(`Skipping ${coin} (API Error).`);
                }
            }

            // Filter
            const signals = results.filter(r => Math.abs(r.score) > 0.1);

            const responsePayload = {
                success: true,
                timestamp: Date.now(),
                signals: signals,
                consensus: signals.length > 0 ? signals[0] : null
            };

            resultCache = { data: responsePayload, timestamp: Date.now() };
            isScanning = false; // RELEASE LOCK

            return NextResponse.json(responsePayload);

        } catch (innerError) {
            isScanning = false; // RELEASE LOCK
            throw innerError;
        }

    } catch (e: any) {
        // Return Cached Result on Error (Fallback) if available
        if (resultCache) {
            console.warn("⚠️ Scan Failed, Serving Stale Cache:", e.message);
            return NextResponse.json({ ...resultCache.data, stale: true });
        }
        console.error("V5 Scan Error:", e);
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
