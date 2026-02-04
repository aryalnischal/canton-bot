import { NextResponse } from 'next/server';
import { HyperliquidExecutionService } from '@/services/execution-engine';

// Singleton Instance (to keep wallet connected)
// Note: In Serverless/Next.js (Lambda), this might re-init per request. 
// For standard Node server or Vercel warm lambda, it persists briefly.
// Re-instantiating is cheap (just loading key), so it's fine.
const engine = new HyperliquidExecutionService();

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { symbol, action, leverage, size } = body;

        // AUTHENTICATION GUARD
        // In real app, check Session/JWT.
        // For this user-only tool, we assume local access is authorized,
        // OR we can add a simple "Admin Secret" header if exposed public.
        // Assuming Localhost/Vercel Private deployment.

        if (!symbol || !action) {
            return NextResponse.json({ success: false, error: "Missing Parameters" }, { status: 400 });
        }

        console.log(`[API] Received Trade Request: ${action} ${symbol}`);

        // SAFETY GATES (V27 DB CHECK)
        if (!body.force && !body.reduceOnly) { // Skip checks if FORCE or CLOSING (reduceOnly)
            try {
                // Ideally import at top, using dynamic for robustness in this block
                const { default: dbConnect } = await import('@/lib/db');
                const { default: Trade } = await import('@/models/Trade');
                await dbConnect();

                // 1. DUPLICATE CHECK
                // 1. DUPLICATE CHECK
                // Is there an OPEN trade for this symbol?
                const existing = await Trade.findOne({ symbol, status: 'OPEN' });
                if (existing) {
                    // FIX: Only block if we are doing the SAME action (e.g. Buy on Buy).
                    // If we are Selling (Closing) on an open Buy, PERMIT IT.
                    if (existing.action === action) {
                        console.warn(`[GATE] Blocked Duplicate: ${symbol} is already OPEN (ID: ${existing.id})`);
                        return NextResponse.json({ success: false, error: `Duplicate: ${symbol} is already Active.` }, { status: 400 });
                    }
                    // Else: It's a Sell on a Buy (Close/Flip) -> Allow.
                }

                // 2. COOLDOWN CHECK (Anti-Reentry)
                // New Rule (Strict): If we closed ANY trade (Win/Loss) on this symbol in last 30m, WAIT.
                // This prevents the "Infinite Loop" where bot re-buys immediately after a Close.
                const thirtyMinAgo = Date.now() - (30 * 60 * 1000);
                const recentClose = await Trade.findOne({
                    symbol,
                    status: 'CLOSED',
                    exitTime: { $gt: thirtyMinAgo }
                });

                if (recentClose) {
                    // Exception: Could add manual override flag here later.
                    const readyAt = new Date(recentClose.exitTime + (30 * 60 * 1000)).toLocaleTimeString();
                    console.warn(`[GATE] Blocked Cooldown: ${symbol} closed recently. Wait until ${readyAt}`);
                    return NextResponse.json({ success: false, error: `Cooldown: Recently active. Restricted until ${readyAt}` }, { status: 429 });
                }

                // Compatibility: We can also keep the 4h Loss check if we want EXTRA safety for losses,
                // but 30m strict is a good baseline. Let's keep 4h for LOSSES specifically?
                // Actually, strict 30m covers "immediate churn".
                // If we want to keep the "Stop Loss Punishment" (4h), we can check that separately.
                // For now, let's Stick to the Plan: 30m Strict for everything.

            } catch (gateError) {
                console.error("[GATE] DB Check Failed (Permitting Trade for Safety Fallback)", gateError);
                // Fail Open? Or Fail Closed?
                // Logic: If DB is down, we might want to allow trade to avoid paralysis, OR block.
                // Decision: Allow trade, log warning.
            }
        }

        // Get Live Price (Engine should verify, but we can pass it to speed up calculation)
        // Ideally Engine fetches fresh price.
        // Let's pass a reference price but Engine should be authoritative.
        // For simplicity in V1, we assume Engine fetches price OR we pass it from client if needed.
        // Let's assume Engine takes price for size calc for now.
        const currentPriceReference = body.price || 0;
        if (currentPriceReference <= 0) {
            return NextResponse.json({ success: false, error: "Invalid Price Reference" }, { status: 400 });
        }

        const result = await engine.executeOrder(
            symbol,
            action,
            size || 100, // Default $100 or use Env
            currentPriceReference,
            leverage || 1,
            body.reduceOnly || false,
            // OPTIONS (SL/TP)
            {
                stopLossPrice: body.sl ? parseFloat(body.sl) : undefined,
                takeProfitPrice: body.tp ? parseFloat(body.tp) : undefined
            }
        );

        // PERSISTENCE (V24): Save to MongoDB (Ledger Integrity Fix)
        if (result.success) {
            try {
                const { default: dbConnect } = await import('@/lib/db');
                const { default: Trade } = await import('@/models/Trade');
                await dbConnect();

                const isClose = body.reduceOnly; // Heuristic: reduceOnly = Closing

                if (isClose) {
                    // UPDATE EXISTING OPEN TRADE (Prevent Double Counting/Ghosts)
                    const updated = await Trade.findOneAndUpdate(
                        { symbol, status: 'OPEN' },
                        {
                            $set: {
                                status: 'CLOSED',
                                exitTime: Date.now(),
                                exitPrice: result.filledPrice || currentPriceReference,
                                // Note: PnL calculation ideally happens here or via Analyzer background job
                                // For now, we capture the Close Event accurately.
                                closeTxHash: result.txHash
                            }
                        },
                        { new: true }
                    );

                    if (updated) {
                        console.log(`[DB] Trade Closed & Updated: ${symbol} (${result.txHash})`);
                    } else {
                        // Fallback: Orphan Close (Manual or Lost Open Rec) - Create Log Record
                        console.warn(`[DB] Close Orphan: ${symbol} (No OPEN record). Saving as standalone.`);
                        await Trade.create({
                            id: result.txHash || `TX-${Date.now()}`,
                            symbol,
                            action,
                            price: result.filledPrice || currentPriceReference,
                            size: result.filledSize ? (result.filledSize * (result.filledPrice || currentPriceReference)) : (size || 100),
                            leverage: leverage || 1,
                            status: 'CLOSED', // It is closed
                            txHash: result.txHash,
                            strategy: body.strategy || 'MANUAL',
                            entryTime: Date.now(), // Estimate
                            exitTime: Date.now()
                        });
                    }

                } else {
                    // NEW OPEN TRADE
                    await Trade.create({
                        id: result.txHash || `TX-${Date.now()}`,
                        symbol,
                        action,
                        price: result.filledPrice || currentPriceReference,
                        size: result.filledSize ? (result.filledSize * (result.filledPrice || currentPriceReference)) : (size || 100),
                        leverage: leverage || 1,
                        status: 'OPEN',
                        txHash: result.txHash,
                        strategy: body.strategy || 'API',
                        sl: body.sl ? parseFloat(body.sl) : undefined,
                        tp: body.tp ? parseFloat(body.tp) : undefined,
                        entryTime: Date.now()
                    });
                    console.log(`[DB] Trade Opened: ${symbol} ${action} (${result.txHash})`);
                }

            } catch (dbEx) {
                console.error("[DB] Failed to Save Trade:", dbEx);
                // Non-critical, do not fail the response
            }
        }

        return NextResponse.json(result);

    } catch (e) {
        console.error("[API] Trade Error", e);
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
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
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}
