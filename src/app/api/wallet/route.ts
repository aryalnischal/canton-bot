import { NextResponse } from 'next/server';

const HL_API = "https://api.hyperliquid.xyz/info";

// CACHE: Simple in-memory cache to prevent Rate Limits (429)
let CACHE = {
    data: null as any,
    timestamp: 0
};
const CACHE_TTL = 2000; // 2 Seconds minimum between calls

export async function GET() {
    try {
        const walletAddress = process.env.HL_WALLET_ADDRESS;
        if (!walletAddress) {
            return NextResponse.json({ success: false, error: "Wallet Not Configured" }, { status: 500 });
        }

        // 1. CACHE HIT
        if (CACHE.data && (Date.now() - CACHE.timestamp < CACHE_TTL)) {
            // console.log("[WALLET_API] Serving Cache (Debounce)");
            return NextResponse.json(CACHE.data);
        }

        // 2. FETCH FRESH
        const res = await fetch(HL_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "clearinghouseState",
                user: walletAddress
            }),
            cache: 'no-store'
        });

        // HANDLE 429 (Rate Limit) -> Serve Stale if available
        // HANDLE 429 (Rate Limit) -> Serve Stale if available
        if (res.status === 429) {
            if (CACHE.data) {
                console.warn("[WALLET_API] HL Rate Limit (429). Serving Stale Data (Success).");
                return NextResponse.json(CACHE.data);
            }
            console.error("[WALLET_API] HL Rate Limit (429). No Cache Available.");
            // Return 200 with error to prevent Client-Side Retry Loops or Red Screens
            return NextResponse.json({ success: false, error: "HL Rate Limit (429) - Warming Up", code: "RATE_LIMIT" }, { status: 200 });
        }

        if (!res.ok) {
            const txt = await res.text();
            console.error("[WALLET_API] HL Error:", res.status, txt);
            // Non-critical: return stale if possible
            if (CACHE.data) return NextResponse.json(CACHE.data);
            throw new Error(`HL API Error: ${res.status}`);
        }

        const data = await res.json();

        if (!data.marginSummary) {
            console.error("[WALLET_API] Unexpected Data:", JSON.stringify(data).substring(0, 200));
            // Fallback
            return NextResponse.json({
                success: true,
                equity: 0,
                marginUsed: 0,
                pnl: 0,
                positions: [],
                warning: "API_DATA_MALFORMED"
            });
        }

        const equity = parseFloat(data.marginSummary.accountValue);
        const marginUsed = parseFloat(data.marginSummary.totalMarginUsed);

        const responseData = {
            success: true,
            address: walletAddress,
            equity,
            marginUsed,
            pnl: 0,
            positions: data.assetPositions
        };

        // 3. UPDATE CACHE
        CACHE = {
            data: responseData,
            timestamp: Date.now()
        };

        return NextResponse.json(responseData);

    } catch (e: any) {
        console.error("[WALLET_API] Crash:", e);
        // Fallback to Stale Cache on Crash if exists
        if (CACHE.data) {
            console.log("[WALLET_API] Recovering from crash with Stale Data");
            return NextResponse.json(CACHE.data);
        }
        return NextResponse.json({ success: false, error: e.message, code: "WALLET_FETCH_FAIL" }, { status: 200 });
    }
}
