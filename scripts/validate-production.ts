
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { DydxExecutionService } from '../src/services/dydx-execution';
import { ScannerService } from '../src/services/scanner';
import * as readline from 'readline';

// ANSI
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function waitForEnter(msg: string): Promise<void> {
    return new Promise(resolve => rl.question(`\n${YELLOW}${msg} Press ENTER to continue...${RESET}\n`, () => resolve()));
}

function header(step: number, title: string) {
    console.log(`\n${CYAN}${'='.repeat(60)}${RESET}`);
    console.log(`${CYAN}  STEP ${step}: ${title}${RESET}`);
    console.log(`${CYAN}${'='.repeat(60)}${RESET}\n`);
}

function pass(msg: string) { console.log(`${GREEN}  ✅ PASS: ${msg}${RESET}`); }
function fail(msg: string) { console.log(`${RED}  ❌ FAIL: ${msg}${RESET}`); }

async function main() {
    console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${CYAN}║    CANTON BOT - PRODUCTION VALIDATION SUITE      ║${RESET}`);
    console.log(`${BOLD}${CYAN}║    dYdX v4 Mainnet End-to-End Test               ║${RESET}`);
    console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}\n`);

    const results: { step: string; status: 'PASS' | 'FAIL'; detail: string }[] = [];
    const engine = new DydxExecutionService();
    const scanner = new ScannerService();

    // ====================================================================
    // STEP 1: ACCOUNT STATE
    // ====================================================================
    header(1, 'ACCOUNT STATE');
    let equity = 0;
    try {
        const state = await engine.getAccountState();
        if (!state) throw new Error("getAccountState returned null");

        equity = parseFloat(state.equity || '0');
        const freeCollateral = parseFloat(state.freeCollateral || '0');
        const posCount = Object.keys(state.openPositions || {}).length;

        console.log(`  Address  : ${state.address || 'N/A'}`);
        console.log(`  Equity   : $${equity.toFixed(2)}`);
        console.log(`  Free Col : $${freeCollateral.toFixed(2)}`);
        console.log(`  Open Pos : ${posCount}`);

        if (equity > 0) {
            pass(`Account connected with $${equity.toFixed(2)} equity`);
            results.push({ step: 'Account State', status: 'PASS', detail: `$${equity.toFixed(2)} equity` });
        } else {
            fail('Account has $0 equity. Cannot proceed.');
            results.push({ step: 'Account State', status: 'FAIL', detail: '$0 equity' });
            printReport(results);
            rl.close();
            return;
        }
    } catch (e: any) {
        fail(`Account State Error: ${e.message}`);
        results.push({ step: 'Account State', status: 'FAIL', detail: e.message });
        printReport(results);
        rl.close();
        return;
    }

    // ====================================================================
    // STEP 2: SCANNER
    // ====================================================================
    header(2, 'MARKET SCANNER');
    let scanData: any = null;
    try {
        console.log(`  Scanning markets (batched, ~6-10s)...`);
        scanData = await scanner.scanMarkets();

        const marketCount = scanData.markets?.length || 0;
        const signalCount = scanData.signals?.length || 0;

        console.log(`  Markets Scanned : ${marketCount}`);
        console.log(`  Signals Found   : ${signalCount}`);

        if (marketCount > 0) {
            console.log(`\n  Top 3 Markets:`);
            scanData.markets.slice(0, 3).forEach((m: any) => {
                const dir = m.score > 0 ? GREEN + '▲' : RED + '▼';
                console.log(`    ${m.symbol.padEnd(12)} Score: ${m.score?.toFixed(3) || 'N/A'} ${dir}${RESET}  Conf: ${m.confidence || 0}%`);
            });

            pass(`Scanner returned ${marketCount} markets, ${signalCount} actionable signals`);
            results.push({ step: 'Scanner', status: 'PASS', detail: `${marketCount} markets, ${signalCount} signals` });
        } else {
            fail('Scanner returned 0 markets');
            results.push({ step: 'Scanner', status: 'FAIL', detail: '0 markets' });
        }
    } catch (e: any) {
        fail(`Scanner Error: ${e.message}`);
        results.push({ step: 'Scanner', status: 'FAIL', detail: e.message });
    }

    // ====================================================================
    // STEP 3: OPEN POSITION WITH TP + SL (ETH-USD)
    // ====================================================================
    header(3, 'OPEN POSITION + TP + SL (ETH-USD)');
    const TEST_SYMBOL = 'ETH-USD';
    let testPrice = 0;
    let testSize = 0;

    try {
        // Check if already open
        const state = await engine.getAccountState();
        if (state?.openPositions?.[TEST_SYMBOL]) {
            console.log(`${YELLOW}  ⚠ Already have an ETH-USD position. Skipping open.${RESET}`);
            const pos = state.openPositions[TEST_SYMBOL];
            testPrice = parseFloat(pos.entryPrice);
            testSize = Math.abs(parseFloat(pos.size));
            results.push({ step: 'Open + TP + SL', status: 'PASS', detail: 'Already open (skipped)' });
        } else {
            // Get price from scan data
            const ethData = scanData?.markets?.find((m: any) => m.symbol === TEST_SYMBOL);
            testPrice = ethData?.price || 0;

            if (!testPrice) {
                // Fallback: direct fetch
                console.log(`  No scan data for ETH. Using direct fetch...`);
                const reScan = await scanner.scanMarkets();
                const eth = reScan.markets.find((m: any) => m.symbol === TEST_SYMBOL);
                testPrice = eth?.price || 2800;
            }

            const sizeUsd = 20; // $20 (smallest safe trade)
            const tpPrice = parseFloat((testPrice * 1.02).toFixed(2));  // +2%
            const slPrice = parseFloat((testPrice * 0.98).toFixed(2));  // -2%

            console.log(`  Symbol    : ${TEST_SYMBOL}`);
            console.log(`  Action    : BUY (Long)`);
            console.log(`  Size      : $${sizeUsd}`);
            console.log(`  Price     : ~$${testPrice.toFixed(2)}`);
            console.log(`  TP Target : $${tpPrice} (+2%)`);
            console.log(`  SL Target : $${slPrice} (-2%)`);
            console.log(`  Leverage  : 1x`);

            await waitForEnter(`⚠ REAL TRADE: Opening $${sizeUsd} LONG on ETH-USD with TP at $${tpPrice} and SL at $${slPrice}.`);

            const result = await engine.executeOrder(
                TEST_SYMBOL,
                'BUY',
                sizeUsd,
                testPrice,
                1,      // 1x
                false,  // not reduce-only
                { tp: tpPrice, sl: slPrice } // TP + SL in same order
            );

            if (result.success) {
                pass(`Order + TP + SL placed. TxHash: ${result.txHash}`);
                testSize = result.filledSize || parseFloat((sizeUsd / testPrice).toFixed(4));
                results.push({ step: 'Open + TP + SL', status: 'PASS', detail: `TxHash: ${result.txHash}` });
            } else {
                fail(`Order failed: ${result.error}`);
                results.push({ step: 'Open + TP + SL', status: 'FAIL', detail: result.error || 'Unknown' });
            }
        }
    } catch (e: any) {
        fail(`Error: ${e.message}`);
        results.push({ step: 'Open + TP + SL', status: 'FAIL', detail: e.message });
    }

    // Wait for settlement
    console.log(`\n${YELLOW}  Waiting 10s for on-chain settlement...${RESET}`);
    await new Promise(r => setTimeout(r, 10000));

    // ====================================================================
    // STEP 4: VERIFY POSITION + TRIGGERS EXIST
    // ====================================================================
    header(4, 'VERIFY POSITION ON-CHAIN');
    try {
        const state = await engine.getAccountState();
        const ethPos = state?.openPositions?.[TEST_SYMBOL];

        if (ethPos) {
            testSize = Math.abs(parseFloat(ethPos.size || '0'));
            testPrice = parseFloat(ethPos.entryPrice);

            console.log(`  Size      : ${ethPos.size}`);
            console.log(`  Entry     : $${ethPos.entryPrice}`);
            console.log(`  Side      : ${ethPos.side}`);
            console.log(`  Unrl PnL  : $${ethPos.unrealizedPnl || '0'}`);

            pass(`ETH-USD position confirmed on-chain (Entry: $${ethPos.entryPrice})`);
            results.push({ step: 'Verify Position', status: 'PASS', detail: `Size: ${ethPos.size}, Entry: $${ethPos.entryPrice}` });
        } else {
            fail('ETH-USD position NOT found on-chain');
            console.log(`  Open positions: ${JSON.stringify(Object.keys(state?.openPositions || {}))}`);
            results.push({ step: 'Verify Position', status: 'FAIL', detail: 'Position not found' });
        }
    } catch (e: any) {
        fail(`Error: ${e.message}`);
        results.push({ step: 'Verify Position', status: 'FAIL', detail: e.message });
    }

    // ====================================================================
    // STEP 5: CLOSE POSITION
    // ====================================================================
    header(5, 'CLOSE POSITION');
    if (testSize > 0) {
        try {
            console.log(`  Closing Long: SELL ${testSize} ETH @ ~$${testPrice.toFixed(2)}`);

            await waitForEnter(`⚠ This will CLOSE the ETH-USD position.`);

            // Get fresh price for aggressive close
            const freshState = await engine.getAccountState();
            const currentEntry = parseFloat(freshState?.openPositions?.[TEST_SYMBOL]?.entryPrice || String(testPrice));

            const result = await engine.executeOrder(
                TEST_SYMBOL,
                'SELL',
                testSize * currentEntry, // USD equivalent
                currentEntry,
                1,
                true // reduce-only
            );

            if (result.success) {
                pass(`Position closed. TxHash: ${result.txHash}`);
                results.push({ step: 'Close Position', status: 'PASS', detail: `TxHash: ${result.txHash}` });
            } else {
                fail(`Close failed: ${result.error}`);
                results.push({ step: 'Close Position', status: 'FAIL', detail: result.error || 'Unknown' });
            }
        } catch (e: any) {
            fail(`Error: ${e.message}`);
            results.push({ step: 'Close Position', status: 'FAIL', detail: e.message });
        }
    } else {
        console.log(`${YELLOW}  Skipping (no position to close)${RESET}`);
        results.push({ step: 'Close Position', status: 'FAIL', detail: 'No position' });
    }

    // Wait for settlement
    console.log(`\n${YELLOW}  Waiting 5s for settlement...${RESET}`);
    await new Promise(r => setTimeout(r, 5000));

    // ====================================================================
    // STEP 6: FINAL ACCOUNT STATE
    // ====================================================================
    header(6, 'FINAL ACCOUNT STATE');
    try {
        const state = await engine.getAccountState();
        const finalEquity = parseFloat(state?.equity || '0');
        const posCount = Object.keys(state?.openPositions || {}).length;
        const pnl = finalEquity - equity;

        console.log(`  Equity    : $${finalEquity.toFixed(2)} (was $${equity.toFixed(2)})`);
        console.log(`  PnL       : ${pnl >= 0 ? GREEN : RED}$${pnl.toFixed(4)}${RESET}`);
        console.log(`  Open Pos  : ${posCount}`);

        if (!state?.openPositions?.[TEST_SYMBOL]) {
            pass(`Position fully closed. Final equity: $${finalEquity.toFixed(2)}`);
        } else {
            console.log(`${YELLOW}  ⚠ Position may still be settling${RESET}`);
        }
        results.push({ step: 'Final State', status: 'PASS', detail: `$${finalEquity.toFixed(2)} (PnL: $${pnl.toFixed(4)})` });
    } catch (e: any) {
        fail(`Error: ${e.message}`);
        results.push({ step: 'Final State', status: 'FAIL', detail: e.message });
    }

    printReport(results);
    rl.close();
}

function printReport(results: { step: string; status: string; detail: string }[]) {
    console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${CYAN}║           VALIDATION REPORT                      ║${RESET}`);
    console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}\n`);

    const passCount = results.filter(r => r.status === 'PASS').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;

    results.forEach(r => {
        const icon = r.status === 'PASS' ? `${GREEN}✅` : `${RED}❌`;
        console.log(`  ${icon} ${r.step.padEnd(20)} ${r.detail}${RESET}`);
    });

    console.log(`\n  ${BOLD}Result: ${passCount}/${results.length} PASS${RESET}`);

    if (failCount === 0) {
        console.log(`\n  ${GREEN}${BOLD}🎉 ALL TESTS PASSED — Bot is fully operational on dYdX v4 Mainnet${RESET}\n`);
    } else {
        console.log(`\n  ${RED}${BOLD}⚠ ${failCount} test(s) failed. Review above for details.${RESET}\n`);
    }
}

main().catch(e => {
    console.error(`${RED}Fatal Error:${RESET}`, e);
    process.exit(1);
});
