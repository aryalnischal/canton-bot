
const {
    CompositeClient,
    LocalWallet,
    Network,
    BECH32_PREFIX
} = require('@dydxprotocol/v4-client-js');
const { SubaccountClient } = require('@dydxprotocol/v4-client-js');
require('dotenv').config({ path: '.env.local' });

async function main() {
    console.log("-----------------------------------------");
    console.log("🚀 VERIFYING DYDX CONNECTION (Deep Probe)");
    console.log("-----------------------------------------");

    const pk = process.env.DYDX_PRIVATE_KEY;
    const mnemonic = process.env.DYDX_MNEMONIC;
    const network = process.env.DYDX_NETWORK; // mainnet

    if (!pk && !mnemonic) {
        console.error("❌ Missing DYDX_PRIVATE_KEY or DYDX_MNEMONIC");
        process.exit(1);
    }

    console.log(`[INIT] Network: ${network}`);

    try {
        const networkConfig = network === 'mainnet' ? Network.mainnet() : Network.testnet();

        console.log("[INIT] Creating Wallet...");
        const prefix = 'dydx';
        let wallet;

        if (mnemonic) {
            console.log("[INIT] Using Mnemonic...");
            wallet = await LocalWallet.fromMnemonic(mnemonic, prefix);
        } else if (pk) {
            console.log("[INIT] Using Private Key...");
            const cleanPk = pk.startsWith('0x') ? pk.slice(2) : pk;
            wallet = await LocalWallet.fromPrivateKey(cleanPk, prefix);
        }

        console.log(`[SUCCESS] Wallet Address: ${wallet.address}`);

        console.log("[INIT] Connecting to dYdX Indexer...");
        // Increase timeout for slow indexer
        networkConfig.indexerConfig.timeout = 10000;
        const client = await CompositeClient.connect(networkConfig);

        // 1. Check Subaccounts
        console.log("\n[PROBE] Checking Subaccounts (Indexer)...");
        try {
            const response = await client.indexerClient.account.getSubaccounts(wallet.address);
            // console.log("   > Raw Response:", JSON.stringify(response)); // Uncomment if needed

            // Handle { subaccounts: [] } vs []
            const accounts = Array.isArray(response) ? response : (response.subaccounts || []);

            console.log(`   > Found ${accounts.length} active subaccounts.`);

            if (accounts.length > 0) {
                accounts.forEach(sa => {
                    console.log(`   > Subaccount #${sa.subaccountNumber}: Equity $${sa.equity}, Free Collat $${sa.freeCollateral}`);
                });
            } else {
                console.log("   > Indexer reports NO initialized subaccounts.");
            }
        } catch (e) {
            console.log("   > Indexer Query Failed:", e.message);
        }

        // 2. Check Bank Balance (L1)
        console.log("\n[PROBE] Checking L1 Bank Balance (Validator Client)...");
        try {
            // Use Module Getter
            const balances = await client.validatorClient.get.getAccountBalances(wallet.address);

            if (balances && balances.length > 0) {
                console.log("   > Wallet Balances (L1):");
                balances.forEach(b => console.log(`     - ${b.amount} ${b.denom}`));

                const usdc = balances.find(b => b.denom.includes('usdc'));
                if (usdc) {
                    const humanAmt = parseFloat(usdc.amount) / 1000000;
                    console.log(`   > *** DETECTED USDC: $${humanAmt.toFixed(2)} ***`);
                }
            } else {
                console.log("   > L1 Wallet is EMPTY.");
            }

        } catch (l1Err) {
            console.log("   > L1 Balance Check Failed:", l1Err.message);
        }

        // 3. MegaVault Probe
        console.log("\n[PROBE] Checking MegaVault Shares...");
        try {
            // Check if method exists
            if (client.validatorClient.get.getMegavaultOwnerShares) {
                const vault = await client.validatorClient.get.getMegavaultOwnerShares(wallet.address);
                console.log("   > Details:", JSON.stringify(vault, null, 2));
            } else {
                console.log("   > getMegavaultOwnerShares method not found on ValidatorClient.");
            }
        } catch (vErr) {
            console.log("   > MegaVault Query Failed:", vErr.message);
        }

    } catch (e) {
        console.error("❌ SCRIPT ERROR:", e);
    }
}

main();
