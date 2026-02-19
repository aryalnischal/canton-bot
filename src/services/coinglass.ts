
// COINGLASS INTELLIGENCE SERVICE (v4 API — Hobbyist Plan)
// ========================================================
// Available on Hobbyist ($29/mo):
//   ✅ Liquidation Aggregated History — real long/short liquidation USD volumes
//   ✅ Funding Rate Exchange List — cross-exchange funding rates (Binance, OKX, Bybit, etc.)
//
// NOT available (need higher plan):
//   ❌ Global/Top L/S Ratio, Taker Buy/Sell, NetFlow, Coins Markets, OI OHLC
//
// Strategy: Use 2 CoinGlass calls per symbol (well within 30 RPM budget),
//           derive remaining intelligence from dYdX native data + DeFiLlama.

const API_BASE = 'https://open-api-v4.coinglass.com/api';

// Per-symbol cache (120s TTL — liquidation data is daily aggregated, doesn't change fast)
const cache = new Map<string, { data: CoinglassData; ts: number }>();
const CACHE_TTL = 120_000;

// Global funding rate cache (shared across all symbols, updated once per cycle)
let fundingRateCache: { data: Map<string, number>; ts: number } = { data: new Map(), ts: 0 };
const FR_CACHE_TTL = 300_000; // 5 min (funding rates update every 8h, no need to refetch often)

export interface CoinglassData {
    // Real data from CoinGlass
    longLiq: number;            // USD of long liquidations (24h)
    shortLiq: number;           // USD of short liquidations (24h)
    fundingRate: number;        // Cross-exchange avg funding rate (from CoinGlass)

    // Derived from real data
    oiChangePercent: number;    // Placeholder (derived from dYdX when available)
    longShortRatio: number;     // Estimated from liq ratio as proxy
    topTraderLSR: number;       // Estimated from liq asymmetry
    takerBuySellRatio: number;  // Estimated from liq direction
    oiTotal: number;            // From dYdX native OI

    // Composite intelligence scores
    smartMoneyBias: number;     // -1 to +1
    liquidationPressure: number; // -1 (short squeeze) to +1 (long squeeze)
}

function getApiKey(): string {
    const key = process.env.COINGLASS_API_KEY;
    if (!key) {
        console.warn('[COINGLASS] ⚠️ No API key. Returning neutral.');
    }
    return key || '';
}

function normalizeSymbol(symbol: string): string {
    return symbol.replace(/-?USD[T]?$/i, '').replace(/-?PERP$/i, '');
}

async function cgFetch(endpoint: string, params: Record<string, string> = {}): Promise<any> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const url = new URL(`${API_BASE}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    try {
        const res = await fetch(url.toString(), {
            headers: { 'accept': 'application/json', 'CG-API-KEY': apiKey },
            cache: 'no-store',
            signal: AbortSignal.timeout(8000)
        });

        if (!res.ok) return null;

        const json = await res.json();
        if (json.code === '0' || json.code === 0) return json.data;

        if (json.msg?.includes?.('Upgrade') || json.msg?.includes?.('Many Requests')) {
            // Expected on Hobbyist — don't spam logs
            return null;
        }

        return null;
    } catch {
        return null;
    }
}

function neutralData(): CoinglassData {
    return {
        longLiq: 0, shortLiq: 0, oiChangePercent: 0,
        longShortRatio: 1.0, topTraderLSR: 1.0,
        takerBuySellRatio: 1.0, fundingRate: 0,
        oiTotal: 0, smartMoneyBias: 0, liquidationPressure: 0
    };
}

// Fetch cross-exchange funding rates (1 API call for ALL symbols)
async function fetchAllFundingRates(coin: string): Promise<number> {
    // Check global cache
    if (fundingRateCache.data.has(coin) && Date.now() - fundingRateCache.ts < FR_CACHE_TTL) {
        return fundingRateCache.data.get(coin) || 0;
    }

    const data = await cgFetch('/futures/funding-rate/exchange-list', { symbol: coin });
    if (!data) return 0;

    try {
        // data is array per symbol, each with stablecoin_margin_list
        const coinData = Array.isArray(data)
            ? data.find((d: any) => d.symbol?.toUpperCase() === coin.toUpperCase())
            : data;

        if (!coinData) return 0;

        const margins = coinData.stablecoin_margin_list || coinData.stablecoinMarginList || [];
        let totalFR = 0;
        let count = 0;
        for (const ex of margins) {
            const fr = parseFloat(ex.funding_rate || ex.fundingRate || '0');
            if (!isNaN(fr)) { totalFR += fr; count++; }
        }

        const avgFR = count > 0 ? totalFR / count : 0;

        // Cache it
        fundingRateCache.data.set(coin, avgFR);
        fundingRateCache.ts = Date.now();

        return avgFR;
    } catch {
        return 0;
    }
}

export async function fetchCoinglassData(symbol: string): Promise<CoinglassData> {
    const coin = normalizeSymbol(symbol);

    // Check cache
    const cached = cache.get(coin);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.data;
    }

    // Only 2 API calls per symbol (well within 30 RPM budget)
    const [liqData, fundingRate] = await Promise.all([
        // 1. Liquidation History (aggregated across Binance, OKX, Bybit)
        cgFetch('/futures/liquidation/aggregated-history', {
            exchange_list: 'Binance,OKX,Bybit',
            symbol: coin,
            interval: '1d',
            limit: '1'
        }),
        // 2. Cross-exchange Funding Rate
        fetchAllFundingRates(coin)
    ]);

    let result: CoinglassData = neutralData();

    try {
        // ---------- REAL LIQUIDATION DATA ----------
        if (liqData && Array.isArray(liqData) && liqData.length > 0) {
            const d = liqData[liqData.length - 1];
            result.longLiq = parseFloat(
                d?.aggregated_long_liquidation_usd ||
                d?.longLiquidationUsd || '0'
            );
            result.shortLiq = parseFloat(
                d?.aggregated_short_liquidation_usd ||
                d?.shortLiquidationUsd || '0'
            );
        }

        // ---------- REAL FUNDING RATE ----------
        result.fundingRate = fundingRate;

        // ========== DERIVE INTELLIGENCE FROM REAL DATA ==========

        // LIQUIDATION PRESSURE (-1 to +1)
        // More longs liquidated → longs are getting squeezed → bearish
        // More shorts liquidated → shorts squeezed → bullish
        const totalLiq = result.longLiq + result.shortLiq;
        if (totalLiq > 0) {
            result.liquidationPressure = (result.longLiq - result.shortLiq) / totalLiq;
        }

        // ESTIMATED L/S RATIO (from liq asymmetry)
        // Heavy long liquidations → market was overleveraged long → L/S > 1
        // Heavy short liquidations → overcrowded shorts → L/S < 1
        if (totalLiq > 100_000) { // Only derive if meaningful liq volume
            const liqRatio = result.longLiq / (result.shortLiq + 1);
            // Before the flush: if longs got liquidated, there WERE many longs
            result.longShortRatio = Math.max(0.3, Math.min(3.0, liqRatio));
        }

        // SMART MONEY BIAS (-1 to +1)
        // Combines funding rate direction + liquidation flush pattern
        let smBias = 0;

        // Funding rate signal (strongest CoinGlass signal we have)
        // Negative funding = shorts pay longs = bearish crowd sentiment → contrarian bullish
        // Positive funding = longs pay shorts = bullish crowd sentiment → contrarian bearish
        if (result.fundingRate < -0.01) smBias += 0.5;       // Strongly bullish contrarian
        else if (result.fundingRate < -0.005) smBias += 0.3;  // Moderately bullish contrarian
        else if (result.fundingRate > 0.01) smBias -= 0.5;    // Strongly bearish contrarian
        else if (result.fundingRate > 0.005) smBias -= 0.3;   // Moderately bearish contrarian

        // Liquidation flush signal
        // If shorts just got massively liquidated → short squeeze happened → bullish momentum
        if (result.liquidationPressure < -0.5) smBias += 0.3;  // Short squeeze = bullish
        else if (result.liquidationPressure > 0.5) smBias -= 0.3; // Long squeeze = bearish

        // Cross-validate: Negative funding + short squeeze = VERY bullish
        if (result.fundingRate < -0.005 && result.liquidationPressure < -0.3) {
            smBias += 0.2; // Bonus for alignment
        }
        // Cross-validate: High funding + long squeeze = VERY bearish
        if (result.fundingRate > 0.005 && result.liquidationPressure > 0.3) {
            smBias -= 0.2;
        }

        result.smartMoneyBias = Math.max(-1, Math.min(1, smBias));

        // Set derived fields for interface compatibility
        result.topTraderLSR = result.longShortRatio; // Best proxy we have
        result.takerBuySellRatio = result.liquidationPressure < 0 ? 1.2 : (result.liquidationPressure > 0 ? 0.8 : 1.0);

        // Log summary
        const frDisplay = (result.fundingRate * 100).toFixed(4);
        console.log(
            `[COINGLASS] ${coin}: ` +
            `Liq L=$${(result.longLiq / 1e6).toFixed(2)}M S=$${(result.shortLiq / 1e6).toFixed(2)}M | ` +
            `FR=${frDisplay}% (${result.fundingRate > 0.005 ? '🔴 Longs Pay' : result.fundingRate < -0.005 ? '🟢 Shorts Pay' : '⚪ Neutral'}) | ` +
            `LiqPressure=${result.liquidationPressure > 0 ? 'L-Squeeze' : result.liquidationPressure < 0 ? 'S-Squeeze' : 'Neutral'}(${result.liquidationPressure.toFixed(2)}) | ` +
            `SmartMoney=${result.smartMoneyBias >= 0 ? '+' : ''}${result.smartMoneyBias.toFixed(2)}`
        );
    } catch (parseErr: any) {
        console.warn(`[COINGLASS] Parse error for ${coin}:`, parseErr.message);
        result = neutralData();
    }

    cache.set(coin, { data: result, ts: Date.now() });
    return result;
}
