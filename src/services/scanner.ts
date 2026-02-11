
import {
    Network,
    IndexerClient
} from '@dydxprotocol/v4-client-js';
import { generateV5Consensus } from '@/lib/v5/analysis-v5';
import { calculateMaxPain } from '@/services/deribit-api';

// Helper: Fetch Orderbook Imbalance (Whale Score Proxy)
async function getOrderbookImbalance(client: IndexerClient, symbol: string): Promise<{ ratio: number, depth: number }> {
    try {
        const ob = await (client as any).orderbook.getPerpetualMarketOrderbook(symbol);

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
        const response = await this.indexer.markets.getPerpetualMarkets();
        const markets = response.markets;
        const marketKeys = Object.keys(markets).filter(k => k.endsWith('USD'));

        console.log(`[SCANNER] Found ${marketKeys.length} USD markets.`);
        if (marketKeys.length > 0) {
            console.log("[DEBUG] Market Keys:", Object.keys(markets[marketKeys[0]]));
        }

        const results: any[] = [];

        // 2. Fetch Candles for Top Assets
        // 2. SELECTION LOGIC (Hybrid: Volume + Volatility)
        // A. Volume Leaders (Top 15)
        const sortedByVol = [...marketKeys].sort((a, b) => {
            const volA = parseFloat(markets[a].volume24H || "0");
            const volB = parseFloat(markets[b].volume24H || "0");
            return volB - volA;
        });
        const volumeTargets = sortedByVol.slice(0, 15);

        // B. Volatility Movers (Top 10 from remainder)
        const remainder = sortedByVol.slice(15);
        const sortedByVolat = remainder.sort((a, b) => {
            // Use Absolute Change to find biggest movers (Up or Down)
            const changeA = Math.abs(parseFloat(markets[a].priceChange24H || "0"));
            const changeB = Math.abs(parseFloat(markets[b].priceChange24H || "0"));
            return changeB - changeA;
        });
        const volatilityTargets = sortedByVolat.slice(0, 10);

        // Combine
        const targets = [...volumeTargets, ...volatilityTargets];

        console.log(`[SCANNER] Selected ${targets.length} Targets:`);
        console.log(`   > Top Volume: ${volumeTargets.join(', ')}`);
        console.log(`   > Top Volat : ${volatilityTargets.join(', ')}`);

        for (const symbol of targets) {
            try {
                // RETRY LOGIC for 429s (Exponential Backoff up to 16s)
                let candles: any, imbalance: any, maxPain: any;
                let attempts = 0;
                let success = false;

                while (!success && attempts < 3) {
                    try {
                        // SEQUENTIAL FETCHING (Reduce Burst)
                        // 1. Candles
                        candles = await (this.indexer as any).markets.getPerpetualMarketCandles(
                            symbol, '15MINS', undefined, undefined, 50
                        );
                        await new Promise(r => setTimeout(r, 200)); // Short break

                        // 2. Orderbook
                        imbalance = await getOrderbookImbalance(this.indexer, symbol);

                        // 3. Max Pain (External API - No delay needed for dYdX)
                        maxPain = await calculateMaxPain(symbol).catch(() => 0);

                        success = true;
                    } catch (netErr: any) {
                        attempts++;
                        if (netErr?.response?.status === 429) {
                            const backoff = 2000 * Math.pow(2, attempts); // 4s, 8s, 16s
                            console.warn(`[SCANNER] 429 Rate Limit on ${symbol}. Retrying in ${backoff}ms...`);
                            await new Promise(r => setTimeout(r, backoff));
                        } else {
                            console.warn(`[SCANNER] Error fetching ${symbol}:`, netErr.message);
                            if (attempts >= 3) throw netErr;
                            await new Promise(r => setTimeout(r, 1000));
                        }
                    }
                }

                if (!success) continue;

                // Debug Candle Count
                if (!candles || !candles.candles || candles.candles.length === 0) {
                    console.log(`[SCANNER] ${symbol}: No candles returned.`);
                    continue;
                }

                // ... (Normalization & Logic remains the same)

                // Normalize Candles
                const normalizedCandles = candles.candles.map((c: any) => ({
                    t: new Date(c.startedAt).getTime(),
                    o: parseFloat(c.open),
                    h: parseFloat(c.high),
                    l: parseFloat(c.low),
                    c: parseFloat(c.close),
                    v: parseFloat(c.baseTokenVolume)
                })).reverse();

                // Metrics
                // FIXED: Use oraclePrice as dYdX v4 API returns 'oraclePrice', not 'price'
                const currentPrice = parseFloat(markets[symbol].oraclePrice || markets[symbol].price || "0");
                const open24h = normalizedCandles[0]?.o || currentPrice;
                const change = open24h > 0 ? ((currentPrice - open24h) / open24h) * 100 : 0;

                const metrics = [{
                    symbol: symbol,
                    price: currentPrice,
                    priceChange24h: change,
                    volumeChange24h: 0,
                    high24h: currentPrice * 1.05,
                    low24h: currentPrice * 0.95,
                    fundingRate: parseFloat(markets[symbol].nextFundingRate || "0"), // Use Real Funding
                    open: open24h
                }];

                // Consolidate Real Data
                const whaleScore = imbalance.ratio; // 0.5 = Neutral, >0.6 Bullish
                const netFlow = (whaleScore - 0.5) * 1000;

                // Run V5 Consensus
                const consensus = generateV5Consensus(
                    metrics as any,
                    normalizedCandles,
                    null,
                    {
                        longShortRatio: 1,
                        topTraderLsr: 1,
                        longLiq: 0,
                        shortLiq: 0
                    } as any,
                    {
                        isBullish: whaleScore > 0.6,
                        isBearish: whaleScore < 0.4,
                        netFlow: netFlow,
                        whaleScore: whaleScore,
                        tvlChange: 0,
                        btcInflow: 0,
                        usdcInflow: 0
                    },
                    maxPain,
                    parseFloat(markets[symbol].nextFundingRate || "0")
                );

                results.push({
                    symbol,
                    price: currentPrice,
                    change24h: change,
                    candles: normalizedCandles,
                    ...consensus
                });

                console.log(`[SCANNER] ${symbol} Score: ${consensus.score.toFixed(3)} (Conf: ${consensus.confidence}%)`);

                // Delay to prevent 429 (Rate Limit) - Increased to 1000ms (Very Safe)
                await new Promise(r => setTimeout(r, 1000));

            } catch (err: any) {
                console.warn(`[SCANNER] Failed to fetch ${symbol}:`, err.message || err);
            }
        }

        // Filter and Sort by Score
        // Threshold: 0.4 (Active Scalp level)
        const signals = results
            .filter(r => Math.abs(r.score) > 0.4)
            .sort((a, b) => b.score - a.score);

        const payload = { markets: results, signals };
        this.lastResult = payload;
        return payload;
    }
}
