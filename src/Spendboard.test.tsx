// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Spendboard, type IntegerSlots } from "./Spendboard";

type FrameRequest = { id: number; callback: FrameRequestCallback };

type MockMediaQuery = MediaQueryList & {
  setMatches(matches: boolean): void;
};

let reducedMotion = false;
let frameId = 0;
let frames: FrameRequest[] = [];
let mediaQueries: MockMediaQuery[] = [];
let deferredAnimations = false;
let finishAnimations: Array<() => void> = [];
let animations: Animation[] = [];
let animateMock: ReturnType<typeof vi.fn>;

function makeMediaQuery(query: string): MockMediaQuery {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let currentMatches = reducedMotion;
  const mediaQuery = {
    get matches() {
      return currentMatches;
    },
    media: query,
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    setMatches(matches: boolean) {
      currentMatches = matches;
      const event = { matches, media: query } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  } as MockMediaQuery;
  mediaQueries.push(mediaQuery);
  return mediaQuery;
}

function makeAnimation(): Animation {
  const finished = deferredAnimations
    ? new Promise<void>((resolve) => {
      finishAnimations.push(resolve);
    })
    : Promise.resolve();
  const animation = {
    finished,
    cancel: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
  } as unknown as Animation;
  animations.push(animation);
  return animation;
}

async function flushMicrotasks(rounds = 30): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
  });
}

function flushAnimationFrame(): void {
  const pending = frames;
  frames = [];
  act(() => {
    for (const { callback } of pending) callback(performance.now());
  });
}

function finishAnimationRange(start: number, end: number): void {
  act(() => {
    for (const finish of finishAnimations.slice(start, end)) finish();
  });
}

function glyphs(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-sf-cell]"),
    (cell) => cell.dataset.glyph ?? "",
  );
}

function liveRegion(root: HTMLElement): HTMLElement {
  return root.parentElement!.querySelector<HTMLElement>("[aria-live='polite']")!;
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  frameId = 0;
  frames = [];
  mediaQueries = [];
  deferredAnimations = false;
  finishAnimations = [];
  animations = [];
  animateMock = vi.fn(makeAnimation);

  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => makeMediaQuery(query)),
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      const id = ++frameId;
      frames.push({ id, callback });
      return id;
    }),
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: vi.fn((id: number) => {
      frames = frames.filter((frame) => frame.id !== id);
    }),
  });
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animateMock,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("initial render", () => {
  it("renders a settled amount exactly without animating or announcing", () => {
    render(<Spendboard status="settled" cents={31} />);

    const root = screen.getByRole("img", { name: "Total spend: $0.31" });
    expect(root.dataset.state).toBe("settled");
    expect(root.dataset.motion).toBe("static");
    expect(root.dataset.value).toBe("$0.31");
    expect(root.dataset.sfSlots).toBe("2");
    expect(glyphs(root)).toEqual([" ", "0", ".", "3", "1"]);
    expect(root.querySelector("[data-sf-board]")?.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelectorAll("[aria-live='polite']")).toHaveLength(0);
    expect(root.parentElement?.querySelectorAll("[aria-live='polite']")).toHaveLength(1);
    expect(liveRegion(root)).toBeEmptyDOMElement();
    expect(animateMock).toHaveBeenCalledTimes(0);
  });

  it("renders unknown as dashes with a final decimal point", () => {
    render(<Spendboard status="unknown" />);

    const root = screen.getByRole("img", { name: "Total spend unavailable" });
    expect(root.dataset.state).toBe("unknown");
    expect(glyphs(root)).toEqual(["—", "—", ".", "—", "—"]);
    expect(liveRegion(root)).toBeEmptyDOMElement();
  });

  it("starts directly busy from unknown dashes rather than a fake zero", () => {
    render(<Spendboard status="busy" />);

    const root = screen.getByRole("img", { name: "Total spend: calculating" });
    expect(root.dataset.state).toBe("busy");
    expect(root.dataset.motion).toBe("rolling");
    expect(root.dataset.value).toBe("");
    expect(glyphs(root)).toEqual(["—", "—", ".", "—", "—"]);
    expect(liveRegion(root)).toBeEmptyDOMElement();
  });

  it("validates slots and cents before mounting the engine", () => {
    expect(() => render(
      <Spendboard status="settled" cents={1_000} integerSlots={1} />,
    )).toThrow(RangeError);
    expect(() => render(
      <Spendboard status="unknown" integerSlots={5 as IntegerSlots} />,
    )).toThrow(RangeError);
    expect(() => render(
      <Spendboard status="unknown" integerSlots={null as unknown as IntegerSlots} />,
    )).toThrow(RangeError);
    expect(() => render(
      <Spendboard status={"invalid" as "busy"} />,
    )).toThrow(TypeError);
  });

  it("can defer semantics to an accessible outer control", () => {
    render(
      <button type="button" aria-label="Spend details">
        <Spendboard presentationOnly status="settled" cents={31} />
      </button>,
    );

    const button = screen.getByRole("button", { name: "Spend details" });
    const root = button.querySelector<HTMLElement>("[data-sf-slots]")!;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).not.toHaveAttribute("aria-label");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector("[aria-live]")).not.toBeInTheDocument();
  });
});

describe("semantic updates", () => {
  it("does not restart or announce an identical settled rerender", async () => {
    const { rerender } = render(<Spendboard status="settled" cents={31} />);
    const root = screen.getByRole("img");
    const requestFrame = vi.mocked(window.requestAnimationFrame);

    rerender(<Spendboard status="settled" cents={32} />);
    await flushMicrotasks();
    flushAnimationFrame();
    expect(liveRegion(root)).toHaveTextContent("Total spend $0.32");
    const animationCalls = animateMock.mock.calls.length;
    const frameCalls = requestFrame.mock.calls.length;

    rerender(<Spendboard status="settled" cents={32} />);
    await flushMicrotasks();
    expect(animateMock).toHaveBeenCalledTimes(animationCalls);
    expect(requestFrame).toHaveBeenCalledTimes(frameCalls);
    expect(liveRegion(root)).toHaveTextContent("Total spend $0.32");
  });

  it("lands and announces busy to settled only after the landing completes", async () => {
    const { rerender } = render(<Spendboard status="busy" />);
    const root = screen.getByRole("img");

    await flushMicrotasks();
    rerender(<Spendboard status="settled" cents={31} />);
    expect(root).toHaveAttribute("aria-label", "Total spend: calculating");
    expect(liveRegion(root)).toBeEmptyDOMElement();

    await flushMicrotasks();
    expect(root.dataset.state).toBe("settled");
    expect(root).toHaveAttribute("aria-label", "Total spend: $0.31");
    expect(glyphs(root)).toEqual([" ", "0", ".", "3", "1"]);
    expect(liveRegion(root)).toBeEmptyDOMElement();

    flushAnimationFrame();
    expect(liveRegion(root)).toHaveTextContent("Total spend $0.31");
  });

  it("does not restart busy on a busy rerender", async () => {
    deferredAnimations = true;
    const { rerender } = render(<Spendboard status="busy" />);
    await flushMicrotasks();
    await act(async () => vi.advanceTimersByTime(120));
    await flushMicrotasks();
    expect(animations.length).toBeGreaterThan(0);
    const animationCount = animations.length;
    const cancelCount = animations.reduce(
      (total, animation) => total + vi.mocked(animation.cancel).mock.calls.length,
      0,
    );

    rerender(<Spendboard status="busy" />);
    await flushMicrotasks();
    expect(animations).toHaveLength(animationCount);
    expect(animations.reduce(
      (total, animation) => total + vi.mocked(animation.cancel).mock.calls.length,
      0,
    )).toBe(cancelCount);
  });

  it("clears and reannounces a fresh busy to the same settled value", async () => {
    const { rerender } = render(<Spendboard status="settled" cents={31} />);
    const root = screen.getByRole("img");

    rerender(<Spendboard status="busy" />);
    await flushMicrotasks();
    expect(liveRegion(root)).toBeEmptyDOMElement();

    rerender(<Spendboard status="settled" cents={31} />);
    await flushMicrotasks();
    flushAnimationFrame();
    expect(root.dataset.state).toBe("settled");
    expect(liveRegion(root)).toHaveTextContent("Total spend $0.31");
  });

  it("preserves busy and unknown semantics while changing slot count", async () => {
    const busy = render(<Spendboard status="busy" />);
    let root = screen.getByRole("img");
    await flushMicrotasks();

    busy.rerender(<Spendboard status="busy" integerSlots={3} />);
    root = screen.getByRole("img");
    expect(root.dataset.state).toBe("busy");
    expect(root.dataset.sfSlots).toBe("3");
    expect(glyphs(root)).toEqual(["—", "—", "—", ".", "—", "—"]);
    busy.unmount();

    const unknown = render(<Spendboard status="unknown" />);
    root = screen.getByRole("img");
    unknown.rerender(<Spendboard status="unknown" integerSlots={4} />);
    expect(root.dataset.state).toBe("unknown");
    expect(root.dataset.sfSlots).toBe("4");
    expect(glyphs(root)).toEqual(["—", "—", "—", "—", ".", "—", "—"]);
    expect(liveRegion(root)).toBeEmptyDOMElement();
  });

  it("announces a status change that also recreates the slot rack", async () => {
    const { rerender } = render(<Spendboard status="busy" />);
    const root = screen.getByRole("img");
    await flushMicrotasks();

    rerender(
      <Spendboard status="settled" cents={31} integerSlots={3} />,
    );
    expect(root.dataset.state).toBe("settled");
    expect(glyphs(root)).toEqual([" ", " ", "0", ".", "3", "1"]);
    expect(liveRegion(root)).toBeEmptyDOMElement();

    flushAnimationFrame();
    expect(liveRegion(root)).toHaveTextContent("Total spend $0.31");
  });

  it("preserves a completed milestone announcement through a slot-only change", async () => {
    const { rerender } = render(<Spendboard status="settled" cents={31} />);
    const root = screen.getByRole("img");

    rerender(<Spendboard status="unknown" />);
    await flushMicrotasks();
    rerender(<Spendboard status="unknown" integerSlots={3} />);
    expect(liveRegion(root)).toBeEmptyDOMElement();

    flushAnimationFrame();
    expect(liveRegion(root)).toHaveTextContent("Total spend unavailable");
  });

  it("preserves one pending unknown announcement when slots change mid-landing", async () => {
    deferredAnimations = true;
    const { rerender } = render(<Spendboard status="settled" cents={31} />);
    const root = screen.getByRole("img");
    const requestFrame = vi.mocked(window.requestAnimationFrame);

    rerender(<Spendboard status="unknown" />);
    const staleAnimationEnd = finishAnimations.length;
    expect(root.dataset.state).toBe("settling");

    rerender(<Spendboard status="unknown" integerSlots={3} />);
    expect(root.dataset.state).toBe("unknown");
    expect(glyphs(root)).toEqual(["—", "—", "—", ".", "—", "—"]);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(liveRegion(root)).toBeEmptyDOMElement();

    finishAnimationRange(0, staleAnimationEnd);
    await flushMicrotasks();
    expect(requestFrame).toHaveBeenCalledTimes(1);
    flushAnimationFrame();
    expect(liveRegion(root)).toHaveTextContent("Total spend unavailable");

    rerender(<Spendboard status="unknown" integerSlots={4} />);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(liveRegion(root)).toHaveTextContent("Total spend unavailable");
  });

  it("smoothly lands settled to unknown and announces once at completion", async () => {
    deferredAnimations = true;
    const { rerender } = render(<Spendboard status="settled" cents={31} />);
    const root = screen.getByRole("img");
    const requestFrame = vi.mocked(window.requestAnimationFrame);

    rerender(<Spendboard status="unknown" />);
    expect(root.dataset.state).toBe("settling");
    expect(glyphs(root)).toEqual([" ", "0", ".", "3", "1"]);
    expect(liveRegion(root)).toBeEmptyDOMElement();
    expect(animateMock).toHaveBeenCalledTimes(8);
    expect(animateMock.mock.calls.every(([, options]) => (
      (options as KeyframeAnimationOptions).duration === 240
      && (options as KeyframeAnimationOptions).easing === "cubic-bezier(.33, 1, .68, 1)"
    ))).toBe(true);

    finishAnimationRange(0, finishAnimations.length);
    await flushMicrotasks();
    expect(root.dataset.state).toBe("unknown");
    expect(glyphs(root)).toEqual(["—", "—", ".", "—", "—"]);
    expect(liveRegion(root)).toBeEmptyDOMElement();
    flushAnimationFrame();
    expect(liveRegion(root)).toHaveTextContent("Total spend unavailable");
    const frameCalls = requestFrame.mock.calls.length;

    rerender(<Spendboard status="unknown" />);
    expect(requestFrame).toHaveBeenCalledTimes(frameCalls);
    expect(liveRegion(root)).toHaveTextContent("Total spend unavailable");
  });

  it("finishes active busy hinges, then makes one coordinated unknown landing", async () => {
    deferredAnimations = true;
    const { rerender } = render(<Spendboard status="busy" />);
    const root = screen.getByRole("img");
    await flushMicrotasks();
    await act(async () => vi.advanceTimersByTime(120));
    await flushMicrotasks();
    const busyAnimationEnd = finishAnimations.length;
    expect(busyAnimationEnd).toBe(10);

    rerender(<Spendboard status="unknown" />);
    expect(root.dataset.state).toBe("settling");
    expect(root).toHaveAttribute("aria-label", "Total spend: calculating");
    expect(vi.getTimerCount()).toBe(0);
    expect(animations.slice(0, busyAnimationEnd).every(
      (animation) => vi.mocked(animation.cancel).mock.calls.length === 0,
    )).toBe(true);
    expect(glyphs(root)).toEqual(["—", "—", ".", "—", "—"]);

    finishAnimationRange(0, busyAnimationEnd);
    await flushMicrotasks();
    const landingEnd = finishAnimations.length;
    expect(landingEnd - busyAnimationEnd).toBe(10);
    expect(glyphs(root).every((glyph) => glyph !== "—")).toBe(true);
    expect(animateMock.mock.calls.slice(busyAnimationEnd).every(([, options]) => (
      (options as KeyframeAnimationOptions).duration === 240
    ))).toBe(true);
    expect(liveRegion(root)).toBeEmptyDOMElement();

    finishAnimationRange(busyAnimationEnd, landingEnd);
    await flushMicrotasks();
    expect(root.dataset.state).toBe("unknown");
    expect(glyphs(root)).toEqual(["—", "—", ".", "—", "—"]);
    expect(liveRegion(root)).toBeEmptyDOMElement();
    flushAnimationFrame();
    expect(liveRegion(root)).toHaveTextContent("Total spend unavailable");
  });

  it("cancels a stale unknown landing on a rapid state change", async () => {
    deferredAnimations = true;
    const { rerender } = render(<Spendboard status="settled" cents={31} />);
    const root = screen.getByRole("img");

    rerender(<Spendboard status="unknown" />);
    const unknownAnimationEnd = finishAnimations.length;
    rerender(<Spendboard status="busy" />);
    expect(root.dataset.state).toBe("busy");
    expect(animations.slice(0, unknownAnimationEnd).every(
      (animation) => vi.mocked(animation.cancel).mock.calls.length === 1,
    )).toBe(true);

    finishAnimationRange(0, unknownAnimationEnd);
    await flushMicrotasks();
    flushAnimationFrame();
    expect(root.dataset.state).toBe("busy");
    expect(root).toHaveAttribute("aria-label", "Total spend: calculating");
    expect(liveRegion(root)).toBeEmptyDOMElement();
  });

  it("uses the tuned busy duration and softer easing", async () => {
    render(<Spendboard status="busy" />);
    await flushMicrotasks();
    await act(async () => vi.advanceTimersByTime(1));
    await flushMicrotasks();

    const options = animateMock.mock.calls[0][1] as KeyframeAnimationOptions;
    expect(options.duration).toBe(300);
    expect(options.easing).toBe("cubic-bezier(.35, 0, .65, 1)");
  });

  it("uses no animations or timers in reduced motion", async () => {
    reducedMotion = true;
    const { rerender } = render(<Spendboard status="busy" />);
    const root = screen.getByRole("img");
    await flushMicrotasks();

    expect(root.dataset.motion).toBe("static");
    expect(glyphs(root)).toEqual(["—", "—", ".", "—", "—"]);
    expect(animateMock).toHaveBeenCalledTimes(0);
    expect(vi.getTimerCount()).toBe(0);

    rerender(<Spendboard status="settled" cents={31} />);
    await flushMicrotasks();
    expect(root.dataset.state).toBe("settled");
    expect(glyphs(root)).toEqual([" ", "0", ".", "3", "1"]);
    expect(animateMock).toHaveBeenCalledTimes(0);
    expect(vi.getTimerCount()).toBe(0);

    rerender(<Spendboard status="unknown" />);
    await flushMicrotasks();
    expect(root.dataset.state).toBe("unknown");
    expect(glyphs(root)).toEqual(["—", "—", ".", "—", "—"]);
    expect(animateMock).toHaveBeenCalledTimes(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops active reels when reduced motion is enabled", async () => {
    render(<Spendboard status="busy" />);
    const root = screen.getByRole("img");
    await flushMicrotasks();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => mediaQueries[0].setMatches(true));
    await flushMicrotasks();
    expect(root.dataset.motion).toBe("static");
    expect(glyphs(root)).toEqual(["—", "—", ".", "—", "—"]);
    expect(animateMock).toHaveBeenCalledTimes(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("snaps a pending landing when the document becomes hidden", async () => {
    const { rerender } = render(<Spendboard status="busy" />);
    const root = screen.getByRole("img");
    await flushMicrotasks();

    rerender(<Spendboard status="settled" cents={31} />);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(root.dataset.state).toBe("settled");
    expect(root.dataset.motion).toBe("static");
    expect(glyphs(root)).toEqual([" ", "0", ".", "3", "1"]);
    expect(liveRegion(root)).toBeEmptyDOMElement();
    flushAnimationFrame();
    expect(liveRegion(root)).toHaveTextContent("Total spend $0.31");
  });

  it("snaps an unknown transition when the document is already hidden", async () => {
    const { rerender } = render(<Spendboard status="settled" cents={31} />);
    const root = screen.getByRole("img");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    rerender(<Spendboard status="unknown" />);
    await flushMicrotasks();
    expect(root.dataset.state).toBe("unknown");
    expect(root.dataset.motion).toBe("static");
    expect(glyphs(root)).toEqual(["—", "—", ".", "—", "—"]);
    expect(animateMock).toHaveBeenCalledTimes(0);
    flushAnimationFrame();
    expect(liveRegion(root)).toHaveTextContent("Total spend unavailable");
  });
});

describe("lifecycle", () => {
  it("fully tears down Strict Mode listeners and blocks stale completions", async () => {
    deferredAnimations = true;
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const view = render(
      <StrictMode>
        <Spendboard status="settled" cents={31} />
      </StrictMode>,
    );
    const root = screen.getByRole("img");

    view.rerender(
      <StrictMode>
        <Spendboard status="settled" cents={32} />
      </StrictMode>,
    );
    const finalCell = root.querySelectorAll<HTMLElement>("[data-sf-cell]")[4];
    expect(finalCell.dataset.glyph).toBe("1");
    expect(finishAnimations.length).toBeGreaterThan(0);

    const mediaAdds = () => mediaQueries.reduce(
      (total, query) => total + vi.mocked(query.addEventListener).mock.calls.length,
      0,
    );
    const mediaRemoves = () => mediaQueries.reduce(
      (total, query) => total + vi.mocked(query.removeEventListener).mock.calls.length,
      0,
    );
    expect(mediaAdds() - mediaRemoves()).toBe(1);

    view.unmount();
    expect(mediaAdds()).toBe(mediaRemoves());
    const visibilityAdds = addDocumentListener.mock.calls.filter(
      ([type]) => type === "visibilitychange",
    ).length;
    const visibilityRemoves = removeDocumentListener.mock.calls.filter(
      ([type]) => type === "visibilitychange",
    ).length;
    expect(visibilityAdds).toBe(visibilityRemoves);

    for (const finish of finishAnimations) finish();
    await flushMicrotasks();
    expect(finalCell.dataset.glyph).toBe("1");
    expect(root.hasAttribute("data-state")).toBe(false);

    addDocumentListener.mockRestore();
    removeDocumentListener.mockRestore();
  });
});
