
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
    signalSnapshot: mongoose.Schema.Types.Mixed
});

// Fix: Check models on the connection or global
const Trade = (mongoose.models && mongoose.models.Trade) || mongoose.model('Trade', TradeSchema);

async function run() {
    try {
        console.log("Connecting to Mongo...");
        await mongoose.connect(MONGODB_URI!);
        console.log("Connected.");

        // Fetch Closed Trades
        const trades = await Trade.find({ status: 'CLOSED' }).sort({ exitTime: -1 }); // Recent first

        console.log(`\n📊 Found ${trades.length} Closed Trades:\n`);

        trades.forEach((t: any) => {
            // Filter for XMR or TAO if needed, but let's show all recent
            if (['XMR-USD', 'TAO-USD'].includes(t.symbol) || true) { // Show all for now to verify
                const entryTime = new Date(t.entryTime || t.timestamp).toLocaleString();
                const exitTime = t.exitTime ? new Date(t.exitTime).toLocaleString() : 'N/A';
                const pnl = t.pnlValue || 0;
                const pnlPct = t.pnlPercent || 0;
                const color = pnl >= 0 ? '🟢' : '🔴';

                console.log(`${color} ${t.symbol} (${t.action})`);
                console.log(`   Entry : $${t.price} @ ${entryTime}`);
                console.log(`   Exit  : $${t.exitPrice} @ ${exitTime}`);
                console.log(`   PnL   : $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
                console.log(`   Reason: ${t.exitReason || 'Manual/Unknown'}`);
                if (t.signalSnapshot && t.signalSnapshot.reasons) {
                    console.log(`   Signal: ${t.signalSnapshot.reasons.join(', ')}`);
                }
                console.log('------------------------------------------------');
            }
        });

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}

run();
