
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
        const target = "SUI-PERP";
        console.log(`🔍 Checking DB: ${MONGODB_URI}`);

        const allOpen = await Trade.find({ status: 'OPEN' });
        console.log(`\n📌 Found ${allOpen.length} OPEN trades:`);
        allOpen.forEach(t => console.log(` - ${t.symbol} (ID: ${t.id}, _id: ${t._id})`));

        // Attempt Close of Known Ghosts
        const ghosts = allOpen.filter(t => t.symbol === target || t.symbol === "SUI");
        if (ghosts.length > 0) {
            console.log(`\n⚠️  Purging ${ghosts.length} SUI-PERP/SUI records...`);
            const res = await Trade.updateMany(
                { _id: { $in: ghosts.map(g => g._id) } },
                { $set: { status: 'CLOSED', result: 'PURGED', exitTime: Date.now() } }
            );
            console.log(`✅ CLOSED ${res.modifiedCount} records.`);
        } else {
            console.log("\n✅ Clean (No SUI found).");
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
repair();
