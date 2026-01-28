
import { Hyperliquid } from "hyperliquid";
import { Wallet } from "ethers";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkFills() {
    const pKey = process.env.HL_PRIVATE_KEY;
    const address = process.env.HL_WALLET_ADDRESS;

    if (!pKey || !address) {
        console.error("Missing Logic: ENV Keys");
        return;
    }

    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet, false); // No Testnet

    console.log(`🔍 AUDITING FILLS FOR: ${address}`);

    try {
        const fills = await sdk.info.getUserFills(address);

        // Filter for today
        const now = Date.now();
        const recent = fills.filter((f: any) => (now - f.time) < 24 * 60 * 60 * 1000);

        console.log(`Found ${recent.length} fills in last 24h.`);

        // Group by Symbol
        const grouped: Record<string, any[]> = {};
        recent.forEach((f: any) => {
            if (!grouped[f.coin]) grouped[f.coin] = [];
            grouped[f.coin].push({
                side: f.side, // 'A' ? Wait, check SDK format
                // SDK usually returns: { coin, px, sz, side, time, ... }
                // side might be 'B' or 'A' (Bid/Ask) or 'Buy'/'Sell'?
                // Actually usually 'B' = Buy, 'A' = Sell (Aggressor?) No.
                // Hyperliquid API: side is "B" (Buy) or "A" (Sell - Ask?)
                rawSide: f.side,
                price: parseFloat(f.px),
                size: parseFloat(f.sz),
                time: new Date(f.time).toLocaleTimeString()
            });
        });

        // Print Detail for CRV
        if (grouped['CRV']) {
            console.log("--- CRV ACTIVITY ---");
            console.table(grouped['CRV']);
        } else {
            console.log("--- NO CRV TRADES ON CHAIN ---");
        }

        console.log("--- ALL SYMBOLS ---");
        console.log(Object.keys(grouped));

    } catch (e) {
        console.error("Fill Audit Failed:", e);
    }
}

checkFills();
