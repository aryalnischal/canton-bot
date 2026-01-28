import mongoose from 'mongoose';

const TradeSchema = new mongoose.Schema({
    id: { type: String, unique: true }, // Internal ID
    timestamp: { type: Number, default: Date.now },
    symbol: { type: String, required: true },
    action: { type: String, enum: ['BUY', 'SELL'], required: true },
    price: { type: Number, required: true },
    size: { type: Number, required: true }, // Size in USD
    leverage: { type: Number, required: true },
    strategy: { type: String, default: 'MANUAL' },

    // AI Context (Snapshot at Entry)
    signalSnapshot: {
        score: { type: Number },
        confidence: { type: Number },
        reasons: { type: [String] },
        marketState: { type: mongoose.Schema.Types.Mixed }
    },

    // Execution Details
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    txHash: { type: String }, // Hyperliquid OID

    // Safety
    sl: { type: Number },
    tp: { type: Number },

    // Result
    exitPrice: { type: Number },
    exitTime: { type: Number },
    pnlValue: { type: Number },
    pnlPercent: { type: Number },
    exitReason: { type: String }
}, {
    timestamps: true // Adds createdAt, updatedAt
});

// Prevent compile errors if model already exists
export default mongoose.models.Trade || mongoose.model('Trade', TradeSchema);
