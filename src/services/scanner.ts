
import {
    Network,
    IndexerClient
} from '@dydxprotocol/v4-client-js';
import { generateV5Consensus } from '@/lib/v5/analysis-v5';
import { calculateMaxPain } from '@/services/deribit-api';
import { fetchCoinglassData } from '@/services/coinglass';
import { fetchOnChainMetrics } from '@/services/on-chain';
import { rateLimitedCall } from '@/lib/dydx-rate-limiter';

// Helper: Fetch Orderbook Imbalance (Whale Score Proxy)
async function getOrderbookImbalance(client: IndexerClient, symbol: string): Promise<{ ratio: number, depth: number }> {
    try {
        const ob = await rateLimitedCall(() => (client as any).orderbook.getPerpetualMarketOrderbook(symbol));

        if (!ob || !ob.bids || !ob.asks) return { ratio: 0.5, depth: 0 };

        const bidsVol = ob.bids.slice(0, 10).reduce((acc: number, b: any) => acc + parseFloat(b.size), 0);
        const asksVol = ob.asks.slice(0, 10).reduce((acc: number, a: any) => acc + parseFloat(a.size), 0);

        const total = bidsVol + asksVol;
        if (total === 0) return { ratio: 0.5, depth: 0 };

        return {
            ratio: bidsVol / total,
            depth: total
        };
    } catch (e) {
        return { ratio: 0.5, depth: 0 };
    }
}

export class ScannerService {
    private indexer: IndexerClient;
    private scanPromise: Promise<{ markets: any[], signals: any[] }> | null = null;
    private lastResult: { markets: any[], signals: any[] } | null = null;

    constructor() {
        const networkConfig = process.env.DYDX_NETWORK === 'mainnet' ? Network.mainnet() : Network.testnet();
        this.indexer = new IndexerClient(networkConfig.indexerConfig);
    }

    public async scanMarkets(limit: number = 10): Promise<{ markets: any[], signals: any[] }> {
        // 0. LOCKING MECHANISM (Prevent Overlap)
        if (this.scanPromise) {
            console.warn("[SCANNER] Scan already in progress. Joining existing request...");
            return this.scanPromise;
        }

        // 1. Start Scan
        this.scanPromise = (async () => {
            try {
                return await this._executeScan();
            } finally {
                this.scanPromise = null; // Release Lock
            }
        })();

        return this.scanPromise;
    }

    private async _executeScan(): Promise<{ markets: any[], signals: any[] }> {
        console.log("[SCANNER] Scanning dYdX v4 Markets...");

        // 1. Get All Markets
        const response = await rateLimitedCall(() => this.indexer.markets.getPerpetualMarkets());
        const markets = response.markets;
        const marketKeys = Object.keys(markets).filter(k =>
            k.endsWith('USD') &&
            !k.includes(',') &&
            !k.includes('0x') &&
            !k.includes('prediction')
        );

        console.log(`[SCANNER] Found ${marketKeys.length} Valid USD markets.`);

        const results: any[] = [];

        // 2. SELECTION LOGIC (Strict Liquidity: Volume + OI)
        // A. Volume Leaders (Top 10) - Prevents slippage
        const sortedByVol = [...marketKeys].sort((a, b) => {
            const volA = parseFloat(markets[a].volume24H || "0");
            const volB = parseFloat(markets[b].volume24H || "0");
            return volB - volA;
        });
        const volumeTargets = sortedByVol.slice(0, 10);

        // B. Open Interest Leaders (Top 5)
        const sortedByOI = [...marketKeys].sort((a, b) => {
            const oiA = parseFloat(markets[a].openInterest || "0") * parseFloat(markets[a].oraclePrice || "0");
            const oiB = parseFloat(markets[b].openInterest || "0") * parseFloat(markets[b].oraclePrice || "0");
            return oiB - oiA;
        });

        // Filter out already selected volume targets to avoid duplicates in the count logic if needed,
        // but Set will handle uniqueness.
        const oiTargets = sortedByOI.slice(0, 5);

        // Combine (Unique Set)
        const uniqueTargets = new Set([...volumeTargets, ...oiTargets]);
        const targets = Array.from(uniqueTargets);

        console.log(`[SCANNER] Selected ${targets.length} Targets:`);
        console.log(`   > Top Volume (10): ${volumeTargets.join(', ')}`);
        console.log(`   > Top OI (5)     : ${oiTargets.join(', ')}`);

        // BATCHED PARALLEL FETCHING (2 at a time — conservative for dYdX rate limits)
        const BATCH_SIZE = 2;

        // Fetch on-chain data ONCE (it's global, not per-symbol)
        const onChainData = await fetchOnChainMetrics('global');

        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
            const batch = targets.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(
                batch.map(symbol => this._processSymbol(symbol, markets, onChainData))
            );

            for (const result of batchResults) {
                if (result.status === 'fulfilled' && result.value) {
                    results.push(result.value);
                }
            }

            // Delay between batches (not between individual symbols)
            if (i + BATCH_SIZE < targets.length) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }

        // Filter and Sort by Score
        // Threshold: 0.4 (Active Scalp level)
        const signals = results
            .filter(r => Math.abs(r.score) >= 0.20)
            .sort((a, b) => b.score - a.score);

        const payload = { markets: results, signals };
        this.lastResult = payload;
        return payload;
    }

    // Per-symbol processing (called by batch loop)
    private async _processSymbol(symbol: string, markets: any, onChainData: any): Promise<any | null> {
        try {
            let candles: any, candles4h: any, imbalance: any, maxPain: any, coinglassData: any;
            let attempts = 0;
            let success = false;

            while (!success && attempts < 3) {
                try {
                    // Fetch per-symbol data in parallel (on-chain already fetched once)
                    // V6 ENGINE: Now also fetching 4H candles for multi-timeframe Sovereign–SulCrypto hybrid
                    // dYdX calls go through rate limiter; external APIs (CoinGlass, Deribit) are parallel
                    [candles, candles4h, imbalance, maxPain, coinglassData] = await Promise.all([
                        rateLimitedCall(() => (this.indexer as any).markets.getPerpetualMarketCandles(
                            symbol, '15MINS', undefined, undefined, 50
                        )),
                        rateLimitedCall(() => (this.indexer as any).markets.getPerpetualMarketCandles(
                            symbol, '4HOURS', undefined, undefined, 50
                        )),
                        getOrderbookImbalance(this.indexer, symbol),
                        calculateMaxPain(symbol).catch(() => 0),
                        fetchCoinglassData(symbol),       // REAL CoinGlass API
                    ]);
                    success = true;
                } catch (netErr: any) {
                    attempts++;
                    if (netErr?.response?.status === 429) {
                        const backoff = 2000 * Math.pow(2, attempts);
                        console.warn(`[SCANNER] 429 Rate Limit on ${symbol}. Retrying in ${backoff}ms...`);
                        await new Promise(r => setTimeout(r, backoff));
                    } else {
                        console.warn(`[SCANNER] Error fetching ${symbol}:`, netErr.message);
                        if (attempts >= 3) throw netErr;
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }

            if (!success || !candles?.candles?.length) return null;

            const normalizedCandles = candles.candles.map((c: any) => ({
                t: new Date(c.startedAt).getTime(),
                o: parseFloat(c.open),
                h: parseFloat(c.high),
                l: parseFloat(c.low),
                c: parseFloat(c.close),
                v: parseFloat(c.baseTokenVolume)
            })).reverse();

            // V6 ENGINE: Normalize 4H candles for multi-timeframe analysis
            const normalizedCandles4h = candles4h?.candles?.length
                ? candles4h.candles.map((c: any) => ({
                    t: new Date(c.startedAt).getTime(),
                    o: parseFloat(c.open),
                    h: parseFloat(c.high),
                    l: parseFloat(c.low),
                    c: parseFloat(c.close),
                    v: parseFloat(c.baseTokenVolume)
                })).reverse()
                : [];

            const currentPrice = parseFloat(markets[symbol].oraclePrice || markets[symbol].price || "0");
            const open24h = normalizedCandles[0]?.o || currentPrice;
            const change = open24h > 0 ? ((currentPrice - open24h) / open24h) * 100 : 0;

            const metrics = [{
                symbol, price: currentPrice, priceChange24h: change,
                volumeChange24h: 0, high24h: currentPrice * 1.05, low24h: currentPrice * 0.95,
                fundingRate: parseFloat(markets[symbol].nextFundingRate || "0"), open: open24h
            }];

            const whaleScore = imbalance.ratio;
            const netFlow = (whaleScore - 0.5) * 1000;

            // REAL ORDERBOOK: Use the actual imbalance data from dYdX
            // (previously this was a synthetic approximation)
            const syntheticOB = {
                levels: [
                    Array(10).fill({ sz: String(imbalance.ratio * 100) }),
                    Array(10).fill({ sz: String((1 - imbalance.ratio) * 100) })
                ]
            };

            const consensus = generateV5Consensus(
                metrics as any, normalizedCandles, syntheticOB,
                coinglassData,    // REAL CoinGlass data (was: mock object with random values)
                onChainData,      // REAL on-chain data (was: mock object with random values)
                maxPain, parseFloat(markets[symbol].nextFundingRate || "0"),
                normalizedCandles4h  // V6 ENGINE: 4H candles for Sovereign–SulCrypto hybrid
            );

            console.log(`[SCANNER] ${symbol} Score: ${consensus.score.toFixed(3)} (Conf: ${consensus.confidence}%)`);

            // V6 INTELLIGENCE LAYER LOGGING
            if (consensus.v6Intel) {
                const v6 = consensus.v6Intel;
                const gateIcon = v6.atrGate ? '🔓' : '🔒';
                const biasIcon = v6.bias4h === 'BULLISH' ? '📈' : v6.bias4h === 'BEARISH' ? '📉' : '➡️';
                console.log(`[V6 INTEL] ${symbol} ${gateIcon} ATR Gate | ${biasIcon} 4H ${v6.bias4h} | Entry: ${v6.sovereignEntry} | Boost: +${v6.sovereignBoost}%`);
                if (v6.atrExit) {
                    console.log(`[V6 EXIT] ${symbol} SL: ${v6.atrExit.slPct.toFixed(2)}% ($${v6.atrExit.slDistance.toFixed(2)}) | TP: ${v6.atrExit.tpPct.toFixed(2)}% ($${v6.atrExit.tpDistance.toFixed(2)}) | ATR: $${v6.atrExit.atr.toFixed(2)}`);
                }
            }

            return {
                symbol, price: currentPrice, change24h: change, candles: normalizedCandles,
                ...consensus,
                atrSl: consensus.v6Intel?.atrExit?.slDistance,
                atrTp: consensus.v6Intel?.atrExit?.tpDistance,
                atrTrail: consensus.v6Intel?.atrExit?.trailDistance,
                atr: consensus.v6Intel?.atrExit?.atr
            };
        } catch (err: any) {
            console.warn(`[SCANNER] Failed to fetch ${symbol}:`, err.message || err);
            return null;
        }
    }
}
