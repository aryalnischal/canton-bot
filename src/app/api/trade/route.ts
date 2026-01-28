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
                // Is there an OPEN trade for this symbol?
                const existing = await Trade.findOne({ symbol, status: 'OPEN' });
                if (existing) {
                    console.warn(`[GATE] Blocked Duplicate: ${symbol} is already OPEN (ID: ${existing.id})`);
                    return NextResponse.json({ success: false, error: `Duplicate: ${symbol} is already Active.` }, { status: 400 });
                }

                // 2. COOLDOWN CHECK (Anti-Reentry)
                // Did we Lose on this symbol in the last 4 hours?
                const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);
                const recentLoss = await Trade.findOne({
                    symbol,
                    status: 'CLOSED',
                    result: 'LOSS', // Assumes Analyzer sets this, OR we check pnlValue < 0
                    $or: [
                        { result: 'LOSS' },
                        { pnlValue: { $lt: 0 } }
                    ],
                    exitTime: { $gt: fourHoursAgo }
                });

                if (recentLoss) {
                    // EXCEPTION: Strategy Override (e.g. "Magnet" might be allowed)
                    // For now, strict block.
                    console.warn(`[GATE] Blocked Cooldown: ${symbol} Lost recently (Exit: ${new Date(recentLoss.exitTime).toLocaleTimeString()})`);
                    return NextResponse.json({ success: false, error: `Cooldown: ${symbol} recently lost. Wait 4h.` }, { status: 429 });
                }

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

        // PERSISTENCE (V24): Save to MongoDB
        if (result.success) {
            try {
                // Ideally we import at top, but for safety in this robust function:
                const { default: dbConnect } = await import('@/lib/db');
                const { default: Trade } = await import('@/models/Trade');

                await dbConnect();

                await Trade.create({
                    id: result.txHash || `TX-${Date.now()}`,
                    symbol,
                    action,
                    price: result.filledPrice || currentPriceReference,
                    size: result.filledSize ? (result.filledSize * (result.filledPrice || currentPriceReference)) : (size || 100),
                    leverage: leverage || 1,
                    status: body.reduceOnly ? 'CLOSED' : 'OPEN', // Heuristic
                    txHash: result.txHash,
                    strategy: body.strategy || 'API', // Pass this from Client
                    sl: body.sl ? parseFloat(body.sl) : undefined,
                    tp: body.tp ? parseFloat(body.tp) : undefined,
                });
                console.log(`[DB] Trade Saved: ${symbol} ${action} (${result.txHash})`);
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
