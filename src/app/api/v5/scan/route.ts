
import { NextResponse } from 'next/server';
import { ScannerService } from '@/services/scanner';
import { logActivity } from '@/lib/activity-store';

// Cache
const CACHE_TTL = 5 * 60 * 1000;  // 5 min — longer TTL prevents dashboard scans from competing with headless bot
let cache = {
    data: null as any,
    timestamp: 0
};

// Singleton Scanner
const scanner = new ScannerService();

export async function GET() {
    try {
        const now = Date.now();
        if (cache.data && (now - cache.timestamp < CACHE_TTL)) {
            // Log cached data so activity feed shows real numbers
            const cached = cache.data;
            const cachedSignals = cached.signals || [];
            const cachedActionable = cachedSignals.filter((s: any) => s.action !== 'NEUTRAL');
            logActivity('SCAN', `Scanned ${cachedSignals.length} markets → ${cachedActionable.length} actionable signals (cached)`, {
                total: cachedSignals.length,
                actionable: cachedActionable.map((s: any) => `${s.action} ${s.symbol}`)
            });
            return NextResponse.json(cache.data);
        }

        // 0. DUPLICATE GUARD (Fetch Active Trades from DB)
        let openSymbols = new Set<string>();
        try {
            const { default: dbConnect } = await import('@/lib/db');
            const { default: Trade } = await import('@/models/Trade');
            await dbConnect();
            const activeTrades = await Trade.find({ status: 'OPEN' }).select('symbol');
            activeTrades.forEach((t: any) => openSymbols.add(t.symbol));
        } catch (dbErr) {
            console.warn("[API] Local DB Offline: Skipping Duplicate Check (Scanning continues...)");
        }

        // 1. Run Scan via Service
        // Limit to Top 3 for Dashboard Speed (Avoids Vercel/Next Timeout with 1500ms delay)
        const { markets, signals } = await scanner.scanMarkets(3);

        // 2. Apply API-Specific Filtering (Duplicate Guard)
        const filteredSignals = signals.map(consensus => {
            if (openSymbols.has(consensus.symbol) && consensus.action !== 'NEUTRAL') {
                return {
                    ...consensus,
                    action: 'NEUTRAL',
                    reasons: [...consensus.reasons, "🛡️ Duplicate Guard: Already Open"]
                };
            }
            return consensus;
        });

        const payload = {
            success: true,
            markets: markets,
            signals: filteredSignals,
            timestamp: Date.now()
        };

        // Only log if we actually got results (avoid misleading "0 markets" on rate-limit failures)
        if (filteredSignals.length > 0) {
            const actionable = filteredSignals.filter((s: any) => s.action !== 'NEUTRAL');
            logActivity('SCAN', `Scanned ${filteredSignals.length} markets → ${actionable.length} actionable signals`, {
                symbols: filteredSignals.map((s: any) => s.symbol),
                total: filteredSignals.length,
                actionable: actionable.map((s: any) => `${s.action} ${s.symbol} (${(s.confidence * 100).toFixed(0)}%)`)
            });
        } else {
            logActivity('SCAN', `Scanner returned 0 targets (rate-limited or low volatility)`, {});
        }

        cache = { data: payload, timestamp: Date.now() };
        return NextResponse.json(payload);

    } catch (e: any) {
        console.error("[API] Scan Error", e);
        logActivity('SCAN', `Scan failed: ${String(e).substring(0, 100)}`, {});
        return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
    }
}

