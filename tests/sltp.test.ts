/**
 * Regression test for SL/TP validation (audit finding 2).
 *
 * Pure — no server, no chain, no DB. Run with: npx tsx tests/sltp.test.ts
 *
 * The bug: /positions/open and /positions/:id/sl-tp stored whatever they were handed, so a long
 * could be opened with a take-profit BELOW the mark. The risk engine then force-closed it on the
 * next 15s tick and charged a close fee. It never minted value — closePosition fills at the mark,
 * never at the requested level — but it is never what the user meant either.
 */
import { validateTriggerLevels } from "shared/margin";
import type { Direction } from "shared/types";

type Case = {
  label: string;
  direction: Direction;
  stopLoss: number | null;
  takeProfit: number | null;
  expectAccepted: boolean;
};

const MARK = 10_000;

const CASES: Case[] = [
  // Long: stop below the mark, target above it.
  { label: "long, SL below + TP above", direction: "long", stopLoss: 9_500, takeProfit: 11_000, expectAccepted: true },
  { label: "long, TP below mark", direction: "long", stopLoss: null, takeProfit: 9_500, expectAccepted: false },
  { label: "long, SL above mark", direction: "long", stopLoss: 10_500, takeProfit: null, expectAccepted: false },
  { label: "long, TP exactly at mark", direction: "long", stopLoss: null, takeProfit: MARK, expectAccepted: false },
  { label: "long, SL exactly at mark", direction: "long", stopLoss: MARK, takeProfit: null, expectAccepted: false },

  // Short: mirrored.
  { label: "short, SL above + TP below", direction: "short", stopLoss: 10_500, takeProfit: 9_500, expectAccepted: true },
  { label: "short, TP above mark", direction: "short", stopLoss: null, takeProfit: 10_500, expectAccepted: false },
  { label: "short, SL below mark", direction: "short", stopLoss: 9_500, takeProfit: null, expectAccepted: false },
  { label: "short, SL exactly at mark", direction: "short", stopLoss: MARK, takeProfit: null, expectAccepted: false },

  // Not a validation error: no levels set at all is the common case.
  { label: "no levels set", direction: "long", stopLoss: null, takeProfit: null, expectAccepted: true },

  // Deliberately allowed — a stop past the liquidation price is inert, not wrong, and the mark
  // moves. Rejecting it would be a second, undocumented rule on top of the published one.
  { label: "long, SL far below liq price", direction: "long", stopLoss: 1, takeProfit: null, expectAccepted: true },
];

let failed = 0;

for (const c of CASES) {
  const error = validateTriggerLevels({
    direction: c.direction,
    markPrice: MARK,
    stopLoss: c.stopLoss,
    takeProfit: c.takeProfit,
  });
  const accepted = error === null;
  const pass = accepted === c.expectAccepted;
  if (!pass) failed++;

  console.log(
    `${pass ? "PASS" : "FAIL"}  ${c.label.padEnd(28)} ${accepted ? "accepted" : `rejected: ${error}`}`,
  );
}

console.log(
  failed === 0
    ? `\nsl/tp: ${CASES.length} cases, all as specified`
    : `\nsl/tp: ${failed} of ${CASES.length} cases FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
