import { NextResponse } from 'next/server';

export async function GET(req: Request) {
    try {
        const { default: dbConnect } = await import('@/lib/db');
        const { default: Trade } = await import('@/models/Trade');
        await dbConnect();

        const url = new URL(req.url);
        const from = url.searchParams.get('from');  // ISO date string or timestamp
        const to = url.searchParams.get('to');      // ISO date string or timestamp
        const limit = parseInt(url.searchParams.get('limit') || '50');

        // Build query
        const query: any = { status: 'CLOSED' };

        if (from || to) {
            query.exitTime = {};
            if (from) {
                const fromTs = isNaN(Number(from)) ? new Date(from).getTime() : Number(from);
                query.exitTime.$gte = fromTs;
            }
            if (to) {
                const toTs = isNaN(Number(to)) ? new Date(to).getTime() : Number(to);
                query.exitTime.$lte = toTs;
            }
        }

        const trades = await Trade.find(query)
            .sort({ exitTime: -1 })
            .limit(Math.min(limit, 200))
            .lean();

        // Aggregate stats
        const totalPnl = trades.reduce((sum: number, t: any) => sum + (t.pnlValue || 0), 0);
        const wins = trades.filter((t: any) => (t.pnlValue || 0) > 0).length;
        const losses = trades.filter((t: any) => (t.pnlValue || 0) < 0).length;
        const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

        return NextResponse.json({
            success: true,
            trades: trades.map((t: any) => ({
                symbol: t.symbol,
                action: t.action,
                entryPrice: t.price,
                exitPrice: t.exitPrice,
                size: t.size,
                leverage: t.leverage,
                pnlValue: t.pnlValue || 0,
                pnlPercent: t.pnlPercent || 0,
                exitReason: t.exitReason || 'Unknown',
                entryTime: t.entryTime || t.timestamp || t.createdAt,
                exitTime: t.exitTime,
                confidence: t.signalSnapshot?.confidence || 0,
                reasons: t.signalSnapshot?.reasons || [],
            })),
            stats: {
                total: trades.length,
                wins,
                losses,
                winRate: Math.round(winRate),
                totalPnl: parseFloat(totalPnl.toFixed(2)),
            }
        });
    } catch (e: any) {
        console.error('[TRADE HISTORY API] Error:', e);
        return NextResponse.json({ success: true, trades: [], stats: { total: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 } });
    }
}
