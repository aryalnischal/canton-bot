
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load Env
try {
    const envPath = path.resolve('.env.local');
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
} catch (e) {
    console.error("No .env.local found");
}

async function checkEntryTimes() {
    console.log("⏱️ CHECKING ENTRY TIMES...");

    const pKey = process.env.HL_PRIVATE_KEY!;
    const walletAddr = process.env.HL_WALLET_ADDRESS!;
    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet);

    try {
        // 1. Fetch Active Positions
        // Note: ClearinghouseState doesn't explicit entry time, but we can approximate via Fills or use SDK if available.
        // Actually, position object usually has 'cumFunding' which implies time, but not specific timestamp.
        // We need to fetch Fills (History) and match the OPENING trade for this position.

        const userState = await sdk.info.perpetuals.getClearinghouseState(walletAddr);
        const active = userState.assetPositions.filter((p: any) => parseFloat(p.position.szi) !== 0);

        const fills = await sdk.info.getUserFills(walletAddr);
        // Fills are typically newest first.

        console.log(`Found ${active.length} active positions. Matching with fills...`);
        console.table(active.map((p: any) => ({
            symbol: p.position.coin,
            size: p.position.szi,
            entryPx: p.position.entryPx
        })));

        const report = [];

        for (const p of active) {
            const coin = p.position.coin;
            const currentSize = parseFloat(p.position.szi);

            // Find the most recent fill that increased size in this direction? 
            // Or simply finding the LAST time we traded this coin to OPEN/INCREASE it.

            // Filter fills for this coin
            const coinFills = fills.filter((f: any) => f.coin === coin);

            // Sort by time desc
            coinFills.sort((a: any, b: any) => b.time - a.time);

            if (coinFills.length > 0) {
                const recent = coinFills[0];
                const tradeTime = new Date(recent.time);

                // Determine if this fill CREATED the position or modified it.
                // For simplicity, we assume the most recent trade is the content.

                report.push({
                    symbol: coin,
                    entryTime: tradeTime.toLocaleString(),
                    minutesAgo: Math.floor((Date.now() - recent.time) / 60000),
                    side: recent.side,
                    fillPx: recent.px
                });
            } else {
                report.push({
                    symbol: coin,
                    entryTime: "UNKNOWN (Older than fill history?)",
                    minutesAgo: 99999
                });
            }
        }

        console.table(report);

    } catch (e) {
        console.error("Entry Time Check Error:", e);
    }
}

checkEntryTimes();
