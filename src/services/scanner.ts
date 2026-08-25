
import { InfoClient, HttpTransport } from '@nktkas/hyperliquid';
import { generateV5Consensus } from '@/lib/v5/analysis-v5';
import { calculateMaxPain } from '@/services/deribit-api';
import { fetchCoinglassData } from '@/services/coinglass';
import { fetchOnChainMetrics } from '@/services/on-chain';
import { rateLimitedCall } from '@/lib/rate-limiter';

const MS_15M = 15 * 60 * 1000;
const MS_4H = 4 * 60 * 60 * 1000;
const CANDLE_COUNT = 50;

// Helper: Fetch Orderbook Imbalance (Whale Score Proxy)
async function getOrderbookImbalance(info: InfoClient, coin: string): Promise<{ ratio: number, depth: number }> {
    try {
        const book = await rateLimitedCall(() => info.l2Book({ coin }));
        if (!book || !book.levels) return { ratio: 0.5, depth: 0 };

        const [bids, asks] = book.levels;
        const bidsVol = bids.slice(0, 10).reduce((acc, b) => acc + parseFloat(b.sz), 0);
        const asksVol = asks.slice(0, 10).reduce((acc, a) => acc + parseFloat(a.sz), 0);

        const total = bidsVol + asksVol;
        if (total === 0) return { ratio: 0.5, depth: 0 };

        return { ratio: bidsVol / total, depth: total };
    } catch (e) {
        return { ratio: 0.5, depth: 0 };
    }
}

export class ScannerService {
    private info: InfoClient;
    private scanPromise: Promise<{ markets: any[], signals: any[] }> | null = null;
    private lastResult: { markets: any[], signals: any[] } | null = null;

    constructor() {
        const isTestnet = process.env.HL_TESTNET === 'true';
        const transport = new HttpTransport({ isTestnet });
        this.info = new InfoClient({ transport });
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
        console.log("[SCANNER] Scanning Hyperliquid Markets...");

        // 1. Get All Markets (meta + volume/OI/price context in one call)
        const [meta, assetCtxs] = await rateLimitedCall(() => this.info.metaAndAssetCtxs());

        const universe = meta.universe
            .map((asset, index) => ({ asset, ctx: assetCtxs[index] }))
            .filter(({ asset }) => !asset.isDelisted);

        console.log(`[SCANNER] Found ${universe.length} Valid markets.`);

        // 2. SELECTION LOGIC (Strict Liquidity: Volume + OI)
        // A. Volume Leaders (Top 10) - Prevents slippage
        const sortedByVol = [...universe].sort((a, b) => parseFloat(b.ctx.dayNtlVlm) - parseFloat(a.ctx.dayNtlVlm));
        const volumeTargets = sortedByVol.slice(0, 10);

        // B. Open Interest Leaders (Top 5)
        const sortedByOI = [...universe].sort((a, b) =>
            (parseFloat(b.ctx.openInterest) * parseFloat(b.ctx.markPx)) -
            (parseFloat(a.ctx.openInterest) * parseFloat(a.ctx.markPx))
        );
        const oiTargets = sortedByOI.slice(0, 5);

        // Combine (Unique Set, keyed by coin name)
        const targetMap = new Map<string, { asset: typeof meta.universe[number]; ctx: typeof assetCtxs[number] }>();
        [...volumeTargets, ...oiTargets].forEach(t => targetMap.set(t.asset.name, t));
        const targets = Array.from(targetMap.values());

        console.log(`[SCANNER] Selected ${targets.length} Targets:`);
        console.log(`   > Top Volume (10): ${volumeTargets.map(t => t.asset.name).join(', ')}`);
        console.log(`   > Top OI (5)     : ${oiTargets.map(t => t.asset.name).join(', ')}`);

        const results: any[] = [];

        // BATCHED PARALLEL FETCHING (2 at a time — conservative for API rate limits)
        const BATCH_SIZE = 2;

        // Fetch on-chain data ONCE (it's global, not per-symbol)
        const onChainData = await fetchOnChainMetrics('global');

        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
            const batch = targets.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(
                batch.map(t => this._processSymbol(t.asset.name, t.ctx, onChainData))
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
        // Threshold: 0.2 (Active Scalp level)
        const signals = results
            .filter(r => Math.abs(r.score) >= 0.20)
            .sort((a, b) => b.score - a.score);

        const payload = { markets: results, signals };
        this.lastResult = payload;
        return payload;
    }

    private async fetchCandles(coin: string, interval: '15m' | '4h', spanMs: number) {
        const raw = await rateLimitedCall(() => this.info.candleSnapshot({
            coin,
            interval,
            startTime: Date.now() - spanMs,
        }));

        return raw
            .map(c => ({
                t: c.t,
                o: parseFloat(c.o),
                h: parseFloat(c.h),
                l: parseFloat(c.l),
                c: parseFloat(c.c),
                v: parseFloat(c.v),
            }))
            .sort((a, b) => a.t - b.t); // Defensive: don't assume API order, indicators need ascending time
    }

    // Per-symbol processing (called by batch loop)
    private async _processSymbol(coin: string, ctx: { markPx: string; oraclePx: string; funding: string }, onChainData: any): Promise<any | null> {
        const symbol = `${coin}-USD`;
        try {
            let attempts = 0;
            let success = false;
            let normalizedCandles: any[] = [];
            let normalizedCandles4h: any[] = [];
            let imbalance: { ratio: number; depth: number } = { ratio: 0.5, depth: 0 };
            let maxPain = 0;
            let coinglassData: any;

            while (!success && attempts < 3) {
                try {
                    [normalizedCandles, normalizedCandles4h, imbalance, maxPain, coinglassData] = await Promise.all([
                        this.fetchCandles(coin, '15m', CANDLE_COUNT * MS_15M),
                        this.fetchCandles(coin, '4h', CANDLE_COUNT * MS_4H),
                        getOrderbookImbalance(this.info, coin),
                        calculateMaxPain(symbol).catch(() => 0),
                        fetchCoinglassData(symbol),
                    ]);
                    success = true;
                } catch (netErr: any) {
                    attempts++;
                    if (netErr?.response?.status === 429 || netErr?.status === 429) {
                        const backoff = 2000 * Math.pow(2, attempts);
                        console.warn(`[SCANNER] 429 Rate Limit on ${coin}. Retrying in ${backoff}ms...`);
                        await new Promise(r => setTimeout(r, backoff));
                    } else {
                        console.warn(`[SCANNER] Error fetching ${coin}:`, netErr.message);
                        if (attempts >= 3) throw netErr;
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }

            if (!success || !normalizedCandles.length) return null;

            const currentPrice = parseFloat(ctx.oraclePx || ctx.markPx || "0");
            const open24h = normalizedCandles[0]?.o || currentPrice;
            const change = open24h > 0 ? ((currentPrice - open24h) / open24h) * 100 : 0;
            const fundingRate = parseFloat(ctx.funding || "0");

            const metrics = [{
                symbol, price: currentPrice, priceChange24h: change,
                volumeChange24h: 0, high24h: currentPrice * 1.05, low24h: currentPrice * 0.95,
                fundingRate, open: open24h
            }];

            const whaleScore = imbalance.ratio;

            const syntheticOB = {
                levels: [
                    Array(10).fill({ sz: String(imbalance.ratio * 100) }),
                    Array(10).fill({ sz: String((1 - imbalance.ratio) * 100) })
                ]
            };

            const consensus = generateV5Consensus(
                metrics as any, normalizedCandles, syntheticOB,
                coinglassData,
                onChainData,
                maxPain, fundingRate,
                normalizedCandles4h
            );

            console.log(`[SCANNER] ${symbol} Score: ${consensus.score.toFixed(3)} (Conf: ${consensus.confidence}%)`);

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
            console.warn(`[SCANNER] Failed to fetch ${coin}:`, err.message || err);
            return null;
        }
    }
}
