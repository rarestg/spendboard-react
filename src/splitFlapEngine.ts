const FLIP_MS = 150;
const FLIP_EASING = "cubic-bezier(.35, 0, .65, 1)";
const SETTLE_EASING = "cubic-bezier(.33, 1, .68, 1)";
const BUSY_INITIAL_MS = 300;
const BUSY_ACCELERATION_FLIPS = 6;

export type IntegerSlots = 1 | 2 | 3 | 4;

export type SplitFlapSemanticState =
  | { status: "settled"; cents: number }
  | { status: "busy" }
  | { status: "unknown" };

type MotionMode = "idle" | "busy" | "settling";
type Announce = (message: string | null) => void;

type ReelTiming = {
  offset: number;
  steady: number;
  hold: number;
  phase: number;
};

type Cell = {
  el: HTMLSpanElement;
  faces: HTMLSpanElement[];
  topNext: HTMLSpanElement;
  bottomCurrent: HTMLSpanElement;
  topCurrent: HTMLSpanElement;
  bottomNext: HTMLSpanElement;
  current: string;
};

type LandingResult =
  | {
    status: "settled";
    cents: number;
    glyphs: string[];
    formatted: string;
    announce: boolean;
  }
  | {
    status: "unknown";
    glyphs: string[];
    announce: boolean;
  };

export const BUSY_DIGITS = Object.freeze([
  "0",
  "7",
  "3",
  "8",
  "2",
  "9",
  "4",
  "6",
  "1",
  "5",
]);
// A balanced shuffle bag feels irregular without leaving the decimal absent too long.
export const DECIMAL_BUSY_GAPS = Object.freeze([2, 4, 1, 3, 3, 1, 4, 2, 4, 2, 3, 1]);

const DECIMAL_BUSY_GLYPHS = Object.freeze((() => {
  const glyphs: string[] = [];
  let digit = 3;
  for (const gap of DECIMAL_BUSY_GAPS) {
    for (let index = 0; index < gap; index += 1) {
      glyphs.push(BUSY_DIGITS[digit % BUSY_DIGITS.length]);
      digit += 1;
    }
    glyphs.push(".");
  }
  return glyphs;
})());

const BUSY_REEL_TIMINGS: readonly ReelTiming[] = Object.freeze([
  { offset: 55, steady: 172, hold: 2, phase: 0 },
  { offset: 0, steady: 177, hold: 6, phase: 4 },
  { offset: 90, steady: 174, hold: 3, phase: 7 },
  { offset: 28, steady: 180, hold: 8, phase: 2 },
  { offset: 112, steady: 175, hold: 4, phase: 9 },
  { offset: 70, steady: 178, hold: 7, phase: 5 },
  { offset: 16, steady: 173, hold: 0, phase: 3 },
]);

export function assertIntegerSlots(value: number): asserts value is IntegerSlots {
  if (![1, 2, 3, 4].includes(value)) {
    throw new RangeError("Use 1, 2, 3, or 4 integer panels");
  }
}

export function busyReelTiming(cellIndex: number): ReelTiming {
  const timing = BUSY_REEL_TIMINGS[cellIndex];
  if (!timing) throw new RangeError("Reel index is out of range");
  return timing;
}

export function busyFlipDuration(cellIndex: number, flip: number): number {
  const steady = busyReelTiming(cellIndex).steady;
  const remaining = 1 - Math.min(flip / BUSY_ACCELERATION_FLIPS, 1);
  return steady + (BUSY_INITIAL_MS - steady) * remaining ** 2;
}

export function busyGlyphForCell(cellIndex: number, flip: number): string {
  const phase = busyReelTiming(cellIndex).phase;
  return BUSY_DIGITS[(phase + flip) % BUSY_DIGITS.length];
}

export function busyGlyphForDecimal(flip: number): string {
  return DECIMAL_BUSY_GLYPHS[flip % DECIMAL_BUSY_GLYPHS.length];
}

export function settleScrambleGlyphs(
  currentGlyphs: readonly string[],
  targetGlyphs: readonly string[],
  phase = 0,
): string[] {
  return targetGlyphs.map((target, index) => {
    const start = (phase + index) % BUSY_DIGITS.length;
    for (let offset = 0; offset < BUSY_DIGITS.length; offset += 1) {
      const digit = BUSY_DIGITS[(start + offset) % BUSY_DIGITS.length];
      if (digit !== target && digit !== currentGlyphs[index]) return digit;
    }
    throw new Error("The scramble deck has no available digit");
  });
}

export function parseCurrencyToCents(input: unknown): number | null {
  const match = String(input).trim().match(/^(\d+)(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

export function maxCentsForSlots(integerSlots: number): number {
  assertIntegerSlots(integerSlots);
  return 10 ** integerSlots * 100 - 1;
}

export function glyphsForCents(cents: number, integerSlots: number): string[] {
  const maximum = maxCentsForSlots(integerSlots);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > maximum) {
    throw new RangeError("Amount does not fit the reserved panels");
  }
  const dollars = String(Math.floor(cents / 100)).padStart(integerSlots, " ");
  const fraction = String(cents % 100).padStart(2, "0");
  return [...dollars, ...fraction];
}

export function displayGlyphs(
  numericGlyphs: readonly string[],
  integerSlots: number,
): string[] {
  assertIntegerSlots(integerSlots);
  return [
    ...numericGlyphs.slice(0, integerSlots),
    ".",
    ...numericGlyphs.slice(integerSlots),
  ];
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function validateSemanticState(
  state: SplitFlapSemanticState,
  integerSlots: number,
): void {
  assertIntegerSlots(integerSlots);
  const status = (state as { status?: unknown }).status;
  if (status !== "settled" && status !== "busy" && status !== "unknown") {
    throw new TypeError("Status must be settled, busy, or unknown");
  }
  if (state.status === "settled") glyphsForCents(state.cents, integerSlots);
}

function sameSemanticState(
  left: SplitFlapSemanticState,
  right: SplitFlapSemanticState,
): boolean {
  return left.status === right.status
    && (left.status !== "settled"
      || (right.status === "settled" && left.cents === right.cents));
}

function makeFace(position: string, half: "top" | "bottom"): HTMLSpanElement {
  const face = document.createElement("span");
  face.dataset.sfFace = position;
  face.dataset.sfHalf = half;
  return face;
}

function commitCell(cell: Cell, glyph: string): void {
  cell.current = glyph;
  cell.el.dataset.glyph = glyph;
  cell.el.toggleAttribute("data-sf-leading", glyph === " ");
  for (const face of cell.faces) face.textContent = glyph;
}

function makeCell(): Cell {
  const el = document.createElement("span");
  el.dataset.sfCell = "";
  const topNext = makeFace("top-next", "top");
  const bottomCurrent = makeFace("bottom-current", "bottom");
  const topCurrent = makeFace("top-current", "top");
  const bottomNext = makeFace("bottom-next", "bottom");
  const faces = [topNext, bottomCurrent, topCurrent, bottomNext];
  el.append(...faces);
  const cell: Cell = {
    el,
    faces,
    topNext,
    bottomCurrent,
    topCurrent,
    bottomNext,
    current: " ",
  };
  commitCell(cell, " ");
  return cell;
}

export class SplitFlapEngine {
  readonly root: HTMLElement;
  readonly rack: HTMLElement;
  readonly integerSlots: IntegerSlots;
  readonly motionQuery: MediaQueryList;

  reduced: boolean;
  mode: MotionMode = "idle";

  private semanticState: SplitFlapSemanticState;
  private readonly onAnnounce: Announce;
  private readonly manageAria: boolean;
  private generation = 0;
  private reelSteps: number[] = [];
  private cells: Cell[] = [];
  private reelCells: Cell[] = [];
  private decimalCell!: Cell;
  private readonly animations = new Set<Animation>();
  private readonly sleeps = new Map<number, () => void>();
  private readonly visibleWaiters = new Set<() => void>();
  private pausedMotion: string | null = null;
  private busyReels: Promise<void[]> | null = null;
  private pendingResult: LandingResult | null = null;
  private destroyed = false;

  constructor(
    root: HTMLElement,
    rack: HTMLElement,
    {
      integerSlots,
      state,
      onAnnounce = () => {},
      manageAria = true,
    }: {
      integerSlots: IntegerSlots;
      state: SplitFlapSemanticState;
      onAnnounce?: Announce;
      manageAria?: boolean;
    },
  ) {
    validateSemanticState(state, integerSlots);

    this.root = root;
    this.rack = rack;
    this.integerSlots = integerSlots;
    this.semanticState = state;
    this.onAnnounce = onAnnounce;
    this.manageAria = manageAria;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = this.motionQuery.matches;

    this.motionQuery.addEventListener("change", this.onMotionChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.build();
    this.applyInitialState(state);
  }

  update(state: SplitFlapSemanticState): Promise<void> | void {
    validateSemanticState(state, this.integerSlots);
    if (sameSemanticState(this.semanticState, state)) return;

    this.semanticState = state;
    if (state.status === "busy") {
      this.onAnnounce(null);
      this.startBusy();
      return;
    }
    if (state.status === "unknown") {
      return this.setUnknown({ animate: true, announce: true });
    }
    return this.setKnownCents(state.cents, { animate: true, announce: true });
  }

  private applyInitialState(state: SplitFlapSemanticState): void {
    if (state.status === "settled") {
      void this.setKnownCents(state.cents, { animate: false, announce: false });
      return;
    }
    if (state.status === "unknown") {
      void this.setUnknown({ animate: false, announce: false });
      return;
    }
    this.startBusy({ fromUnknown: true });
  }

  private build(): void {
    this.rack.replaceChildren();
    this.cells = Array.from({ length: this.integerSlots + 2 }, () => makeCell());
    this.decimalCell = makeCell();
    this.decimalCell.el.dataset.sfDecimal = "";
    commitCell(this.decimalCell, ".");
    this.reelCells = [...this.cells];
    this.reelCells.splice(this.integerSlots, 0, this.decimalCell);
    this.rack.append(...this.reelCells.map((cell) => cell.el));
  }

  private interrupt(): number {
    this.generation += 1;
    this.wakeSleeps();
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.busyReels = null;
    this.pausedMotion = null;
    for (const resolve of this.visibleWaiters) resolve();
    this.visibleWaiters.clear();
    return this.generation;
  }

  private wakeSleeps(): void {
    for (const [id, resolve] of this.sleeps) {
      window.clearTimeout(id);
      resolve();
    }
    this.sleeps.clear();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = window.setTimeout(() => {
        this.sleeps.delete(id);
        resolve();
      }, ms);
      this.sleeps.set(id, resolve);
    });
  }

  private async waitUntilVisible(): Promise<void> {
    if (!document.hidden) return;
    await new Promise<void>((resolve) => this.visibleWaiters.add(resolve));
  }

  private snap(glyphs: readonly string[]): void {
    this.reelCells.forEach((cell, index) => commitCell(cell, glyphs[index]));
  }

  private unknownGlyphs(): string[] {
    return displayGlyphs(this.cells.map(() => "—"), this.integerSlots);
  }

  private async flipCell(
    cell: Cell,
    next: string,
    token: number,
    duration = FLIP_MS,
    delay = 0,
    easing = FLIP_EASING,
  ): Promise<void> {
    if (cell.current === next) return;
    if (this.reduced || typeof cell.el.animate !== "function") {
      if (token === this.generation) commitCell(cell, next);
      return;
    }

    cell.topNext.textContent = next;
    cell.bottomNext.textContent = next;
    cell.topCurrent.textContent = cell.current;
    cell.bottomCurrent.textContent = cell.current;

    const options: KeyframeAnimationOptions = {
      duration,
      delay,
      easing,
      fill: "forwards",
    };
    const top = cell.topCurrent.animate(
      [{ transform: "rotateX(0deg)" }, { transform: "rotateX(-180deg)" }],
      options,
    );
    const bottom = cell.bottomNext.animate(
      [{ transform: "rotateX(180deg)" }, { transform: "rotateX(0deg)" }],
      options,
    );
    this.animations.add(top);
    this.animations.add(bottom);
    await Promise.all([
      top.finished.catch(() => undefined),
      bottom.finished.catch(() => undefined),
    ]);
    this.animations.delete(top);
    this.animations.delete(bottom);
    if (token !== this.generation) return;
    commitCell(cell, next);
    top.cancel();
    bottom.cancel();
  }

  private async flipTo(
    glyphs: readonly string[],
    token: number,
    {
      duration = FLIP_MS,
      stagger = 0,
      easing = FLIP_EASING,
    }: { duration?: number; stagger?: number; easing?: string } = {},
  ): Promise<void> {
    await Promise.all(
      this.reelCells.map((cell, index) =>
        this.flipCell(cell, glyphs[index], token, duration, stagger * index, easing),
      ),
    );
  }

  private setMetadata(
    state: string,
    motion: string,
    label: string,
    value = "",
  ): void {
    if (this.destroyed) return;
    this.root.dataset.state = state;
    this.root.dataset.motion = motion;
    this.root.dataset.value = value;
    if (this.manageAria) this.root.setAttribute("aria-label", label);
  }

  private setKnownCents(
    cents: number,
    { animate = true, announce = true } = {},
  ): Promise<void> {
    const glyphs = displayGlyphs(
      glyphsForCents(cents, this.integerSlots),
      this.integerSlots,
    );
    const formatted = formatCents(cents);
    const result = { status: "settled", cents, glyphs, formatted, announce } as const;

    if (this.mode === "busy" && animate && !this.reduced && !document.hidden) {
      return this.settleBusyResult(result);
    }

    this.pendingResult = null;
    const token = this.interrupt();
    this.mode = "idle";

    if (!animate || this.reduced || document.hidden) {
      this.snap(glyphs);
      this.setMetadata("settled", "static", `Total spend: ${formatted}`, formatted);
      if (announce) this.onAnnounce(`Total spend ${formatted}`);
      return Promise.resolve();
    }

    this.setMetadata("settling", "settling", `Total spend: ${formatted}`, formatted);
    if (announce) this.onAnnounce(`Total spend ${formatted}`);
    return this.flipTo(glyphs, token).then(() => {
      if (token === this.generation) {
        this.setMetadata("settled", "static", `Total spend: ${formatted}`, formatted);
      }
    });
  }

  private settleBusyResult(result: LandingResult): Promise<void> {
    const token = this.generation;
    const boundary = this.busyReels;
    this.mode = "settling";
    this.pendingResult = result;
    this.setMetadata("settling", "settling", "Total spend: calculating");
    // Wake resting reels; active hinges finish before the coordinated landing.
    this.wakeSleeps();
    return this.landBusyResult(result, token, boundary);
  }

  private async landBusyResult(
    result: LandingResult,
    token: number,
    boundary: Promise<void[]> | null,
  ): Promise<void> {
    if (boundary) await boundary;
    if (token !== this.generation || this.pendingResult !== result) return;
    if (this.busyReels === boundary) this.busyReels = null;

    if (result.status === "settled") {
      const current = this.reelCells.map((cell) => cell.current);
      const phase = this.reelSteps.reduce((total, step) => total + step, 0);
      const intermediate = settleScrambleGlyphs(current, result.glyphs, phase);
      await this.flipTo(intermediate, token, {
        duration: 160,
        stagger: 30,
        easing: SETTLE_EASING,
      });
      if (token !== this.generation || this.pendingResult !== result) return;
    }

    await this.flipTo(result.glyphs, token, {
      duration: 240,
      stagger: 30,
      easing: SETTLE_EASING,
    });
    if (token !== this.generation || this.pendingResult !== result) return;
    this.commitResult(result);
  }

  private commitResult(result: LandingResult): void {
    if (result.status === "unknown") {
      this.commitUnknownResult(result);
      return;
    }

    this.pendingResult = null;
    this.mode = "idle";
    this.setMetadata(
      "settled",
      "static",
      `Total spend: ${result.formatted}`,
      result.formatted,
    );
    if (result.announce) this.onAnnounce(`Total spend ${result.formatted}`);
  }

  private setUnknown(
    { animate = true, announce = true } = {},
  ): Promise<void> {
    const result = {
      status: "unknown",
      glyphs: this.unknownGlyphs(),
      announce,
    } as const;

    if (this.mode === "busy" && animate && !this.reduced && !document.hidden) {
      if (announce) this.onAnnounce(null);
      return this.settleBusyResult(result);
    }

    this.pendingResult = null;
    const token = this.interrupt();
    this.mode = "idle";

    if (!animate || this.reduced || document.hidden) {
      this.snap(result.glyphs);
      this.commitUnknownResult(result);
      return Promise.resolve();
    }

    if (announce) this.onAnnounce(null);
    this.pendingResult = result;
    this.mode = "settling";
    this.setMetadata("settling", "settling", "Total spend unavailable");
    return this.flipTo(result.glyphs, token, {
      duration: 240,
      stagger: 30,
      easing: SETTLE_EASING,
    }).then(() => {
      if (token === this.generation && this.pendingResult === result) {
        this.commitUnknownResult(result);
      }
    });
  }

  private commitUnknownResult(
    result: Extract<LandingResult, { status: "unknown" }>,
  ): void {
    this.pendingResult = null;
    this.mode = "idle";
    this.setMetadata("unknown", "static", "Total spend unavailable");
    if (result.announce) this.onAnnounce("Total spend unavailable");
  }

  private startBusy({ fromUnknown = false } = {}): void {
    this.pendingResult = null;
    const token = this.interrupt();
    this.mode = "busy";
    this.reelSteps = this.reelCells.map(() => 0);
    if (fromUnknown || this.reduced) this.snap(this.unknownGlyphs());
    this.setMetadata(
      "busy",
      this.reduced ? "static" : "rolling",
      "Total spend: calculating",
    );
    if (this.reduced) return;
    if (document.hidden) {
      this.pausedMotion = "rolling";
      this.root.dataset.motion = "paused";
    }
    const busyReels = Promise.all(
      this.reelCells.map((cell, index) => this.rollReel(cell, index, token)),
    );
    this.busyReels = busyReels;
    void busyReels;
  }

  private async rollReel(cell: Cell, index: number, token: number): Promise<void> {
    await this.waitUntilVisible();
    if (this.mode !== "busy" || token !== this.generation) return;
    const timing = busyReelTiming(index);
    await this.delay(timing.offset);

    while (this.mode === "busy" && token === this.generation) {
      await this.waitUntilVisible();
      if (this.mode !== "busy" || token !== this.generation) return;
      const flip = this.reelSteps[index];
      this.reelSteps[index] += 1;
      const glyph = cell === this.decimalCell
        ? busyGlyphForDecimal(flip)
        : busyGlyphForCell(index, flip);
      await this.flipCell(cell, glyph, token, busyFlipDuration(index, flip));
      if (this.mode !== "busy" || token !== this.generation) return;
      await this.delay(timing.hold);
    }
  }

  private readonly onMotionChange = (): void => {
    this.reduced = this.motionQuery.matches;
    if (this.mode === "settling" && this.pendingResult) {
      const pending = this.pendingResult;
      this.interrupt();
      this.snap(pending.glyphs);
      this.commitResult(pending);
      return;
    }
    if (this.mode === "busy") {
      this.startBusy({ fromUnknown: this.reduced });
      return;
    }
    if (this.semanticState.status === "settled") {
      void this.setKnownCents(this.semanticState.cents, {
        animate: false,
        announce: false,
      });
    } else if (this.semanticState.status === "unknown") {
      void this.setUnknown({ animate: false, announce: false });
    }
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.mode === "settling" && this.pendingResult) {
        const pending = this.pendingResult;
        this.interrupt();
        this.snap(pending.glyphs);
        this.commitResult(pending);
        return;
      }
      this.pausedMotion = this.root.dataset.motion ?? null;
      if (this.pausedMotion !== "static") this.root.dataset.motion = "paused";
      for (const animation of this.animations) animation.pause();
      return;
    }
    for (const animation of this.animations) animation.play();
    if (this.pausedMotion !== null) this.root.dataset.motion = this.pausedMotion;
    this.pausedMotion = null;
    for (const resolve of this.visibleWaiters) resolve();
    this.visibleWaiters.clear();
  };

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingResult = null;
    this.interrupt();
    this.motionQuery.removeEventListener("change", this.onMotionChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.rack.replaceChildren();
    this.root.removeAttribute("data-state");
    this.root.removeAttribute("data-motion");
    this.root.removeAttribute("data-value");
    if (this.manageAria) this.root.removeAttribute("aria-label");
  }
}
