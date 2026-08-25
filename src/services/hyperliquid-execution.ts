
import { ExchangeClient, InfoClient, HttpTransport } from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { getAssetMeta, formatPrice, roundPriceDecimals, formatSize } from '../lib/hyperliquid-meta';
import { getTpLayers } from '../lib/adaptive-tp';

dotenv.config({ path: '.env.local' });

// Types (unchanged from the dYdX execution service — every caller depends on this shape)
export interface ExecutionResult {
    success: boolean;
    txHash?: string;
    error?: string;
    filledPrice?: number;
    filledSize?: number;
}

function toCoin(symbol: string): string {
    return symbol.split('-')[0].toUpperCase();
}

function toSymbol(coin: string): string {
    return `${coin}-USD`;
}

export class HyperliquidExecutionService {
    private exchange: ExchangeClient | null = null;
    private info: InfoClient | null = null;
    private accountAddress: string | null = null;
    private isReady: boolean = false;
    private initializationPromise: Promise<void> | null = null;

    constructor() {
        this.initializationPromise = this.initialize();
    }

    private async initialize() {
        try {
            const privateKey = process.env.HL_PRIVATE_KEY;
            const isTestnet = process.env.HL_TESTNET === 'true';

            if (!privateKey) {
                console.error("[HL] Missing HL_PRIVATE_KEY in .env.local");
                return;
            }

            console.log(`[HL] Initializing Client (${isTestnet ? 'testnet' : 'mainnet'})...`);

            const cleanPk = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
            const wallet = privateKeyToAccount(cleanPk);

            // Agent-wallet pattern: the signing key can differ from the account that
            // actually holds funds/positions (matches hyperliquid-swarm-v2's HL_ACCOUNT_ADDRESS).
            this.accountAddress = process.env.HL_ACCOUNT_ADDRESS || wallet.address;

            const transport = new HttpTransport({ isTestnet });
            this.exchange = new ExchangeClient({ transport, wallet });
            this.info = new InfoClient({ transport });

            this.isReady = true;
            console.log(`[HL] Ready. Signer: ${wallet.address} | Account: ${this.accountAddress}`);
        } catch (e) {
            console.error("[HL] Initialization Failed:", e);
        }
    }

    public async executeOrder(
        symbol: string, // e.g., "BTC-USD"
        action: 'BUY' | 'SELL',
        sizeUsd: number,
        currentPrice: number,
        leverage: number = 1,
        reduceOnly: boolean = false,
        options: { sl?: number; tp?: number; trailingPercent?: number; tpLayers?: { pct: number; gain: number }[] } = {}
    ): Promise<ExecutionResult> {
        if (!this.isReady) await this.initializationPromise;
        if (!this.exchange || !this.info || !this.accountAddress) return { success: false, error: "Client not ready" };

        try {
            const coin = toCoin(symbol);
            const { id: assetId, szDecimals } = await getAssetMeta(this.info, coin);

            const rawSize = sizeUsd / currentPrice;
            const size = formatSize(rawSize, szDecimals);
            if (parseFloat(size) <= 0 || !isFinite(parseFloat(size))) {
                return { success: false, error: `Invalid Size Calculation: ${size} (Price: ${currentPrice})` };
            }

            const isBuy = action === 'BUY';

            // Hyperliquid leverage is set per-asset via an explicit call, unlike dYdX where
            // it was implicit — only meaningful to set on a genuine open, not a reduce-only close.
            if (!reduceOnly && leverage >= 1) {
                try {
                    await this.exchange.updateLeverage({ asset: assetId, isCross: true, leverage: Math.max(1, Math.round(leverage)) });
                } catch (e) {
                    console.warn(`[HL] updateLeverage failed for ${coin} (continuing with existing leverage):`, e);
                }
            }

            // Hyperliquid has no native "market" order — simulate one with an aggressive
            // IOC limit order, same pattern as the old dYdX path (5% slippage) and the
            // reference bot (hyperliquid-swarm-v2's market_open/market_close).
            const slippagePrice = isBuy ? currentPrice * 1.05 : currentPrice * 0.95;
            const priceStr = formatPrice(slippagePrice, szDecimals);

            console.log(`[HL] Placing ${action} ${size} ${coin} (Reduce: ${reduceOnly})...`);
            console.log(`[HL] LIMIT IOC at $${priceStr} (5% slippage from $${currentPrice})`);

            const result = await this.exchange.order({
                orders: [{
                    a: assetId,
                    b: isBuy,
                    p: priceStr,
                    s: size,
                    r: reduceOnly,
                    t: { limit: { tif: 'Ioc' } },
                }],
                grouping: 'na',
            });

            // OrderSuccessResponse already excludes the error-status variant (the SDK
            // throws ApiRequestError on failure instead), so this is resting/filled/string only.
            const status = result.response.data.statuses[0];
            const filled = typeof status === 'object' && status !== null && 'filled' in status ? status.filled : undefined;
            const resting = typeof status === 'object' && status !== null && 'resting' in status ? status.resting : undefined;
            const filledPrice = filled ? parseFloat(filled.avgPx) : currentPrice;
            const filledSize = filled ? parseFloat(filled.totalSz) : parseFloat(size);
            const oid = filled?.oid ?? resting?.oid;

            // Triggers (SL/TP) — only meaningful on a genuine open, mirrors the old dYdX path.
            if (!reduceOnly && (options.sl || options.tp)) {
                console.log(`[HL] Placing Triggers (SL/TP) for ${coin}...`);
                await this.placeTriggers(coin, assetId, szDecimals, action, filledSize, options.sl, options.tp, options.tpLayers);
            }
            if (options.trailingPercent) {
                // Same as the old dYdX path: trailing stop is not placed on-chain here.
                // Canton's own position-management loop (standalone-bot.ts) handles trailing
                // in-process instead — this branch intentionally stays a no-op.
                console.log("[HL] Trailing Stop requested. Skipping on-chain placement (handled by bot loop).");
            }

            return {
                success: true,
                txHash: oid !== undefined ? String(oid) : `HL-${Date.now()}`,
                filledPrice,
                filledSize,
            };
        } catch (e: any) {
            console.error("[HL] Order Failed:", e);
            return { success: false, error: e.message || String(e) };
        }
    }

    private async placeTriggers(
        coin: string,
        assetId: number,
        szDecimals: number,
        entryAction: 'BUY' | 'SELL',
        size: number,
        slPrice?: number,
        tpPrice?: number,
        tpLayers?: { pct: number; gain: number }[]
    ) {
        const exitIsBuy = entryAction !== 'BUY'; // opposite side closes the position

        if (slPrice) {
            await this.placeTriggerOrderWithRetry(coin, assetId, szDecimals, exitIsBuy, size, slPrice, 'sl');
        }

        if (tpPrice) {
            const layers = tpLayers || getTpLayers(toSymbol(coin));
            await this.placeLayeredTPs(coin, assetId, szDecimals, entryAction, size, tpPrice, layers);
        }
    }

    /**
     * Places a trigger (SL/TP) order, retrying with lower price precision if the
     * exchange rejects the price for violating tick-size rules. Ported from
     * hyperliquid-swarm-v2/execution/hyperliquid_execution.py's
     * _place_trigger_order_with_slippage_fallback — Hyperliquid enforces stricter
     * price-precision rules than dYdX did, so this retry is load-bearing, not decorative.
     */
    private async placeTriggerOrderWithRetry(
        coin: string, assetId: number, szDecimals: number,
        isBuy: boolean, size: number, triggerPrice: number, tpsl: 'sl' | 'tp'
    ) {
        let priceStr = formatPrice(triggerPrice, szDecimals);
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const result = await this.exchange!.order({
                    orders: [{
                        a: assetId,
                        b: isBuy,
                        p: priceStr,
                        s: formatSize(size, szDecimals),
                        r: true,
                        t: { trigger: { isMarket: true, triggerPx: priceStr, tpsl } },
                    }],
                    grouping: 'na',
                });
                console.log(`[HL] ${tpsl.toUpperCase()} Placed: ${coin} @ $${priceStr}`);
                return result;
            } catch (e: any) {
                const msg = String(e.message || e).toLowerCase();
                if (msg.includes('invalid price') || msg.includes('tick size') || msg.includes('trigger price') || msg.includes('badtriggerpx')) {
                    const next = roundPriceDecimals(priceStr);
                    if (next === priceStr) {
                        console.error(`[HL] ${tpsl.toUpperCase()} Failed (precision exhausted) for ${coin}:`, e);
                        return;
                    }
                    console.warn(`[HL] ${tpsl.toUpperCase()} price rejected, retrying ${priceStr} -> ${next}`);
                    priceStr = next;
                } else {
                    console.error(`[HL] ${tpsl.toUpperCase()} Failed for ${coin}:`, e);
                    return;
                }
            }
        }
        console.error(`[HL] ${tpsl.toUpperCase()} Failed for ${coin} after retries`);
    }

    private async placeLayeredTPs(
        coin: string, assetId: number, szDecimals: number,
        entryAction: 'BUY' | 'SELL', totalSize: number, entryPrice: number,
        layers: { pct: number; gain: number }[]
    ) {
        const exitIsBuy = entryAction !== 'BUY';
        const direction = entryAction === 'BUY' ? 1 : -1;

        console.log(`[HL] Placing ${layers.length} Adaptive TP layers for ${coin}`);

        for (const layer of layers) {
            const triggerPrice = entryPrice * (1 + layer.gain * direction);
            const layerSize = totalSize * layer.pct;
            if (layerSize <= 0) continue;
            await this.placeTriggerOrderWithRetry(coin, assetId, szDecimals, exitIsBuy, layerSize, triggerPrice, 'tp');
        }
    }

    public async getAccountState(): Promise<any> {
        if (!this.isReady) await this.initializationPromise;
        if (!this.info || !this.accountAddress) return null;

        try {
            const state = await this.info.clearinghouseState({ user: this.accountAddress as `0x${string}` });

            const openPositions: Record<string, any> = {};
            for (const entry of state.assetPositions) {
                const p = entry.position;
                const szi = parseFloat(p.szi);
                if (szi === 0) continue;
                const positionValue = parseFloat(p.positionValue);
                const markPrice = positionValue / Math.abs(szi);

                openPositions[toSymbol(p.coin)] = {
                    side: szi > 0 ? 'BUY' : 'SELL',
                    size: String(Math.abs(szi)),
                    entryPrice: p.entryPx,
                    oraclePrice: String(markPrice),
                    unrealizedPnl: p.unrealizedPnl,
                };
            }

            return {
                equity: state.marginSummary.accountValue,
                freeCollateral: state.withdrawable,
                openPositions,
                address: this.accountAddress,
            };
        } catch (e: any) {
            console.error("[HL] Failed to fetch state", e);
            return null;
        }
    }
}
