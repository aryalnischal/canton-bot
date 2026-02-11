import mongoose from 'mongoose';

// Inline Schema to avoid Import Issues
const TradeSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    timestamp: { type: Number, default: Date.now },
    symbol: { type: String, required: true },
    action: { type: String, enum: ['BUY', 'SELL'], required: true },
    price: { type: Number, required: true },
    size: { type: Number, required: true },
    leverage: { type: Number, required: true },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    exitPrice: { type: Number },
    exitTime: { type: Number },
    pnlValue: { type: Number },
    pnlPercent: { type: Number },
    exitReason: { type: String }
}, {
    timestamps: true
});

const Trade = mongoose.models.Trade || mongoose.model('Trade', TradeSchema);

// Connect to DB
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/canton-dydx";

async function main() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Connected to MongoDB");

        // Fetch ALL Trades
        const trades = await Trade.find({}).sort({ timestamp: -1 });

        console.log(`\n📊 Found ${trades.length} Total Trades:\n`);

        let totalPnL = 0;
        let wins = 0;

        trades.forEach((t: any) => {
            const entryTime = new Date(t.timestamp).toLocaleString();
            const exitTime = t.exitTime ? new Date(t.exitTime).toLocaleString() : 'N/A';
            const duration = t.exitTime ? ((t.exitTime - t.timestamp) / 1000 / 60).toFixed(1) + 'm' : 'N/A';

            const pnl = t.pnlValue || 0;
            const pnlPct = t.pnlPercent || 0;
            const size = t.size || 0;

            totalPnL += pnl;
            if (pnl > 0) wins++;

            const color = pnl >= 0 ? '🟢' : '🔴';

            console.log(`${color} ${t.symbol} (${t.action})`);
            console.log(`   Entry: $${t.price} @ ${entryTime}`);
            console.log(`   Exit : $${t.exitPrice} @ ${exitTime} (${duration})`);
            console.log(`   Size : $${size.toFixed(2)}`);
            console.log(`   PnL  : $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
            console.log(`   Reason: ${t.exitReason || 'Manual/Unknown'}`);
            console.log('------------------------------------------------');
        });

        console.log(`\n📈 SUMMARY:`);
        console.log(`Total Trades: ${trades.length}`);
        console.log(`Wins: ${wins} / Losses: ${trades.length - wins}`);
        console.log(`Win Rate: ${trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : 0}%`);
        console.log(`Net PnL: $${totalPnL.toFixed(2)}`);

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}

main();
