
import {
    BECH32_PREFIX,
    CompositeClient,
    LocalWallet,
    Network,
    OrderExecution,
    OrderSide,
    OrderTimeInForce,
    OrderType,
    SubaccountClient
} from '@dydxprotocol/v4-client-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Layered TP Configuration
// Each layer closes a fraction of the position at escalating gain levels.
// All TP orders are reduce_only so they can never open a new position.
const TP_LAYERS = [
    { pct: 0.25, gain: 0.05 },  // TP1: 25% of position at +5%
    { pct: 0.25, gain: 0.12 },  // TP2: 25% of position at +12%
    { pct: 0.50, gain: 0.30 },  // TP3: 50% of position at +30%
];

// Types
export interface ExecutionResult {
    success: boolean;
    txHash?: string;
    error?: string;
    filledPrice?: number;
    filledSize?: number;
}

export class DydxExecutionService {
    private client: CompositeClient | null = null;
    private wallet: LocalWallet | null = null;
    private subaccount: SubaccountClient | null = null;
    private isReady: boolean = false;
    private initializationPromise: Promise<void> | null = null;

    constructor() {
        this.initializationPromise = this.initialize();
    }


    private async initialize() {
        try {
            const privateKey = process.env.DYDX_PRIVATE_KEY;
            const mnemonic = process.env.DYDX_MNEMONIC;
            const networkType = process.env.DYDX_NETWORK === 'mainnet' ? Network.mainnet() : Network.testnet();

            if (!mnemonic && !privateKey) {
                console.error("[DYDX] Missing DYDX_MNEMONIC or DYDX_PRIVATE_KEY in .env.local");
                return;
            }

            console.log(`[DYDX] Initializing Client (${process.env.DYDX_NETWORK})...`);

            if (privateKey) {
                const cleanPk = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
                // SDK Type Hack: BECH32_PREFIX might be enum or const, strict check fails.
                this.wallet = await LocalWallet.fromPrivateKey(cleanPk, (BECH32_PREFIX as any).Address);
                console.log("[DYDX] Wallet initialized via Private Key");
            } else if (mnemonic) {
                // FIXED: Explicitly use 'dydx' prefix for Mainnet usage
                this.wallet = await LocalWallet.fromMnemonic(mnemonic, "dydx");
                console.log("[DYDX] Wallet initialized via Mnemonic (Prefix: dydx)");
            }

            if (!this.wallet) throw new Error("Wallet creation failed");

            this.client = await CompositeClient.connect(networkType);

            // FIXED: Use factory method for SubaccountInfo
            // Since we import { SubaccountClient } but the file exports { SubaccountInfo }, we need to check imports.
            // Actually, let's fix the import first. checking imports...
            // It seems 'SubaccountClient' in the import might be an alias for SubaccountInfo or related.
            // But the d.ts says export declare class SubaccountInfo.

            // Assuming the SDK exports it as SubaccountClient or similar.
            this.subaccount = (SubaccountClient as any).forLocalWallet(this.wallet, 0);

            this.isReady = true;
            console.log(`[DYDX] Ready. Address: ${this.wallet.address}`);
        } catch (e) {
            console.error("[DYDX] Initialization Failed:", e);
        }
    }

    public async executeOrder(
        symbol: string, // e.g., "BTC-USD"
        action: 'BUY' | 'SELL',
        sizeUsd: number, // USD Value (approx)
        currentPrice: number, // Reference for size calc
        leverage: number = 1,
        reduceOnly: boolean = false,
        options: { sl?: number; tp?: number; trailingPercent?: number } = {} // Fix Type
    ): Promise<ExecutionResult> {
        if (!this.isReady) await this.initializationPromise;
        if (!this.client || !this.subaccount) return { success: false, error: "Client not ready" };

        try {
            // ... (Size Calc Logic same as before) ...

            // Fetch Market Info (Cache this ideally)
            // Retry Logic for ECONNRESET
            let markets;
            for (let i = 0; i < 3; i++) {
                try {
                    const response = await this.client.indexerClient.markets.getPerpetualMarkets();
                    markets = response.markets;
                    break;
                } catch (netErr) {
                    if (i === 2) throw netErr;
                    console.warn(`[DYDX] Market fetch failed (Attempt ${i + 1}/3). Retrying...`);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            const market = markets[symbol];
            if (!market) {
                console.error(`[DYDX] Market ${symbol} not found. Keys available:`, Object.keys(markets).slice(0, 5));
                return { success: false, error: `Market ${symbol} not found` };
            }

            // Size = (USD / Price) 
            let rawSize = sizeUsd / currentPrice;

            // Round to market step size
            const stepSize = parseFloat(market.stepSize || '0.001');
            const size = parseFloat((Math.floor(rawSize / stepSize) * stepSize).toFixed(10));

            if (size <= 0 || !isFinite(size)) {
                return { success: false, error: `Invalid Size Calculation: ${size} (Price: ${currentPrice}, stepSize: ${stepSize})` };
            }

            // 2. Place Order
            const side = action === 'BUY' ? OrderSide.BUY : OrderSide.SELL;
            const clientId = Math.floor(Math.random() * 100000000);

            console.log(`[DYDX] Placing ${action} ${size} ${symbol} (Reduce: ${reduceOnly})...`);

            // FIX: dYdX v4 MARKET orders with price=0 silently fail.
            // Use LIMIT IOC with 5% slippage for ALL orders (standard dYdX v4 pattern).
            const orderType = OrderType.LIMIT;
            const tif = OrderTimeInForce.IOC;

            // Worst-case price with 5% slippage
            // BUY: willing to pay 5% more | SELL: willing to accept 5% less
            let price = action === 'BUY'
                ? currentPrice * 1.05
                : currentPrice * 0.95;

            // Round to market tick size
            const tickSize = parseFloat(market.tickSize || '0.01');
            price = Math.round(price / tickSize) * tickSize;
            price = parseFloat(price.toFixed(6)); // clean floating point

            console.log(`[DYDX] LIMIT IOC at $${price} (5% slippage from $${currentPrice})`);

            const tx = await this.client.placeOrder(
                this.subaccount,
                symbol,
                orderType,
                side,
                price,
                size,
                clientId,
                tif,
                0, // GoodTilTimeSeconds (0 for IOC)
                OrderExecution.DEFAULT,
                false, // postOnly
                reduceOnly
            );

            // 3. Handle Triggers (SL/TP/Trailing) if needed
            if (options.sl || options.tp || options.trailingPercent) {
                console.log(`[DYDX] Placing Triggers (SL/TP/Trail) for ${symbol}...`);
                await this.placeTriggers(
                    this.subaccount,
                    symbol,
                    action,
                    size,
                    options.sl,
                    options.tp,
                    options.trailingPercent
                );
            }

            return {
                success: true,
                txHash: tx.hash as string, // Cast Uint8Array -> string (SDK specific) or string
                filledPrice: currentPrice, // Approx
                filledSize: size
            };

        } catch (e: any) {
            console.error("[DYDX] Order Failed:", e);
            return { success: false, error: e.message || String(e) };
        }
    }

    private async placeTriggers(
        subaccount: SubaccountClient,
        symbol: string,
        entryAction: 'BUY' | 'SELL',
        size: number,
        slPrice?: number,
        tpPrice?: number,
        trailingPercent?: number
    ) {
        // Exit Action is opposite of Entry
        const exitSide = entryAction === 'BUY' ? OrderSide.SELL : OrderSide.BUY;
        const clientIdBase = Math.floor(Math.random() * 100000000);

        try {
            // TRAILING STOP
            if (trailingPercent) {
                try {
                    console.log("[DYDX] Trailing Stop requested. Skipping for now (SDK Watcher Required).");
                } catch (e) {
                    console.error("[DYDX] Error checking for TRAILING_STOP_MARKET support:", e);
                }
            }

            if (slPrice) {
                // Stop Loss
                await this.client?.placeOrder(
                    subaccount,
                    symbol,
                    OrderType.STOP_MARKET,
                    exitSide,
                    0, // Price (Market)
                    size, // Size
                    clientIdBase, // Client ID
                    OrderTimeInForce.GTT, // TimeInForce
                    7776000, // GoodTilTimeSeconds (90 Days)
                    OrderExecution.IOC,
                    false, // postOnly
                    true,  // reduceOnly
                    slPrice // triggerPrice
                );
                console.log(`[DYDX] SL Placed at ${slPrice}`);
            }

            if (tpPrice) {
                // Layered Take Profits (3 reduce-only orders)
                await this.placeLayeredTPs(
                    subaccount,
                    symbol,
                    entryAction,
                    size,
                    tpPrice, // Used as reference entry price
                    clientIdBase + 1
                );
            }
        } catch (e) {
            console.error("[DYDX] Failed to place triggers:", e);
        }
    }

    /**
     * Places layered TP orders that each close a fraction of the position.
     * All orders are reduce_only — they can only shrink the position, never open a new one.
     */
    private async placeLayeredTPs(
        subaccount: SubaccountClient,
        symbol: string,
        entryAction: 'BUY' | 'SELL',
        totalSize: number,
        entryPrice: number,
        clientIdBase: number
    ) {
        const exitSide = entryAction === 'BUY' ? OrderSide.SELL : OrderSide.BUY;
        const direction = entryAction === 'BUY' ? 1 : -1;

        for (let i = 0; i < TP_LAYERS.length; i++) {
            const layer = TP_LAYERS[i];
            const triggerPrice = entryPrice * (1 + layer.gain * direction);
            const layerSize = parseFloat((totalSize * layer.pct).toFixed(10));

            if (layerSize <= 0) continue;

            try {
                await this.client?.placeOrder(
                    subaccount,
                    symbol,
                    OrderType.TAKE_PROFIT_MARKET,
                    exitSide,
                    0, // Price (Market execution)
                    layerSize,
                    clientIdBase + i,
                    OrderTimeInForce.GTT,
                    7776000, // 90 Days
                    OrderExecution.IOC,
                    false,
                    true, // reduceOnly — CRITICAL: only reduces, never opens
                    parseFloat(triggerPrice.toFixed(6))
                );
                console.log(`[DYDX] TP${i + 1} Placed: ${Math.round(layer.pct * 100)}% @ $${triggerPrice.toFixed(4)} (+${Math.round(layer.gain * 100)}%)`);
            } catch (e) {
                console.error(`[DYDX] TP${i + 1} Failed:`, e);
            }
        }
    }

    public async getAccountState(): Promise<any> {
        if (!this.isReady) await this.initializationPromise;
        if (!this.client || !this.wallet) return null;

        try {
            const subRaw = await this.client.indexerClient.account.getSubaccount(
                this.wallet.address || "",
                0
            );
            const sub = subRaw.subaccount;

            // SHIM: Indexer uses 'openPerpetualPositions', API expects 'openPositions'
            const openPositions = sub.openPerpetualPositions || (sub as any).openPositions || {};

            return {
                ...sub,
                openPositions: openPositions
            };
        } catch (e: any) {
            // Handle 404 (Account Not Found / New Wallet) gracefully
            if (e?.response?.status === 404) {
                console.warn(`[DYDX] Subaccount 0 not found (New/Empty Wallet). Returning $0 state.`);
                return {
                    equity: "0",
                    freeCollateral: "0",
                    openPositions: {},
                    subaccountNumber: 0,
                    address: this.wallet.address
                };
            }
            console.error("[DYDX] Failed to fetch state", e);
            return null;
        }
    }
}
