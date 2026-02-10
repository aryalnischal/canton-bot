
import { LocalWallet, BECH32_PREFIX } from '@dydxprotocol/v4-client-js';
import * as bip39 from 'bip39';

async function run() {
    console.log("🎲 Generating New dYdX v4 Testnet Wallet...");

    // Generate Mnemonic
    const mnemonic = bip39.generateMnemonic(256); // 24 words

    // Create Wallet
    const wallet = await LocalWallet.fromMnemonic(mnemonic, BECH32_PREFIX.Address);

    console.log("\n✅ Wallet Generated Successfully!");
    console.log("---------------------------------------------------");
    console.log("ADDRESS:  ", wallet.address);
    console.log("MNEMONIC: ", mnemonic);
    console.log("---------------------------------------------------");
    console.log("\nNEXT STEPS:");
    console.log("1. Copy the MNEMONIC string above.");
    console.log("2. Open .env.local and replace DYDX_MNEMONIC.");
    console.log("3. Fund this wallet using the Faucet:");
    console.log("   https://v4.testnet.dydx.exchange/portfolio (Click 'Deposit' -> 'Faucet')");
}

run();
