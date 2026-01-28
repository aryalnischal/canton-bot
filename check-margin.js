
const { Hyperliquid } = require('hyperliquid');
require('dotenv').config({ path: '.env.local' });

async function checkMargin() {
    const pk = process.env.HL_PRIVATE_KEY;
    const wallet = process.env.HL_WALLET_ADDRESS;

    if (!pk || !wallet) {
        console.error("Missing Keys");
        process.exit(1);
    }

    const sdk = new Hyperliquid(pk, false); // Mainnet

    try {
        console.log("Fetching Clearinghouse State...");
        const state = await sdk.info.perpetuals.getClearinghouseState(wallet);

        const marginSummary = state.marginSummary;
        const withdrawable = state.withdrawable;
        const totalEquity = parseFloat(marginSummary.accountValue);
        const totalMarginUsed = parseFloat(marginSummary.totalMarginUsed);

        console.log("\n💰 ACCOUNT BALANCE REPORT 💰");
        console.log("--------------------------------");
        console.log(`Total Equity:      $${totalEquity.toFixed(2)}`);
        console.log(`Margin Used:       $${totalMarginUsed.toFixed(2)}`);
        console.log(`Free Margin:       $${(totalEquity - totalMarginUsed).toFixed(2)}`);
        console.log(`Withdrawable:      $${withdrawable}`);
        console.log("--------------------------------");

        console.log("\nOPEN POSITIONS:");
        state.assetPositions.forEach(p => {
            const size = parseFloat(p.position.szi);
            if (size !== 0) {
                const coin = p.position.coin;
                const entry = parseFloat(p.position.entryPx);
                const val = size * entry;
                console.log(`- ${coin}: Size ${size} ($${val.toFixed(2)}) | Lev: ${JSON.stringify(p.position.leverage)}`);
            }
        });

    } catch (e) {
        console.error("Error:", e);
    }
}

checkMargin();
