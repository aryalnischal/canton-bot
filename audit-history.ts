
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/canton-v5';

const TradeSchema = new mongoose.Schema({
    symbol: String,
    status: String,
    entryTime: Number,
    exitTime: Number,
    pnlValue: Number,
    result: String,
}, { strict: false });

const Trade = mongoose.models.Trade || mongoose.model('Trade', TradeSchema);

async function audit() {
    console.log("📜 AUDITING HISTORY LEDGER...");
    try {
        await mongoose.connect(MONGODB_URI);
        const closed = await Trade.find({ status: 'CLOSED' }).sort({ exitTime: -1 }).limit(50);

        console.log(`\nFound ${closed.length} Recent Closed Trades:`);
        console.log("---------------------------------------------------");
        console.log("SYMBOL  | RESULT   | PNL      | DURATION");
        console.log("---------------------------------------------------");

        let junkCount = 0;

        closed.forEach(t => {
            const durationSec = t.exitTime && t.entryTime ? (t.exitTime - t.entryTime) / 1000 : 0;
            const isJunk = durationSec < 60; // Less than 1 min trade?
            if (isJunk) junkCount++;

            console.log(
                `${t.symbol.padEnd(7)} | ` +
                `${(t.result || '???').padEnd(8)} | ` +
                `$${(t.pnlValue || 0).toFixed(2).padEnd(6)} | ` +
                `${durationSec.toFixed(0)}s ${isJunk ? '(⚠️ FAST)' : ''}`
            );
        });

        console.log("\n---------------------------------------------------");
        console.log(`⚠️  Potential Junk (Duration < 60s): ${junkCount}`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

audit();
