
export const DERIBIT_API = "https://www.deribit.com/api/v2/public";

export interface DeribitOptionSummary {
    instrument_name: string;
    open_interest: number;
    mark_price: number;
    underlying_price: number; // Index price
}

export async function fetchDeribitOptions(currency: string = 'BTC'): Promise<DeribitOptionSummary[]> {
    try {
        const res = await fetch(`${DERIBIT_API}/get_book_summary_by_currency?currency=${currency}&kind=option`, {
            cache: 'no-store'
        });
        const data = await res.json();
        return data.result || [];
    } catch (e) {
        console.error(`[Deribit] Fetch Failed for ${currency}:`, e);
        return [];
    }
}

export async function calculateMaxPain(currency: string = 'BTC'): Promise<number> {
    // Normalize: dYdX symbols are "BTC-USD" but Deribit expects "BTC"
    const normalized = currency.replace(/-USD$/, '').toUpperCase();

    // Deribit only has options for BTC, ETH, SOL — skip others
    const SUPPORTED = ['BTC', 'ETH', 'SOL'];
    if (!SUPPORTED.includes(normalized)) return 0;

    const options = await fetchDeribitOptions(normalized);
    if (options.length === 0) return 0;

    // Parse definitions from instrument_name (e.g., "BTC-29DEC23-30000-C")
    // Format: Currency-Date-Strike-Type
    const valid = options.filter(o => o.open_interest > 0);

    // Group by Strike
    const strikes = new Set<number>();
    const openInterest = new Map<string, number>(); // Key: "Strike-Type" (e.g. "30000-C")

    let currentPrice = valid[0]?.underlying_price || 0;

    valid.forEach(opt => {
        const parts = opt.instrument_name.split('-');
        if (parts.length < 4) return;

        const strike = parseFloat(parts[2]);
        const type = parts[3]; // 'C' or 'P'

        strikes.add(strike);
        openInterest.set(`${strike}-${type}`, opt.open_interest);
    });

    const strikeList = Array.from(strikes).sort((a, b) => a - b);

    // Calculate Pain for each strike
    let minPain = Infinity;
    let maxPainStrike = currentPrice;

    // Optimization: Only check strikes within 20% of current price to save CPU
    const checkStrikes = strikeList.filter(s => Math.abs(s - currentPrice) / currentPrice < 0.2);

    for (const testStrike of checkStrikes) {
        let totalPain = 0;

        // Sum pain for all options if market settled at testStrike
        valid.forEach(opt => {
            const parts = opt.instrument_name.split('-');
            const strike = parseFloat(parts[2]);
            const type = parts[3];
            const oi = opt.open_interest;

            if (type === 'C' && testStrike > strike) {
                // Call Value: (Settlement - Strike) * OI
                totalPain += (testStrike - strike) * oi;
            } else if (type === 'P' && testStrike < strike) {
                // Put Value: (Strike - Settlement) * OI
                totalPain += (strike - testStrike) * oi;
            }
        });

        if (totalPain < minPain) {
            minPain = totalPain;
            maxPainStrike = testStrike;
        }
    }

    return maxPainStrike;
}
