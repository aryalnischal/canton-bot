
import { Hyperliquid } from "hyperliquid";
import { Wallet } from "ethers";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkHistory() {
    const pKey = process.env.HL_PRIVATE_KEY;
    const address = process.env.HL_WALLET_ADDRESS;

    if (!pKey || !address) {
        console.error("Missing ENV Keys");
        return;
    }

    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet, false);

    console.log(`🔍 AUDITING HISTORY FOR: ${address}`);

    try {
        // userFills returns individual fills. 
        // We need to approximate PnL by matching Opens/Closes or just dumping fills.
        const fills = await sdk.info.getUserFills(address);

        // Filter for CRV today
        const now = Date.now();
        const crvFills = fills.filter((f: any) =>
            (f.coin === 'CRV' || f.coin === 'CRV-PERP') &&
            (now - f.time) < 24 * 60 * 60 * 1000
        );

        console.log(`\nFound ${crvFills.length} CRV Fills in last 24h.`);

        let totalVolume = 0;
        let buyVol = 0;
        let sellVol = 0;
        let buyCost = 0;
        let sellRev = 0;

        crvFills.forEach((f: any) => {
            const px = parseFloat(f.px);
            const sz = parseFloat(f.sz);
            const val = px * sz;

            console.log(`[${new Date(f.time).toLocaleTimeString()}] ${f.side} ${sz.toFixed(1)} @ ${px.toFixed(4)} ($${val.toFixed(2)})`);

            if (f.side === 'B') {
                buyVol += sz;
                buyCost += val;
            } else {
                sellVol += sz;
                sellRev += val;
            }
            totalVolume += val;
        });

        console.log("\n--- PnL APPROXIMATION (FIFO Mixed) ---");
        console.log(`Total Bought: ${buyVol.toFixed(1)} CRV ($${buyCost.toFixed(2)})`);
        console.log(`Total Sold:   ${sellVol.toFixed(1)} CRV ($${sellRev.toFixed(2)})`);

        const netSize = buyVol - sellVol;
        console.log(`Net Position Change: ${netSize.toFixed(1)} CRV`);

        // Crude PnL: (Sell Revenue - Buy Cost) but strictly only works if Flat.
        // If Net Size != 0, we can't fully calc PnL without marking to market.
        const realizedPnL = sellRev - (sellVol * (buyCost / buyVol || 0)); // Avg Cost basis
        // This is very rough.

        console.log(`Realized PnL (Est): $${(sellRev - buyCost).toFixed(2)} (Cashflow raw)`);

        // Check Open Position
        const state = await sdk.info.perpetuals.getClearinghouseState(address);
        const openPos = state.assetPositions.find((p: any) => p.position.coin === 'CRV' || p.position.coin === 'CRV-PERP');

        if (openPos) {
            const p = openPos.position;
            console.log(`\n📖 CURRENT OPEN POSITION:`);
            console.log(`Size: ${p.szi} CRV`);
            console.log(`Entry: $${p.entryPx}`);
            console.log(`Unrealized PnL: $${p.unrealizedPnl}`);
        } else {
            console.log(`\n✅ NO OPEN CRV POSITION.`);
        }

    } catch (e) {
        console.error("Audit Failed:", e);
    }
}

checkHistory();
