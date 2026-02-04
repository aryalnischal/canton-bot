
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    try {
        const state = await sdk.info.perpetuals.getClearinghouseState(wallet.address);
        console.log("💰 Margie:", state.marginSummary);
        console.log("POSITIONS:");
        state.assetPositions.forEach((p: any) => {
            const s = parseFloat(p.position.szi);
            if (s !== 0) console.log(` - ${p.position.coin}: ${s} (Val: $${parseFloat(p.position.positionValue).toFixed(2)})`);
        });
    } catch (e) {
        console.error(e);
    }
}
run();
