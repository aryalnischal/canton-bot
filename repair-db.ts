
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/canton-v5';

// Define Minimal Schema
const TradeSchema = new mongoose.Schema({
    symbol: String,
    status: String,
    exitTime: Number,
    result: String,
}, { strict: false });

const Trade = mongoose.models.Trade || mongoose.model('Trade', TradeSchema);

async function repair() {
    console.log("🛠️  STARTING DB REPAIR...");

    try {
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Connected to MongoDB");

        // 1. FIX ZEC (Ghost)
        const zecTarget = "ZEC";
        console.log(`\n🔍 Checking for OPEN ${zecTarget} trades...`);
        const openZec = await Trade.find({ symbol: zecTarget, status: 'OPEN' });

        if (openZec.length > 0) {
            console.log(`⚠️  Found ${openZec.length} GHOST ${zecTarget} positions!`);
            for (const t of openZec) {
                console.log(`   - Closing Ghost: ${t._id} (Since: ${t.entryTime || 'Unknown'})`);
            }

            // Force Close
            const res = await Trade.updateMany(
                { symbol: zecTarget, status: 'OPEN' },
                {
                    $set: {
                        status: 'CLOSED',
                        exitTime: Date.now(),
                        result: 'MANUAL_FIX'
                    }
                }
            );
            console.log(`✅ Fixed ZEC: Marked ${res.modifiedCount} as CLOSED.`);
        } else {
            console.log(`✅ ZEC is Clean (No Open DB Records).`);
        }

        // 2. GENERAL CLEANUP (Optional: Close anything older than 24h that is still OPEN?)
        // Let's stick to ZEC for now to be safe.

        console.log("\n✅ REPAIR COMPLETE.");
        process.exit(0);
    } catch (e) {
        console.error("❌ Repair Failed:", e);
        process.exit(1);
    }
}

repair();
