
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);

async function run() {
    console.log("🕵️ CHECKING RATE LIMITS (Direct HTTP)...");
    try {
        const payload = {
            type: 'userRateLimit',
            user: wallet.address
        };

        console.log("Payload:", JSON.stringify(payload));

        const res = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            console.error(`HTTP Error: ${res.status} ${res.statusText}`);
            const txt = await res.text();
            console.error("Body:", txt);
            return;
        }

        const limits = await res.json();
        console.log("--------------------------------");
        console.log("RAW RESPONSE:");
        console.dir(limits, { depth: null });
        console.log("--------------------------------");

        if (limits.nRequestsUsed !== undefined) {
            console.log("Requests Used:", limits.nRequestsUsed);
            console.log("Requests Cap :", limits.nRequestsCap);
            console.log("Buffer Left  :", limits.nRequestsCap - limits.nRequestsUsed);
        }

    } catch (e) {
        console.error("Failed to check limits:", e);
    }
}
run();
