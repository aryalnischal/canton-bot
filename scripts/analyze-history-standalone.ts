
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
    exitPrice: Number,
    timestamp: Number,
    entryTime: Number,
    exitTime: Number,
    pnlValue: Number,
    pnlPercent: Number,
    exitReason: String,
    strategy: String,
    leverage: Number,
    signalSnapshot: mongoose.Schema.Types.Mixed
});

// Fix: Check models on the connection or global
const Trade = (mongoose.models && mongoose.models.Trade) || mongoose.model('Trade', TradeSchema);

async function run() {
    try {
        console.log("Connecting to Mongo...");
        await mongoose.connect(MONGODB_URI!);
        console.log("Connected.");

        // Fetch Trades for DASH-USD
        const trades = await Trade.find({ symbol: 'DASH-USD' }).sort({ entryTime: -1 });

        console.log(`\n📊 Found ${trades.length} DASH-USD Trades:\n`);

        trades.forEach((t: any) => {
            const entryTime = new Date(t.entryTime || t.timestamp).toLocaleString();
            const exitTime = t.exitTime ? new Date(t.exitTime).toLocaleString() : 'Open';
            const pnl = t.pnlValue || 0;
            const pnlPct = t.pnlPercent || 0;
            const color = pnl >= 0 ? '🟢' : '🔴';

            console.log(`${color} ${t.symbol} (${t.action}) - ${t.status}`);
            console.log(`   Entry : $${t.price} @ ${entryTime}`);
            console.log(`   Lev   : ${t.leverage}x`);
            console.log(`   Strategy: ${t.strategy}`);

            if (t.signalSnapshot) {
                console.log(`   Snapshot Score: ${t.signalSnapshot.score}`);
                console.log(`   Snapshot Conf : ${t.signalSnapshot.confidence}%`);
                if (t.signalSnapshot.reasons) {
                    console.log(`   Signal Reasons: ${t.signalSnapshot.reasons.join(', ')}`);
                }
            } else {
                console.log(`   Snapshot: N/A`);
            }
            console.log('------------------------------------------------');
        });

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}

run();
