
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Trade from '@/models/Trade';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        await dbConnect();

        // 1. Fetch Closed Trades
        const trades = await Trade.find({ status: 'CLOSED' }).sort({ exitTime: -1 });

        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const twoDays = 48 * 60 * 60 * 1000;

        // 2. Aggregates
        let totalPnl = 0;
        let pnl24h = 0;
        let pnl48h = 0;

        let wins24h = 0;
        let total24h = 0;

        for (const t of trades) {
            const pnl = t.pnlValue || 0;
            const exitTime = t.exitTime || t.updatedAt; // Fallback

            // Total
            totalPnl += pnl;

            // Time windows
            const timeDiff = now - new Date(exitTime).getTime();

            if (timeDiff < oneDay) {
                pnl24h += pnl;
                total24h++;
                if (pnl > 0) wins24h++;
            }

            if (timeDiff < twoDays) {
                pnl48h += pnl;
            }
        }

        const winRate24h = total24h > 0 ? (wins24h / total24h) * 100 : 0;

        return NextResponse.json({
            success: true,
            totalPnl,
            pnl24h,
            pnl48h,
            winRate24h,
            tradeCount: trades.length
        });

    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
