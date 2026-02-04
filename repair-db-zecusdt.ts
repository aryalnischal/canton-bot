
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/canton_db';

const TradeSchema = new mongoose.Schema({
    symbol: String,
    status: String,
    exitTime: Number,
}, { strict: false });

const Trade = mongoose.models.Trade || mongoose.model('Trade', TradeSchema);

async function repair() {
    try {
        await mongoose.connect(MONGODB_URI);
        const target = "ZECUSDT";
        console.log(`🔍 Checking ${target}...`);

        const ghosts = await Trade.find({ symbol: target, status: 'OPEN' });
        if (ghosts.length > 0) {
            console.log(`⚠️  Found ${ghosts.length} OPEN ${target} records!`);
            const res = await Trade.updateMany(
                { symbol: target, status: 'OPEN' },
                { $set: { status: 'CLOSED', result: 'PURGED', exitTime: Date.now() } }
            );
            console.log(`✅ CLOSED ${res.modifiedCount} records.`);
        } else {
            console.log("✅ Clean.");
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
repair();
