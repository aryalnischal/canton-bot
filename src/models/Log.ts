import mongoose from 'mongoose';

const LogSchema = new mongoose.Schema({
    timestamp: { type: Number, default: Date.now },
    level: { type: String, enum: ['info', 'warn', 'error', 'trade', 'sys'], required: true },
    message: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed }, // Arbitrary JSON

    // Context
    source: { type: String, default: 'CLIENT' } // CLIENT vs SERVER vs ENGINE
}, {
    timestamps: true
});

export default mongoose.models.Log || mongoose.model('Log', LogSchema);
