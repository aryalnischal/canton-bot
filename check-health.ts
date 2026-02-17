
import { HyperliquidExecutionService } from './src/services/execution-engine';
import { logger } from './src/lib/logger';
import dotenv from 'dotenv';

// Load Env
dotenv.config({ path: '.env.local' });

async function checkAccountHealth() {
    console.log("🏥 CHECKING ACCOUNT HEALTH...");

    if (!process.env.HL_PRIVATE_KEY) {
        console.error("❌ NO PRIVATE KEY");
        process.exit(1);
    }

    const engine = new HyperliquidExecutionService();

    // Wait for init
    await new Promise(r => setTimeout(r, 2000));

    // Access SDK directly if possible, or use a new method if exposed.
    // Since 'sdk' is private, we might need a getter or use 'any' cast.
    const sdk = (engine as any).sdk;

    if (!sdk) {
        console.error("❌ SDK not init");
        process.exit(1);
    }

    try {
        console.log("Fetching User State...");
        const userState = await sdk.info.getUserState(process.env.HL_WALLET_ADDRESS);

        const marginSummary = userState.marginSummary;
        const crossMarginSummary = userState.crossMarginSummary;

        console.log("\n💰 MARGIN SUMMARY:");
        console.log(JSON.stringify(marginSummary, null, 2));

        const equity = parseFloat(marginSummary.accountValue);
        const usedMargin = parseFloat(marginSummary.totalMarginUsed);

        console.log(`\n💵 Equity: $${equity.toFixed(2)}`);
        console.log(`🔒 Used Margin: $${usedMargin.toFixed(2)}`);
        console.log(`🔓 Free Margin: $${(equity - usedMargin).toFixed(2)}`);

        console.log("\n📊 OPEN POSITIONS:");
        const positions = userState.assetPositions;
        let totalNotional = 0;

        positions.forEach((p: any) => {
            const pos = p.position;
            const coin = pos.coin;
            const size = parseFloat(pos.szi);
            const val = parseFloat(pos.positionValue);
            const entry = parseFloat(pos.entryPx);

            if (size !== 0) {
                console.log(`- ${coin}: ${size} @ $${entry.toFixed(2)} (Val: $${val.toFixed(2)})`);
                totalNotional += Math.abs(val);
            }
        });

        console.log(`\n🚀 TOTAL NOTIONAL EXPOSURE: $${totalNotional.toFixed(2)}`);
        const leverage = totalNotional / equity;
        console.log(`⚡ EFFECTIVE LEVERAGE: ${leverage.toFixed(2)}x`);

    } catch (e) {
        console.error("❌ Failed to fetch state:", e);
    }

    process.exit(0);
}

checkAccountHealth();
