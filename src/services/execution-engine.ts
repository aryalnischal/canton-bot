import { ethers } from "ethers";
import { logger } from "@/lib/logger";
// Note: 'hyperliquid' package export structure varies. Adjusting for common usage.
// If this fails compile, we will debug the import. 
// Assuming a 'Hyperliquid' class or 'ExchangeClient'.
// For now, we stub the SDK call to be safe until verified, or use 'any'.
// But let's try to be real.
import { Hyperliquid } from "hyperliquid";

export interface ExecutionResult {
    success: boolean;
    txHash?: string;
    error?: string;
    filledPrice?: number;
    filledSize?: number;
}

export class HyperliquidExecutionService {
    private wallet: ethers.Wallet | null = null;
    private sdk: any | null = null; // Typing 'any' safely for first pass
    private isReady: boolean = false;

    constructor() {
        this.initialize();
    }

    private initialize() {
        const privateKey = process.env.HL_PRIVATE_KEY;
        const address = process.env.HL_WALLET_ADDRESS;

        if (!privateKey) {
            logger.warn("[EXECUTION] HL_PRIVATE_KEY missing. Live execution disabled.");
            return;
        }

        try {
            this.wallet = new ethers.Wallet(privateKey);
            // Initialize SDK
            this.sdk = new Hyperliquid(this.wallet);
            this.isReady = true;
            logger.info(`[EXECUTION] Hyperliquid Engine Ready. Wallet: ${this.wallet.address.substring(0, 6)}...`);
        } catch (e: any) {
            logger.error("[EXECUTION] Failed to init Hyperliquid SDK", { error: e.message });
        }
    }

    private assetIdMap: Map<string, { id: number, decimals: number }> = new Map();

    private initializationPromise: Promise<void> | null = null;

    private async ensureAssetIdMap() {
        if (this.assetIdMap.size > 0) return;

        // SINGLETON: Prevent parallel requests (Rate Limit Protection)
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            let attempts = 0;
            const maxAttempts = 5;
            console.log("-------------------------------------------");
            console.log("[EXECUTION] ENGINE VERSION: FINAL-FINAL-FIX"); // VERSION CHECK
            console.log("-------------------------------------------");

            while (attempts < maxAttempts) {
                try {
                    attempts++;
                    logger.info(`[EXECUTION] Fetching Hyperliquid Metadata (Attempt ${attempts}/5)...`);

                    let meta;
                    // 1. Try perpetuals.getMeta
                    if (this.sdk.info.perpetuals && typeof this.sdk.info.perpetuals.getMeta === 'function') {
                        meta = await this.sdk.info.perpetuals.getMeta();
                        if (meta && meta.universe) {
                            meta.universe.forEach((u: any, index: number) => {
                                this.assetIdMap.set(u.name, {
                                    id: index,
                                    decimals: (u.szDecimals !== undefined) ? u.szDecimals : 4
                                });

                                // REPAIR SDK MAP (Fix "Unknown Asset" Error)
                                try {
                                    const sc = this.sdk.exchange.symbolConversion;
                                    if (sc && sc.assetToIndexMap) {
                                        if (sc.assetToIndexMap instanceof Map) {
                                            sc.assetToIndexMap.set(u.name, index);
                                        } else {
                                            sc.assetToIndexMap[u.name] = index;
                                        }
                                    }
                                } catch (e) { }
                            });

                            // MONKEY PATCH: Override getAssetIndex to use our robust map
                            // This guarantees 'placeOrder' finds the ID.
                            try {
                                this.sdk.exchange.getAssetIndex = (coin: string) => {
                                    let info = this.assetIdMap.get(coin);

                                    // Try adding -PERP suffix (common in Hyperliquid metadata)
                                    if (!info && !coin.endsWith("-PERP")) {
                                        info = this.assetIdMap.get(`${coin}-PERP`);
                                    }

                                    // Try stripping USDT if passed as BTCUSDT
                                    if (!info && coin.endsWith("USDT")) {
                                        const clean = coin.replace("USDT", "");
                                        info = this.assetIdMap.get(clean) || this.assetIdMap.get(`${clean}-PERP`);
                                    }

                                    if (info) return info.id;
                                    console.warn(`[EXECUTION] MonkeyPatch Lookup for ${coin}: NOT FOUND`);
                                    return undefined;
                                };
                                logger.info(`[EXECUTION] Monkey Patched sdk.exchange.getAssetIndex!`);
                            } catch (e) {
                                logger.error(`[EXECUTION] Failed to Monkey Patch SDK`, e);
                            }

                            // DEBUG: Verify Map Population
                            try {
                                const sc = this.sdk.exchange.symbolConversion;
                                if (sc && sc.assetToIndexMap) {
                                    const size = (sc.assetToIndexMap instanceof Map) ? sc.assetToIndexMap.size : Object.keys(sc.assetToIndexMap).length;
                                    logger.info(`[DEBUG] SDK Map Size after Repair: ${size}`);

                                    // LOG KEYS TO DEBUG MISMATCH
                                    const keys = Array.from(this.assetIdMap.keys()).slice(0, 20);
                                    logger.info(`[DEBUG] Asset Map Keys Sample: ${JSON.stringify(keys)}`);

                                    // Test Random Lookup
                                    const testCoin = "BTC";
                                    const idx = this.sdk.exchange.getAssetIndex(testCoin);
                                    logger.info(`[DEBUG] Test Lookup '${testCoin}': ${idx}`);
                                } else {
                                    logger.warn("[DEBUG] SDK Map Missing!");
                                }
                            } catch (e) { console.error("Verify Map Failed", e); }

                            logger.info(`[EXECUTION] Loaded ${this.assetIdMap.size} assets and Repaired SDK Map.`);

                            // DEBUG: Inspect SDK SymbolConversion to repair it
                            try {
                                const sc = this.sdk.exchange.symbolConversion;
                                logger.info(`[DEBUG] SymbolConversion Keys: ${Object.keys(sc)}`);
                                // logger.info(`[DEBUG] SymbolConversion Proto: ${Object.getOwnPropertyNames(Object.getPrototypeOf(sc))}`);
                            } catch (e) { console.log(e); }

                            return; // Success
                        }
                    }

                    // 2. Fallback
                    if (typeof this.sdk.info.getAllAssets === 'function') {
                        await new Promise(r => setTimeout(r, 500)); // Delay fallback
                        const assets = await this.sdk.info.getAllAssets();
                        // ... logic ...
                    }

                    throw new Error("No Metadata Found");

                } catch (e: any) {
                    logger.error(`[EXECUTION] Metadata Fetch Failed (Attempt ${attempts})`, { error: e.message });
                    const isRateLimit = String(e).includes('429') || e.code === 429;

                    if (isRateLimit) {
                        const delay = 1000 * Math.pow(2, attempts); // 2s, 4s, 8s...
                        logger.warn(`[EXECUTION] Rate Limit 429. Backing of for ${delay}ms`);
                        await new Promise(r => setTimeout(r, delay));
                    } else {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }
            logger.error("[EXECUTION] GAVE UP Fetching Metadata after 5 attempts.");
        })();

        return this.initializationPromise;
    }

    public async getAccountState(): Promise<any> {
        if (!this.sdk) this.initialize();
        let attempts = 0;
        while (!this.isReady && attempts < 10) {
            await new Promise(r => setTimeout(r, 200));
            attempts++;
        }
        if (!this.isReady) throw new Error("SDK not ready");

        // Fix: Use .perpetuals namespace
        return this.sdk.info.perpetuals.getClearinghouseState(this.wallet?.address);
    }


    public async executeOrder(
        symbol: string,
        action: 'BUY' | 'SELL',
        sizeUsd: number,
        currentPrice: number,
        leverage: number = 1,
        reduceOnly: boolean = false,
        options?: { stopLossPrice?: number; takeProfitPrice?: number }
    ): Promise<ExecutionResult> {
        if (!this.isReady || !this.sdk) {
            return { success: false, error: "Engine not ready (Check Keys)" };
        }

        if (process.env.KILL_SWITCH === 'TRUE' && !reduceOnly) {
            return { success: false, error: "KILL SWITCH ACTIVE" };
        }

        // PRICE GUARD (Stop "7x" garbage data)
        if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
            return { success: false, error: `Invalid Price: ${currentPrice}` };
        }

        await this.ensureAssetIdMap();

        const coin = symbol.replace("USDT", "");
        let assetInfo = this.assetIdMap.get(coin);
        if (!assetInfo) assetInfo = this.assetIdMap.get(`${coin}-PERP`);

        if (!assetInfo) {
            console.error(`[EXECUTION] Asset Info Missing for ${coin}.`);
            return { success: false, error: "Asset Info Missing" };
        }

        const decimals = assetInfo.decimals;

        // PREPARE DATA OUTSIDE TRY BLOCK
        const isBuy = action === 'BUY';
        const rawAmount = sizeUsd / currentPrice;
        const multiplier = Math.pow(10, decimals);
        const amount = Math.floor(rawAmount * multiplier) / multiplier; // Now scoped for catch

        if (amount <= 0) return { success: false, error: "Size too small" };

        const slippage = reduceOnly ? 0.10 : 0.05;
        const rawLimitPx = isBuy ? currentPrice * (1 + slippage) : currentPrice * (1 - slippage);
        function toSigFigs(n: number, sig: number) {
            if (n === 0) return 0;
            const mult = Math.pow(10, sig - Math.floor(Math.log10(Math.abs(n))) - 1);
            return Math.round(n * mult) / mult;
        }
        const limitPx = toSigFigs(rawLimitPx, 5);
        const tif = reduceOnly ? 'Ioc' : 'Gtc';

        const payload = {
            coin: coin,
            is_buy: isBuy,
            sz: String(amount),
            limit_px: String(limitPx),
            order_type: { limit: { tif: tif } },
            reduce_only: reduceOnly
        };

        try {
            console.log(`[EXECUTION] Placing ${action} ${amount} ${coin} (ID: ${assetInfo.id}) @ ~${currentPrice}`);

            // LEVERAGE UPDATE (Only for OPENING trades)
            // If reduceOnly, keep existing leverage to avoid disturbing position mode.
            if (!reduceOnly) {
                try {
                    // Update to Cross Margin with specified Leverage
                    // Arg Order: (coin, isCross, leverage)
                    // FIX: SDK expects "cross" string, not boolean true
                    await this.sdk.exchange.updateLeverage(coin, "cross", leverage);
                    console.log(`[EXECUTION] Leverage set to ${leverage}x (Cross) for ${coin}`);
                } catch (levError: any) {
                    console.error(`[EXECUTION] CRITICAL: Failed to Set Leverage to ${leverage}x for ${coin}: ${levError.message}`);
                    return { success: false, error: `Leverage Set Failed: ${levError.message}` }; // ABORT TRADE
                }
            }

            logger.info(`[EXECUTION] ${reduceOnly ? 'MARKET CLOSE' : 'LIMIT OPEN'} | Price: ${currentPrice} -> Order: ${limitPx} (TIF: ${tif})`);

            const orderResult = await this.sdk.exchange.placeOrder(payload as any);

            if (orderResult.status === 'ok') {
                logger.info(`[EXECUTION] Trade Success: ${coin} ${action} (OID: ${orderResult.response?.oid})`);
                const statuses = orderResult.response?.data?.statuses || [];
                if (statuses.length > 0 && statuses[0]?.error) {
                    console.error("[EXECUTION] LOGICAL ERROR:", statuses[0].error);
                    return { success: false, error: statuses[0].error };
                }

                // ---------------------------------------------------------
                // CHAINED SAFETY: Place ON-CHAIN Stop Loss / Take Profit
                // ---------------------------------------------------------
                if (!reduceOnly && options) {
                    if (options.stopLossPrice) {
                        try {
                            const slResult = await this.executeTriggerOrder(symbol, !isBuy, amount, options.stopLossPrice, 'sl');
                            if (slResult.success) logger.info(`[EXECUTION] 🛡️ STOP LOSS ARMING COMPLETE @ $${options.stopLossPrice}`);
                            else logger.warn(`[EXECUTION] ⚠️ FAILED TO ARM STOP LOSS: ${slResult.error}`);
                        } catch (slEx) { logger.warn(`[EXECUTION] SL ERROR`, slEx); }
                    }
                    if (options.takeProfitPrice) {
                        try {
                            const tpResult = await this.executeTriggerOrder(symbol, !isBuy, amount, options.takeProfitPrice, 'tp');
                            if (tpResult.success) logger.info(`[EXECUTION] 🎯 TAKE PROFIT ARMING COMPLETE @ $${options.takeProfitPrice}`);
                        } catch (tpEx) { logger.warn(`[EXECUTION] TP ERROR`, tpEx); }
                    }
                }

                return {
                    success: true,
                    txHash: orderResult.response?.oid?.toString(),
                    filledPrice: currentPrice,
                    filledSize: amount
                };
            } else {
                return { success: false, error: JSON.stringify(orderResult) };
            }

        } catch (e: any) {
            // RETRY ONCE FOR Rate Limit (429)
            if (String(e).includes('429') || e?.code === 429) {
                console.warn("[EXECUTION] Rate Limit (429) Hit. Retrying in 1000ms...");
                await new Promise(r => setTimeout(r, 1000));
                try {
                    // Re-run SDK call
                    const orderResultRetry = await this.sdk.exchange.placeOrder(payload as any);
                    if (orderResultRetry.status === 'ok') {
                        logger.info(`[EXECUTION] Trade Success (Retry): ${coin} ${action}`);
                        return { success: true, txHash: orderResultRetry.response?.oid?.toString(), filledPrice: currentPrice, filledSize: amount };
                    }
                } catch (retryError) {
                    console.error("[EXECUTION] Retry Failed:", retryError);
                    return { success: false, error: String(retryError) };
                }
            }

            console.error("[EXECUTION] Trade Failed", e);
            return { success: false, error: String(e) };
        }
    }

    public async executeTriggerOrder(
        symbol: string,
        isBuy: boolean, // Action to CLOSE the position (e.g. if Long, isBuy=false)
        size: number,
        triggerPrice: number,
        type: 'tp' | 'sl'
    ): Promise<ExecutionResult> {
        if (!this.isReady || !this.sdk) return { success: false, error: "Engine not ready" };

        const coin = symbol.replace("USDT", "");
        let assetInfo = this.assetIdMap.get(coin);
        if (!assetInfo) assetInfo = this.assetIdMap.get(`${coin}-PERP`);
        if (!assetInfo) return { success: false, error: "Asset missing" };

        console.log(`[EXECUTION] Placing TRIGGER ${type.toUpperCase()} for ${coin} @ $${triggerPrice}`);

        // Construct Trigger Payload
        const payload = {
            coin: coin,
            is_buy: isBuy,
            sz: String(size),
            limit_px: String(triggerPrice), // Market orders use this as trigger ref? Or just 'triggerPx'
            order_type: {
                trigger: {
                    triggerPx: String(triggerPrice),
                    isMarket: true, // HARD STOP (Guaranteed Exit)
                    tpsl: type
                }
            },
            reduce_only: true // CRITICAL: Stop cannot open new position
        };

        let attempt = 0;
        const maxAttempts = 10; // Wait up to 10 seconds for fill

        while (attempt < maxAttempts) {
            try {
                const res = await this.sdk.exchange.placeOrder(payload as any);
                if (res.status === 'ok') {
                    const statuses = res.response?.data?.statuses || [];
                    if (statuses.length > 0 && statuses[0]?.error) {
                        const err = statuses[0].error;
                        // Retry on specific errors that imply "Position Not Ready"
                        if (err.includes('margin') || err.includes('reduce-only') || err.includes('asset=')) {
                            console.warn(`[EXECUTION] Trigger Rejected (Likely No Pos): ${err}. Retrying ${attempt + 1}/${maxAttempts}...`);
                            await new Promise(r => setTimeout(r, 1000));
                            attempt++;
                            continue;
                        }
                        return { success: false, error: err };
                    }
                    return { success: true, txHash: res.response?.oid?.toString() };
                }
                return { success: false, error: JSON.stringify(res) };
            } catch (e: any) {
                console.warn(`[EXECUTION] Trigger Exception: ${e.message}. Retrying...`);
                await new Promise(r => setTimeout(r, 1000));
                attempt++;
            }
        }
        return { success: false, error: "Max Retries Exceeded (Position never filled?)" };
    }


}
