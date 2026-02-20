/**
 * ═══════════════════════════════════════════════════════════════════
 *  ADAPTIVE TAKE PROFIT ENGINE — Dual-Timeframe Design
 * ═══════════════════════════════════════════════════════════════════
 *
 * Two-path intelligence:
 *   PATH 1 (Intraday): TP layers calibrated for 15-min candle moves.
 *     These are the on-chain limit orders that secure quick profits.
 *     Tighter than swing-level because intraday rallies are smaller.
 *
 *   PATH 2 (Swing):  Trailing stop + ROE-based TP for macro moves.
 *     These let winners run when a trade catches a multi-hour trend.
 *     Wider than intraday because they track cumulative PnL, not price.
 *
 * The real-time ATR from the scanner's 15-min candles is used to:
 *   1. Dynamically bump the asset's tier UP if it's hotter than usual
 *   2. Scale TP layer gains via a volatility multiplier (volMul)
 *      — if current ATR is 2× the tier baseline, gains widen 2×
 *
 * Hybrid tier classification:
 *   Base layer:  Hardcoded map (BTC/ETH → MAJOR, alts → MID_CAP, memes → HIGH_VOL)
 *   Dynamic:     ATR bump-up only (never bumps DOWN)
 */

// ═══════ TYPES ═══════

export type VolatilityTier = 'MAJOR' | 'MID_CAP' | 'HIGH_VOL';

export interface AdaptiveTpConfig {
    tier: VolatilityTier;
    tierBumped: boolean;
    volMultiplier: number;
    layers: { pct: number; gain: number }[];
    roeTP1: number;
    roeTP2: number;
    trailActivation: number;
    trailPercent: number;
    maxHoldBars: number;          // Max bars before stale exit (15-min candles)
}

// ═══════ HARDCODED BASE TIER MAP ═══════

const BASE_TIER_MAP: Record<string, VolatilityTier> = {
    // MAJORS — Large cap, highest liquidity
    'BTC': 'MAJOR',
    'ETH': 'MAJOR',

    // MID-CAP — Established alts
    'SOL': 'MID_CAP',
    'AVAX': 'MID_CAP',
    'LINK': 'MID_CAP',
    'NEAR': 'MID_CAP',
    'SUI': 'MID_CAP',
    'TIA': 'MID_CAP',
    'SEI': 'MID_CAP',
    'APT': 'MID_CAP',
    'ARB': 'MID_CAP',
    'OP': 'MID_CAP',
    'INJ': 'MID_CAP',
    'FIL': 'MID_CAP',
    'ATOM': 'MID_CAP',
    'DOT': 'MID_CAP',
    'MATIC': 'MID_CAP',
    'ADA': 'MID_CAP',
    'XRP': 'MID_CAP',
    'RENDER': 'MID_CAP',
    'FET': 'MID_CAP',
    'WLD': 'MID_CAP',
    'RUNE': 'MID_CAP',
    'HNT': 'MID_CAP',

    // HIGH-VOL — Memecoins, micro-caps
    'DOGE': 'HIGH_VOL',
    'SHIB': 'HIGH_VOL',
    'PEPE': 'HIGH_VOL',
    'BONK': 'HIGH_VOL',
    'WIF': 'HIGH_VOL',
    'FLOKI': 'HIGH_VOL',
    'DEGEN': 'HIGH_VOL',
    'TREMP': 'HIGH_VOL',
    'MEME': 'HIGH_VOL',
    'EGLD': 'HIGH_VOL',
    'MLN': 'HIGH_VOL',
};

// ═══════ TIER CONFIGURATIONS ═══════
// PATH 1 — LAYERED TPs: Calibrated for 15-min candles.
// PATH 2 — TRAILING STOP + ROE TPs: Handle the bigger swing picture.

interface TierConfig {
    baseLayers: { pct: number; gain: number }[];
    baselineAtr: number;
    roeTP1: number;
    roeTP2: number;
    trailActivation: number;
    trailPercent: number;
    maxHoldBars: number;   // Max 15-min bars before stale exit
}

const TIER_CONFIGS: Record<VolatilityTier, TierConfig> = {
    MAJOR: {
        // BTC/ETH: Intraday rallies typically 0.5-2%
        baseLayers: [
            { pct: 0.25, gain: 0.0075 },  // TP1: 25% @ +0.75%
            { pct: 0.25, gain: 0.015 },   // TP2: 25% @ +1.5%
            { pct: 0.50, gain: 0.025 },   // TP3: 50% @ +2.5%
        ],
        baselineAtr: 0.008,    // ~0.8% ATR on 15-min candles
        roeTP1: 14,            // 14% ROE → close 50%
        roeTP2: 40,            // 40% ROE → close 100%
        trailActivation: 1.50,
        trailPercent: 0.40,
        maxHoldBars: 192,      // 48h — backtested: longer holds compound BTC losses
    },

    MID_CAP: {
        // Mid-cap alts: Backtested — old fixed (+0.75/+1.5/+3.0) won.
        // Tightened from Phase 1 values to capture more frequent exits.
        baseLayers: [
            { pct: 0.25, gain: 0.0085 },   // TP1: 25% @ +0.85%
            { pct: 0.25, gain: 0.018 },    // TP2: 25% @ +1.8%
            { pct: 0.50, gain: 0.028 },    // TP3: 50% @ +2.8%
        ],
        baselineAtr: 0.015,    // ~1.5% ATR on 15-min candles
        roeTP1: 16,            // 16% ROE → close 50% (tightened from 20%)
        roeTP2: 45,            // 45% ROE → close 100% (tightened from 55%)
        trailActivation: 2.00,
        trailPercent: 0.38,
        maxHoldBars: 192,      // 48 hours — day trade window
    },

    HIGH_VOL: {
        // Memecoins: Backtested — adaptive already won (SHIB +19%, PEPE +5%).
        // Slightly tighter TP1 to capture more frequent small wins.
        baseLayers: [
            { pct: 0.20, gain: 0.015 },   // TP1: 20% @ +1.5% (was +2.0%)
            { pct: 0.30, gain: 0.035 },   // TP2: 30% @ +3.5% (was +4.0%)
            { pct: 0.50, gain: 0.065 },   // TP3: 50% @ +6.5% (was +7.0%)
        ],
        baselineAtr: 0.025,    // ~2.5% ATR on 15-min candles
        roeTP1: 25,            // 25% ROE → close 50% (tightened from 30%)
        roeTP2: 60,            // 60% ROE → close 100% (tightened from 75%)
        trailActivation: 3.00,
        trailPercent: 0.30,
        maxHoldBars: 96,       // 24 hours — quick scalps, in and out
    },
};

// Dynamic tier bump-up thresholds (never down)
const ATR_BUMP_THRESHOLDS = {
    MAJOR_TO_MID: 0.020,    // If MAJOR has live ATR% > 2.0%, bump to MID_CAP
    MID_TO_HIGH: 0.040,     // If MID_CAP has live ATR% > 4.0%, bump to HIGH_VOL
};

// Volatility multiplier limits
const VOL_MUL_MIN = 0.7;   // Layers stay at ≥70% of base
const VOL_MUL_MAX = 2.0;   // Layers stretch to ≤2× base

// ═══════ PUBLIC API ═══════

/**
 * Classify an asset and return its full adaptive TP configuration.
 * Pass the scanner's 15-min candles for real-time ATR calculation.
 */
export function getAdaptiveTpConfig(
    symbol: string,
    candles?: { c: number; h?: number; l?: number }[]
): AdaptiveTpConfig {
    const ticker = extractTicker(symbol);
    const baseTier = BASE_TIER_MAP[ticker] || 'MID_CAP';

    let effectiveTier = baseTier;
    let tierBumped = false;
    let volMultiplier = 1.0;

    if (candles && candles.length >= 14) {
        const liveAtr = computeAtrPercent(candles);

        // Dynamic tier bump-up (never down)
        if (baseTier === 'MAJOR' && liveAtr > ATR_BUMP_THRESHOLDS.MAJOR_TO_MID) {
            effectiveTier = 'MID_CAP';
            tierBumped = true;
        } else if (baseTier === 'MID_CAP' && liveAtr > ATR_BUMP_THRESHOLDS.MID_TO_HIGH) {
            effectiveTier = 'HIGH_VOL';
            tierBumped = true;
        }

        // Volatility multiplier: ratio of live ATR vs tier baseline
        const baseline = TIER_CONFIGS[effectiveTier].baselineAtr;
        if (baseline > 0) {
            volMultiplier = Math.min(VOL_MUL_MAX, Math.max(VOL_MUL_MIN, liveAtr / baseline));
        }
    }

    const cfg = TIER_CONFIGS[effectiveTier];

    // Scale layer gains by volatility multiplier
    const scaledLayers = cfg.baseLayers.map(layer => ({
        pct: layer.pct,
        gain: parseFloat((layer.gain * volMultiplier).toFixed(6)),
    }));

    return {
        tier: effectiveTier,
        tierBumped,
        volMultiplier: parseFloat(volMultiplier.toFixed(3)),
        layers: scaledLayers,
        roeTP1: cfg.roeTP1,
        roeTP2: cfg.roeTP2,
        trailActivation: cfg.trailActivation,
        trailPercent: cfg.trailPercent,
        maxHoldBars: cfg.maxHoldBars,
    };
}

/** Quick tier lookup (hardcoded map only). */
export function getBaseTier(symbol: string): VolatilityTier {
    return BASE_TIER_MAP[extractTicker(symbol)] || 'MID_CAP';
}

/** Get TP layers for a symbol (convenience for dydx-execution.ts). */
export function getTpLayers(
    symbol: string,
    candles?: { c: number; h?: number; l?: number }[]
): { pct: number; gain: number }[] {
    return getAdaptiveTpConfig(symbol, candles).layers;
}

// ═══════ INTERNALS ═══════

function extractTicker(symbol: string): string {
    return symbol.split('-')[0].toUpperCase();
}

function computeAtrPercent(candles: { c: number; h?: number; l?: number }[]): number {
    if (candles.length < 2) return 0;

    const closes = candles.map(c => c.c).sort((a, b) => a - b);
    const refPrice = closes[Math.floor(closes.length / 2)];
    if (refPrice <= 0) return 0;

    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
        const h = candles[i].h ?? candles[i].c;
        const l = candles[i].l ?? candles[i].c;
        const pc = candles[i - 1].c;
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }

    const period = Math.min(14, trs.length);
    const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    return atr / refPrice;
}
