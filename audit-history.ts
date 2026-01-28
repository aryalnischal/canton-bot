
const { Hyperliquid } = require('hyperliquid');
const { Wallet } = require('ethers');
const fs = require('fs');
const dotenv = require('dotenv');

// Load Env
try {
    const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
} catch (e) {
    console.error("No .env.local found");
}

async function auditHistory() {
    console.log("📜 AUDITING TRADE HISTORY...");

    const pKey = process.env.HL_PRIVATE_KEY;
    const walletAddr = process.env.HL_WALLET_ADDRESS;
    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet, false);

    try {
        // Fetch User's Recent Fills (Trades)
        const fills = await sdk.info.getUserFills(walletAddr);

        if (fills.length === 0) {
            console.log("No trade history found.");
            return;
        }

        console.log(`Analyzing last ${Math.min(fills.length, 50)} trades...`);

        let realizedPnL = 0;
        const closedTrades = [];

        // Group fills by closing trades (approximation) or just list them
        // Simplification: List realized PnL if available, or just the actions.
        // Actually, 'fills' usually contains price/size/side. Realized PnL is tracked in clearinghouse state or computed.
        // Let's dump the fills to see the structure first.

        // Sorting: Newest first
        fills.sort((a, b) => b.time - a.time);

        const recent = fills.slice(0, 20).map(f => ({
            time: new Date(f.time).toISOString(),
            coin: f.coin,
            side: f.side,
            px: parseFloat(f.px),
            sz: parseFloat(f.sz),
            closedPnl: f.closedPnl ? parseFloat(f.closedPnl) : "N/A"
        }));

        console.table(recent);

    } catch (e) {
        console.error("History Audit Error:", e);
    }
}

auditHistory();
