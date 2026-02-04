
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function getClearinghouseStateWithRetry(attempts = 1): Promise<any> {
    try {
        return await sdk.info.perpetuals.getClearinghouseState(wallet.address);
    } catch (e: any) {
        if (attempts <= 5 && (String(e).includes('429') || e?.code === 429)) {
            const delay = Math.pow(2, attempts) * 1000;
            console.warn(`⚠️ Rate Limit (429). Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return getClearinghouseStateWithRetry(attempts + 1);
        }
        throw e;
    }
}

async function run() {
    try {
        console.log("🔍 FETCHING ACCOUNT STATE (Robust Mode)...");
        const state = await getClearinghouseStateWithRetry();
        const summary = state.marginSummary;

        console.log("-----------------------------------------");
        console.log(`💰 Account Value: $${parseFloat(summary.accountValue).toFixed(2)}`);
        console.log(`💵 Total Margin:  $${parseFloat(summary.totalMarginUsed).toFixed(2)}`);
        console.log(`🛡️ Margin Free:   $${(parseFloat(summary.accountValue) - parseFloat(summary.totalMarginUsed)).toFixed(2)}`);
        console.log("-----------------------------------------");

        const positions = state.assetPositions;
        const active = positions.filter((p: any) => parseFloat(p.position.szi) !== 0);

        if (active.length > 0) {
            console.log(`🟢 ACTIVE POSITIONS (${active.length}):`);
            active.forEach((p: any) => {
                const pos = p.position;
                const size = parseFloat(pos.szi);
                const entry = parseFloat(pos.entryPx);
                const pnl = parseFloat(pos.unrealizedPnl);
                const val = Math.abs(size * entry); // Approx value
                const roe = (pnl / (val / 20)) * 100; // Rough ROE estimate assuming 20x, but we use 1x mostly.

                console.log(`   • ${pos.coin} ${size > 0 ? 'LONG' : 'SHORT'} x${pos.leverage.value}`);
                console.log(`     Size: ${size} (~$${val.toFixed(2)})`);
                console.log(`     Entry: $${entry.toFixed(4)}`);
                console.log(`     PnL: $${pnl.toFixed(2)}`);
            });
        } else {
            console.log("⚪ No Active Positions.");
        }
    } catch (e) {
        console.error("Audit Failed:", e);
    }
}

run();
