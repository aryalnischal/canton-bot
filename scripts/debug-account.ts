
import {
    CompositeClient,
    Network,
    BECH32_PREFIX,
    LocalWallet
} from '@dydxprotocol/v4-client-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    try {
        const mnemonic = process.env.DYDX_MNEMONIC;
        if (!mnemonic) throw new Error("No Mnemonic");

        // [CRITICAL FIX]: Force 'dydx' prefix. 
        // dYdX Setup Guide explicitly says to use 'dydx' prefix for mainnet.
        const wallet = await LocalWallet.fromMnemonic(mnemonic, "dydx");

        console.log("\n========================================");
        console.log("             ACCOUNT DEBUG              ");
        console.log("========================================");
        console.log(`Address:     ${wallet.address}`);
        console.log(`Mnemonic:    ${mnemonic.substring(0, 15)}...`);

        console.log("\n[1] Connecting to dYdX Mainnet (Indexer)...");
        const client = await CompositeClient.connect(Network.mainnet());

        console.log("\n[2] Checking L1 (Bank) Balances (via REST)...");
        try {
            const axios = require('axios');
            const nodes = [
                'https://dydx-api.polkachu.com',
                'https://api.dydx.nodestake.top',
                'https://dydx-mainnet-lcd.autostake.com:443'
            ];

            let balances: any[] = [];
            let nodeUsed = "";

            for (const node of nodes) {
                try {
                    const url = `${node}/cosmos/bank/v1beta1/balances/${wallet.address}`;
                    const res = await axios.get(url, { timeout: 3000 });
                    if (res.data && res.data.balances) {
                        balances = res.data.balances;
                        nodeUsed = node;
                        break;
                    }
                } catch (e) { continue; }
            }

            if (!nodeUsed) {
                console.log("   -> [WARN] Could not connect to any public REST nodes.");
            } else if (balances.length === 0) {
                console.log(`   -> [REST: ${nodeUsed}] L1 Wallet is EMPTY (No coins).`);
            } else {
                console.log(`   -> [REST: ${nodeUsed}] Results:`);
                balances.forEach((b: any) => {
                    let amount = parseFloat(b.amount);
                    let label = b.denom;

                    if (b.denom === 'ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5') {
                        label = "USDC (Noble)";
                        amount = amount / 1_000_000; // 6 decimals
                    } else if (b.denom === 'adydx') {
                        label = "DYDX";
                        amount = amount / 1_000_000_000_000_000_000; // 18 decimals
                    }

                    console.log(`      - ${amount.toFixed(4)} ${label} (${b.denom})`);

                    if (label.includes('USDC')) {
                        console.log(`      [CRITICAL]: FOUND L1 FUNDS! ($${amount.toFixed(2)})`);
                    }
                });
            }

        } catch (e: any) {
            console.error("   -> Failed to check L1:", e.message);
        }

        console.log("\n[3] Checking Indexer Subaccount 0...");
        try {
            const sub = await client.indexerClient.account.getSubaccount(wallet.address || "", 0);
            console.log("   -> FOUND!");
            console.log("   [RAW DUMP]:", JSON.stringify(sub, null, 2)); // FULL DUMP
            console.log(`      Equity: $${sub.subaccount.equity}`);
            console.log(`      Free:   $${sub.subaccount.freeCollateral}`);

            const positions = sub.subaccount.openPositions || {};
            const keys = Object.keys(positions);
            console.log(`      Active Positions: ${keys.length}`);

            for (const key of keys) {
                const p = positions[key];
                console.log(`      - [PERP] ${key}: ${p.side} ${p.size} @ $${p.entryPrice} (Upnl: ${p.unrealizedPnl})`);
            }

            // Check for Spot Assets
            const assets = sub.subaccount.assetPositions || {};
            const assetKeys = Object.keys(assets);
            console.log(`      Spot Assets: ${assetKeys.length}`);
            for (const key of assetKeys) {
                const a = assets[key];
                console.log(`      - [SPOT] ${key}: ${a.size} (Available: ${a.available})`);
            }

            // Check for Transfers (Potential Withdrawals)
            console.log("   -> Checking Transfers...");
            const transfersRes = await client.indexerClient.account.getSubaccountTransfers(wallet.address || "", 0, 20);
            const transfers = transfersRes.transfers || [];
            console.log(`      Found ${transfers.length} Transfers.`);
            for (const t of transfers) {
                console.log(`      - [${t.type}] ${t.size} ${t.ticker || 'USDC'} (${t.status}) To: ${t.recipient || '?'}`);
            }

        } catch (e: any) {
            console.log("Error checking account details:", e.message);
        }

        console.log("========================================\n");
    } catch (e) {
        console.error(e);
    }
}

main();
