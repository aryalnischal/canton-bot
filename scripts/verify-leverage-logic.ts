
// Scripts/verify-leverage-logic.ts

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

function calculateLeverageAndSize(confidence: number) {
    const BASE_COLLATERAL = 50; // $50 Risk per trade
    let targetLeverage = 3;     // Default

    if (confidence > 85) {
        targetLeverage = 10;
    } else if (confidence > 77) {
        targetLeverage = 8;
    } else if (confidence > 70) {
        targetLeverage = 5;
    } else {
        targetLeverage = 3;
    }

    const size = BASE_COLLATERAL * targetLeverage;
    return { leverage: targetLeverage, size };
}

function runTest(confidence: number, expectedLev: number, expectedSize: number) {
    const result = calculateLeverageAndSize(confidence);
    const pass = result.leverage === expectedLev && result.size === expectedSize;

    const icon = pass ? `${GREEN}✔ PASS${RESET}` : `${RED}✘ FAIL${RESET}`;
    console.log(`${icon} Confidence: ${confidence}% -> Lev: ${result.leverage}x (Exp: ${expectedLev}x) | Size: $${result.size} (Exp: $${expectedSize})`);
}

console.log("========================================");
console.log("      VERIFYING LEVERAGE LOGIC          ");
console.log("========================================");

// Case 1: Max Conviction (> 85)
runTest(86, 10, 500); // 50 * 10 = 500

// Case 2: High Conviction (> 77)
runTest(78, 8, 400); // 50 * 8 = 400

// Case 3: Strong Conviction (> 70)
// Edge case: 77 should still be 5x (since > 77 is strictly greater)
runTest(72, 5, 250);  // 50 * 5 = 250
runTest(77, 5, 250);

// Case 4: Standard (> 45, or default)
runTest(50, 3, 150);  // 50 * 3 = 150
runTest(40, 3, 150);  // Fallback

console.log("========================================");
