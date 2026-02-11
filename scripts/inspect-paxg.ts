
import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error("No MONGODB_URI in .env.local");
    process.exit(1);
}

// Minimal Schema
const TradeSchema = new mongoose.Schema({
    symbol: String,
    status: String,
    action: String,
    size: Number,
    price: Number,
    timestamp: Number,
    exitTime: Number,
    signalSnapshot: mongoose.Schema.Types.Mixed
});

// Fix: Check models on the connection or global
const Trade = mongoose.model('Trade', TradeSchema);

async function run() {
    try {
        console.log("Connecting to Mongo...");
        await mongoose.connect(MONGODB_URI!);
        console.log("Connected.");

        const trades = await Trade.find({ symbol: { $regex: 'PAXG', $options: 'i' } });
        console.log(`\nFound ${trades.length} PAXG trades:`);

        trades.forEach((t: any) => {
            console.log(`--------------------------------------------------`);
            console.log(`ID: ${t._id}`);
            console.log(`Symbol: ${t.symbol}`);
            console.log(`Status: ${t.status}`); // <--- CRITICAL
            console.log(`Action: ${t.action}`);
            console.log(`Time: ${new Date(t.timestamp).toISOString()}`);
            if (t.exitTime) console.log(`Exit Time: ${new Date(t.exitTime).toISOString()}`);
            console.log(`Reasons:`, t.signalSnapshot?.reasons);
        });

        console.log(`\n--------------------------------------------------`);

        if (trades.length === 0) {
            console.log("-> No DB records for PAXG. This explains 'Manual / Legacy'.");
        } else {
            const open = trades.find((t: any) => t.status === 'OPEN');
            if (!open) {
                console.log("-> All PAXG trades are CLOSED in DB. But position exists on-chain.");
                console.log("   Hypothesis: Ghost Reconciliation closed it prematurely?");
            } else {
                console.log("-> We HAVE an OPEN record. Why isn't UI picking it up?");
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}

run();
