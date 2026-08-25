import { NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine-singleton';
import { preTradeCheck } from '@/lib/trade-guards';
import { logActivity } from '@/lib/activity-store';

// FIX #6: Shared Singleton (no more duplicate connections)
const engine = getEngine();

// CONCURRENCY LOCK (Prevent Race Conditions)
let isProcessing = false;

export async function POST(req: Request) {
    if (isProcessing) {
        console.warn("[API] ⚠️ Rejecting Concurrent Trade Request (Busy)");
        return NextResponse.json({ success: false, error: "System Busy (Concurrency Lock)" }, { status: 429 });
    }

    isProcessing = true;

    try {
        const body = await req.json();
        const { symbol, action, leverage, size } = body;

        // AUTHENTICATION GUARD
        if (!symbol || !action) {
            return NextResponse.json({ success: false, error: "Missing Parameters" }, { status: 400 });
        }

        console.log(`[API] Received Trade Request: ${action} ${symbol}`);

        // 5-LAYER PRE-TRADE GUARD (On-chain + DB + Cooldown + Max Pos + Circuit Breaker)
        if (!body.force && !body.reduceOnly) {
            const guard = await preTradeCheck(symbol, action, engine);
            if (!guard.allowed) {
                console.warn(`[GATE] ${guard.gate}: ${guard.reason}`);
                logActivity('GUARD', `Blocked ${action} ${symbol}: ${guard.reason}`, { gate: guard.gate });
                return NextResponse.json(
                    { success: false, error: guard.reason, gate: guard.gate },
                    { status: guard.gate === 'CIRCUIT_BREAKER' ? 503 : 429 }
                );
            }
        }

        const currentPriceReference = body.price || 0;
        if (currentPriceReference <= 0) {
            return NextResponse.json({ success: false, error: "Invalid Price Reference" }, { status: 400 });
        }

        // RISK MANAGEMENT: Server-Side Dynamic Sizing
        // 1. Get Real Account State (Hyperliquid)
        const accountState = await engine.getAccountState(); // Returns Subaccount
        const currentEquity = accountState ? parseFloat(accountState.equity) : 0;
        const freeCollateral = accountState ? parseFloat(accountState.freeCollateral) : 0;

        // 2. GLOBAL MARGIN CHECK (Prevent Saturation) — skip for close orders
        if (!body.reduceOnly && currentEquity > 0 && freeCollateral < 20) {
            console.warn(`[RISK] ⚠️ Rejecting Trade: Insufficient Free Collateral ($${freeCollateral.toFixed(2)} < $20).`);
            return NextResponse.json({ success: false, error: "Account Full (Insufficient Margin)" }, { status: 400 });
        }

        // === FAST PATH FOR CLOSE (reduceOnly) ===
        // Query actual position from Hyperliquid and close it — don't rely on UI size
        if (body.reduceOnly) {
            const pos = accountState?.openPositions?.[symbol];
            if (!pos || parseFloat(pos.size) === 0) {
                return NextResponse.json({ success: false, error: `No open position for ${symbol}` }, { status: 400 });
            }
            const tokenSize = Math.abs(parseFloat(pos.size));
            const posPrice = parseFloat(pos.oraclePrice || pos.entryPrice || currentPriceReference);
            const closeSizeUsd = tokenSize * posPrice;
            const closeAction = parseFloat(pos.size) > 0 ? 'SELL' : 'BUY';

            console.log(`[API] CLOSE ${symbol}: ${tokenSize} tokens × $${posPrice.toFixed(2)} = $${closeSizeUsd.toFixed(2)}`);
            const result = await engine.executeOrder(symbol, closeAction, closeSizeUsd, posPrice, 1, true);

            if (result.success) {
                // Update DB
                try {
                    const { default: dbConnect } = await import('@/lib/db');
                    const { default: Trade } = await import('@/models/Trade');
                    await dbConnect();
                    await Trade.updateMany(
                        { symbol, status: 'OPEN' },
                        { status: 'CLOSED', exitPrice: posPrice, exitTime: Date.now(), exitReason: 'Manual UI Close' }
                    );
                } catch (e) { console.warn('[API] DB update failed:', e); }
                logActivity('TRADE', `Closed ${symbol} via UI ($${closeSizeUsd.toFixed(0)})`, { symbol });
            }

            isProcessing = false;
            return NextResponse.json(result);
        }

        // === OPEN TRADE PATH ===
        // Dynamic Volatility Sizing for new positions
        const equityBasis = currentEquity > 0 ? currentEquity : 250;
        let volatility = 0.05;
        if (body.atr) {
            volatility = parseFloat(body.atr) / currentPriceReference;
        }

        const baseSizePct = 0.12;
        const refVol = 0.02;
        const volScaler = Math.min(Math.max(refVol / (volatility || 0.05), 0.2), 2.0);
        const maxSafeSize = equityBasis * baseSizePct * volScaler;

        let safeSize = size || 50;
        if (safeSize > maxSafeSize) {
            console.log(`[RISK] Clamping Size $${safeSize} -> $${maxSafeSize.toFixed(2)}`);
            safeSize = parseFloat(maxSafeSize.toFixed(2));
        }

        const slDist = Math.min(Math.max(volatility * 3, 0.05), 0.15);
        const slPrice = action === 'BUY'
            ? parseFloat((currentPriceReference * (1 - slDist)).toFixed(4))
            : parseFloat((currentPriceReference * (1 + slDist)).toFixed(4));

        const result = await engine.executeOrder(
            symbol, action, safeSize, currentPriceReference,
            leverage || 1, false,
            {
                tp: body.tp ? parseFloat(body.tp) : currentPriceReference,
                trailingPercent: body.trailingPercent,
                sl: body.sl ? parseFloat(body.sl) : slPrice
            }
        );

        // PERSISTENCE: Save to MongoDB
        if (result.success) {
            logActivity('TRADE', `${action} ${symbol} — $${safeSize.toFixed(2)} @ $${currentPriceReference}`, {
                txHash: result.txHash, leverage: leverage || 1
            });
            try {
                const { default: dbConnect } = await import('@/lib/db');
                const { default: Trade } = await import('@/models/Trade');
                await dbConnect();
                await Trade.create({
                    id: result.txHash || `TX-${Date.now()}`,
                    symbol, action,
                    price: result.filledPrice || currentPriceReference,
                    size: result.filledSize || safeSize,
                    leverage: leverage || 1,
                    status: 'OPEN',
                    txHash: result.txHash,
                    strategy: body.strategy || 'API',
                    sl: body.sl ? parseFloat(body.sl) : slPrice,
                    tp: body.tp ? parseFloat(body.tp) : undefined,
                    entryTime: Date.now(),
                    signalSnapshot: {
                        score: body.score,
                        confidence: body.confidence,
                        reasons: body.reasons || [],
                        marketState: body.marketState
                    }
                });
                console.log(`[DB] Trade Opened: ${symbol}`);
            } catch (dbEx) {
                console.error("[DB] Failed to Save Trade:", dbEx);
            }
        }

        return NextResponse.json(result);

    } catch (e) {
        console.error("[API] Trade Error", e);
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    } finally {
        isProcessing = false;
    }
}

export async function GET() {
    try {
        const { default: dbConnect } = await import('@/lib/db');
        const { default: Trade } = await import('@/models/Trade');
        await dbConnect();
        const activeTrades = await Trade.find({ status: 'OPEN' }).select('symbol strategy entryTime id action');
        return NextResponse.json({ success: true, trades: activeTrades });
    } catch (e) {
        console.warn("[API] DB Connection Error (Returning Empty List)", e);
        // Return 200 with empty list to allow UI to function even if DB is down
        return NextResponse.json({ success: true, trades: [] });
    }
}
