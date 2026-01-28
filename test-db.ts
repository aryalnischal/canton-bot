import dbConnect from './src/lib/db.ts';
import Log from './src/models/Log.ts';
import Trade from './src/models/Trade.ts';
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testDB() {
    try {
        console.log("🔌 Connecting to DB...");
        await dbConnect();

        console.log("✅ Connected! Creating Test Log...");
        const log = await Log.create({
            level: 'info',
            message: 'DB Connection Test',
            source: 'TEST_SCRIPT',
            timestamp: Date.now()
        });
        console.log(`📝 Log Created: ${log._id} - ${log.message}`);

        console.log("✅ Creating Test Trade...");
        const trade = await Trade.create({
            id: `TEST-${Date.now()}`,
            symbol: 'BTCUSDT',
            action: 'BUY',
            price: 50000,
            size: 100,
            leverage: 1,
            strategy: 'TEST'
        });
        console.log(`💰 Trade Created: ${trade.id} (${trade.symbol})`);

        // Clean up text data
        // await Log.deleteOne({ _id: log._id });
        // await Trade.deleteOne({ id: trade.id });

        console.log("🎉 DB Test Passed!");
        process.exit(0);
    } catch (e: any) {
        console.error("❌ DB Connection Failed:", e);
        process.exit(1);
    }
}

testDB();
