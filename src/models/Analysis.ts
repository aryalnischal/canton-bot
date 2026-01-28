import mongoose from 'mongoose';

const AnalysisSchema = new mongoose.Schema({
    tradeId: { type: String, required: true, ref: 'Trade' }, // Link to Trade (internal or TX ID)
    symbol: { type: String, required: true },
    result: { type: String, enum: ['WIN', 'LOSS'], required: true },
    pnlPercent: { type: Number, required: true },

    // Autopsy Findings
    rootCause: { type: String }, // e.g. "Trend Reversal", "Liquidation Wick"
    prevention: { type: String }, // e.g. "Blacklist", "Tighten SL"

    // Scoring
    qualityScore: { type: Number }, // 0-100 Rating of the original trade quality given the outcome

    timestamp: { type: Number, default: Date.now }
}, {
    timestamps: true
});

export default mongoose.models.Analysis || mongoose.model('Analysis', AnalysisSchema);
