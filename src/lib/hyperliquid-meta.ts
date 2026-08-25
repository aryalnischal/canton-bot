// Hyperliquid asset metadata cache: asset id (index into meta().universe) + szDecimals per coin.
// Hyperliquid addresses assets by integer index, not by symbol string, so every order needs this.

import { InfoClient } from '@nktkas/hyperliquid';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — universe rarely changes mid-session

interface AssetMeta {
    id: number;
    szDecimals: number;
}

let cache: Map<string, AssetMeta> | null = null;
let cacheTime = 0;
let inflight: Promise<Map<string, AssetMeta>> | null = null;

async function loadMeta(info: InfoClient): Promise<Map<string, AssetMeta>> {
    const meta = await info.meta();
    const map = new Map<string, AssetMeta>();
    meta.universe.forEach((asset, index) => {
        map.set(asset.name, { id: index, szDecimals: asset.szDecimals });
    });
    return map;
}

export async function getAssetMeta(info: InfoClient, coin: string): Promise<AssetMeta> {
    const now = Date.now();
    if (!cache || now - cacheTime > CACHE_TTL_MS) {
        if (!inflight) {
            inflight = loadMeta(info).finally(() => { inflight = null; });
        }
        cache = await inflight;
        cacheTime = now;
    }
    const entry = cache.get(coin);
    if (!entry) throw new Error(`[HL-META] Unknown asset: ${coin}`);
    return entry;
}

/**
 * Format a price per Hyperliquid's tick rules: at most 5 significant figures,
 * and at most (6 - szDecimals) decimal places. Ported from the reference bot's
 * format_price() (hyperliquid-swarm-v2/execution/hyperliquid_execution.py) —
 * orders get rejected server-side if this isn't respected.
 */
export function formatPrice(price: number, szDecimals: number): string {
    const maxDecimals = Math.max(0, 6 - szDecimals);
    let val: string;
    if (price >= 10000) val = Math.round(price).toFixed(0);
    else if (price >= 1000) val = price.toFixed(1);
    else if (price >= 100) val = price.toFixed(2);
    else if (price >= 10) val = price.toFixed(3);
    else if (price >= 1) val = price.toFixed(4);
    else val = price.toFixed(5);

    if (val.includes('.')) {
        const decLen = val.split('.')[1].length;
        if (decLen > maxDecimals) {
            val = price.toFixed(maxDecimals);
        }
    }

    if (val.includes('.')) {
        val = val.replace(/0+$/, '').replace(/\.$/, '');
        if (val === '' || val === '-') val = '0';
    }

    return val;
}

/** One fewer decimal place than px, trailing zeros stripped. Used when a trigger order is rejected for imprecise price. */
export function roundPriceDecimals(px: string): string {
    if (!px.includes('.')) return px;
    const decimals = px.split('.')[1].length;
    if (decimals <= 0) return px;

    const val = parseFloat(px);
    if (val < 1.0 && decimals <= 1) return px;

    const rounded = parseFloat(val.toFixed(decimals - 1));
    if (rounded <= 0) return px;

    let res = rounded.toFixed(decimals - 1);
    if (res.includes('.')) res = res.replace(/0+$/, '').replace(/\.$/, '');
    return res;
}

export function formatSize(size: number, szDecimals: number): string {
    const val = parseFloat(size.toFixed(szDecimals));
    return val.toString();
}
