import mongoose from 'mongoose';
import dbConnect from './src/lib/db.ts';
import Trade from './src/models/Trade.ts';
import Log from './src/models/Log.ts';
import Analysis from './src/models/Analysis.ts';

async function factoryReset() {
    console.log("⚠️ STARTING FACTORY RESET...");
    await dbConnect();

    console.log("🔥 Wiping TRADES...");
    await Trade.deleteMany({});

    console.log("🔥 Wiping LOGS...");
    await Log.deleteMany({});

    console.log("🔥 Wiping ANALYTICS...");
    await Analysis.deleteMany({});

    // Optional: Reset Signals if we had a model
    // await Signal.deleteMany({});

    console.log("✅ FACTORY RESET COMPLETE.");
    process.exit(0);
}

factoryReset().catch(e => {
    console.error("❌ RESET FAILED", e);
    process.exit(1);
});
