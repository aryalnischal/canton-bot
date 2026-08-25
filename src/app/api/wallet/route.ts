import { NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine-singleton';

// FIX #6: Shared Singleton (no more duplicate connections)
const engine = getEngine();

export async function GET() {
    try {
        // 1. Get Account State from Hyperliquid
        const subaccount = await engine.getAccountState();

        if (!subaccount) {
            return NextResponse.json({
                success: false,
                error: "Hyperliquid Connection Failed or Still Initializing",
                equity: 0,
                positions: []
            }, { status: 200 }); // Return 200 to keep UI alive (Startups)
        }

        // 2. Map Hyperliquid State to Frontend Format
        const equity = parseFloat(subaccount.equity || '0');
        const freeCollateral = parseFloat(subaccount.freeCollateral || '0');

        // [NEW] Fetch Context from DB (Reasoning)
        let dbTrades: any[] = [];
        try {
            const { default: dbConnect } = await import('@/lib/db');
            const { default: Trade } = await import('@/models/Trade');
            await dbConnect();
            dbTrades = await Trade.find({ status: 'OPEN' }).lean();
        } catch (dbErr) {
            console.warn("[WALLET] Failed to fetch DB context:", dbErr);
        }

        // Map Positions
        const positions = Object.entries(subaccount.openPositions || {}).map(([market, pos]: [string, any]) => {
            const size = parseFloat(pos.size);
            const side = pos.side; // 'BUY' or 'SELL'
            const signedSize = side === 'SELL' ? -size : size;
            const coin = market.split('-')[0]; // "BTC-USD" -> "BTC"

            // Match DB Trade
            const dbMatch = dbTrades.find(t => t.symbol === market || t.symbol === coin);
            const reasoning = dbMatch?.signalSnapshot?.reasons || [];
            const score = dbMatch?.signalSnapshot?.score || 0;

            return {
                position: {
                    coin: coin,
                    szi: signedSize.toString(),
                    entryPx: pos.entryPrice,
                    unrealizedPnl: pos.unrealizedPnl || 0,
                    leverage: dbMatch?.leverage || 3,
                    // Context from trade signal
                    reasoning: reasoning,
                    score: score,
                    confidence: dbMatch?.signalSnapshot?.confidence || 0,
                    action: dbMatch?.action || (signedSize > 0 ? 'BUY' : 'SELL'),
                    market: market,
                    side: signedSize > 0 ? 'LONG' : 'SHORT',
                    oraclePrice: pos.entryPrice,
                    size: pos.size,
                }
            };
        });

        return NextResponse.json({
            success: true,
            equity,
            freeCollateral,
            positions,
            address: subaccount.address || 'unknown'
        });

    } catch (e: any) {
        console.error("[WALLET_API] Error:", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
