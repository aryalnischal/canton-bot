import { ethers } from "ethers";
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config({ path: '.env.local' });

const HL_API = "https://api.hyperliquid.xyz/exchange";

async function closeTia() {
    const privateKey = process.env.HL_PRIVATE_KEY;
    const wallet = new ethers.Wallet(privateKey!);
    const address = wallet.address;

    console.log(`💀 EMERGENCY CLOSE TIA for ${address}`);

    const payload = {
        "type": "order",
        "grouping": "na",
        "orders": [{
            "coin": "TIA",
            "is_buy": false, // We are Long (+2102), so Sell
            "sz": "2102.3",
            "limit_px": "0.45", // Deep limit to guarantee fill
            "order_type": { "limit": { "tif": "Gtc" } },
            "reduce_only": true
        }],
        "timestamp": Date.now()
    };

    // Sign
    // ... Actually implementing signature in a script is hard.
    // I should use the SDK via close-all-positions.ts or just adapt it.
    console.log("Cancelling manual script, reusing 'close-all-positions.ts' logic to target TIA.");
}
// Aborted script writing in favor of using existing robust script logic.
console.log("Use close-all-positions.ts instead.");
