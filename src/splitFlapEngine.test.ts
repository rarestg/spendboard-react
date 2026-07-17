import { describe, expect, it } from "vitest";

import {
  BUSY_DIGITS,
  DECIMAL_BUSY_GAPS,
  assertIntegerSlots,
  busyFlipDuration,
  busyGlyphForCell,
  busyGlyphForDecimal,
  busyReelTiming,
  displayGlyphs,
  formatCents,
  glyphsForCents,
  maxCentsForSlots,
  parseCurrencyToCents,
  settleScrambleGlyphs,
} from "./splitFlapEngine";

describe("currency helpers", () => {
  it("parses dollars into integer cents without inventing precision", () => {
    expect(parseCurrencyToCents("0.31")).toBe(31);
    expect(parseCurrencyToCents("7")).toBe(700);
    expect(parseCurrencyToCents("7.5")).toBe(750);
    expect(parseCurrencyToCents("7.501")).toBeNull();
    expect(parseCurrencyToCents("")).toBeNull();
    expect(parseCurrencyToCents("-1")).toBeNull();
  });

  it("reserves leading panels and keeps cents exact", () => {
    expect(glyphsForCents(31, 2)).toEqual([" ", "0", "3", "1"]);
    expect(glyphsForCents(10_000, 3)).toEqual(["1", "0", "0", "0", "0"]);
    expect(maxCentsForSlots(2)).toBe(9_999);
    expect(() => glyphsForCents(10_000, 2)).toThrow(RangeError);
  });

  it("supports one integer slot with a $9.99 capacity", () => {
    expect(maxCentsForSlots(1)).toBe(999);
    expect(glyphsForCents(999, 1)).toEqual(["9", "9", "9"]);
    expect(() => glyphsForCents(1_000, 1)).toThrow(RangeError);
  });

  it("rejects invalid slot counts and cents", () => {
    for (const slots of [0, 1.5, 5]) {
      expect(() => assertIntegerSlots(slots)).toThrow(RangeError);
      expect(() => maxCentsForSlots(slots)).toThrow(RangeError);
    }
    for (const cents of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => glyphsForCents(cents, 4)).toThrow(RangeError);
    }
  });

  it("inserts the decimal into physical display order without changing numeric glyphs", () => {
    const numeric = [" ", "1", "2", "3"];
    expect(displayGlyphs(numeric, 2)).toEqual([" ", "1", ".", "2", "3"]);
    expect(numeric).toEqual([" ", "1", "2", "3"]);
    expect(displayGlyphs([" ", " ", " ", "1", "2", "3"], 4)).toEqual([
      " ",
      " ",
      " ",
      "1",
      ".",
      "2",
      "3",
    ]);
  });

  it("formats the coherent accessible value", () => {
    expect(formatCents(31)).toBe("$0.31");
    expect(formatCents(123_456)).toBe("$1,234.56");
  });
});

describe("reel choreography", () => {
  it("uses the fixed numeric scramble deck with distinct reel phases", () => {
    expect(BUSY_DIGITS).toEqual(["0", "7", "3", "8", "2", "9", "4", "6", "1", "5"]);
    expect(new Set(BUSY_DIGITS).size).toBe(10);
    expect(BUSY_DIGITS.every((glyph) => /^\d$/.test(glyph))).toBe(true);
    expect(new Set(Array.from({ length: 7 }, (_, index) => busyGlyphForCell(index, 0))).size).toBe(7);
    for (let index = 0; index < 7; index += 1) {
      const phase = busyReelTiming(index).phase;
      expect(Array.from({ length: 10 }, (_, flip) => busyGlyphForCell(index, flip))).toEqual([
        ...BUSY_DIGITS.slice(phase),
        ...BUSY_DIGITS.slice(0, phase),
      ]);
    }
  });

  it("varies decimal appearances with a balanced one-to-four digit gap bag", () => {
    const cycleLength = DECIMAL_BUSY_GAPS.reduce((total, gap) => total + gap + 1, 0);
    const glyphs = Array.from({ length: cycleLength }, (_, flip) => busyGlyphForDecimal(flip));
    const gaps: number[] = [];
    let gap = 0;
    for (const glyph of glyphs) {
      if (glyph === ".") {
        gaps.push(gap);
        gap = 0;
      } else {
        gap += 1;
      }
    }
    expect(gaps).toEqual(DECIMAL_BUSY_GAPS);
    expect(new Set(glyphs.filter((glyph) => glyph !== ".")).size).toBe(10);
    expect(busyGlyphForDecimal(cycleLength)).toBe(busyGlyphForDecimal(0));
  });

  it("starts reels out of spatial order with distinct steady cadences", () => {
    const timings = Array.from({ length: 7 }, (_, index) => busyReelTiming(index));
    const startOrder = timings
      .map(({ offset }, index) => ({ index, offset }))
      .sort((left, right) => left.offset - right.offset)
      .map(({ index }) => index);
    expect(startOrder).toEqual([1, 6, 3, 0, 5, 2, 4]);
    expect(new Set(timings.map(({ steady }) => steady)).size).toBe(7);
    expect(timings.every(({ steady }) => steady >= 170 && steady <= 180)).toBe(true);
    expect(Math.max(...timings.map(({ steady }) => steady))
      - Math.min(...timings.map(({ steady }) => steady))).toBeLessThanOrEqual(8);
    expect(timings.every(({ hold }) => hold >= 0 && hold <= 8)).toBe(true);
    expect(new Set(timings.map(({ steady, hold }) => steady + hold)).size)
      .toBe(timings.length);
  });

  it("accelerates each reel quadratically from 300ms over six steps", () => {
    for (let index = 0; index < 7; index += 1) {
      const steady = busyReelTiming(index).steady;
      const durations = Array.from({ length: 7 }, (_, flip) => busyFlipDuration(index, flip));
      expect(durations[0]).toBe(300);
      expect(durations[3]).toBe(steady + (300 - steady) / 4);
      expect(durations[6]).toBe(steady);
      expect(durations.slice(1).every((duration, step) => duration < durations[step])).toBe(true);
      expect(busyFlipDuration(index, 7)).toBe(steady);
    }
  });

  it("chooses a deterministic intermediate digit distinct from current and target", () => {
    const current = ["0", "7", "3", "8"];
    const target = [" ", "0", "3", "1"];
    const intermediate = settleScrambleGlyphs(current, target, 2);
    expect(intermediate).toEqual(["3", "8", "2", "9"]);
    expect(intermediate.every((glyph, index) => glyph !== current[index])).toBe(true);
    expect(intermediate.every((glyph, index) => glyph !== target[index])).toBe(true);
    expect(settleScrambleGlyphs(current, target, 2)).toEqual(intermediate);
  });
});
