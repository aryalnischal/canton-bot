
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

    constructor() {
        const networkConfig = process.env.DYDX_NETWORK === 'mainnet' ? Network.mainnet() : Network.testnet();
        this.indexer = new IndexerClient(networkConfig.indexerConfig);
    }

    public async scanMarkets(limit: number = 10): Promise<{ markets: any[], signals: any[] }> {
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
        // A. Volume Leaders (Top 10)
        const sortedByVol = [...marketKeys].sort((a, b) => {
            const volA = parseFloat(markets[a].volume24H || "0");
            const volB = parseFloat(markets[b].volume24H || "0");
            return volB - volA;
        });
        const volumeTargets = sortedByVol.slice(0, 10);

        // B. Volatility Movers (Top 5 from remainder)
        const remainder = sortedByVol.slice(10);
        const sortedByVolat = remainder.sort((a, b) => {
            // Use Absolute Change to find biggest movers (Up or Down)
            const changeA = Math.abs(parseFloat(markets[a].priceChange24H || "0"));
            const changeB = Math.abs(parseFloat(markets[b].priceChange24H || "0"));
            return changeB - changeA;
        });
        const volatilityTargets = sortedByVolat.slice(0, 5);

        // Combine
        const targets = [...volumeTargets, ...volatilityTargets];

        console.log(`[SCANNER] Selected ${targets.length} Targets:`);
        console.log(`   > Top Volume: ${volumeTargets.join(', ')}`);
        console.log(`   > Top Volat : ${volatilityTargets.join(', ')}`);

        for (const symbol of targets) {
            try {
                // PARALLEL FETCHING
                const start = Date.now();
                const [candles, imbalance, maxPain] = await Promise.all([
                    (this.indexer as any).markets.getPerpetualMarketCandles(
                        symbol,
                        '15MINS',
                        undefined,
                        undefined,
                        50
                    ),
                    getOrderbookImbalance(this.indexer, symbol),
                    calculateMaxPain(symbol).catch(() => 0)
                ]);

                // Debug Candle Count
                if (!candles || !candles.candles || candles.candles.length === 0) {
                    console.log(`[SCANNER] ${symbol}: No candles returned.`);
                    continue;
                }

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

                // Delay to prevent 429 (Rate Limit) - Increased to 2s
                await new Promise(r => setTimeout(r, 2000));

            } catch (err) {
                console.warn(`[SCANNER] Failed to fetch ${symbol}:`, err);
            }
        }

        // Filter and Sort by Score
        // Threshold: 0.4 (Active Scalp level)
        const signals = results
            .filter(r => Math.abs(r.score) > 0.4)
            .sort((a, b) => b.score - a.score);

        return { markets: results, signals };
    }
}
