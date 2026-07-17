import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";

import styles from "./Spendboard.module.css";
import {
  SplitFlapEngine,
  formatCents,
  type IntegerSlots,
  type SplitFlapSemanticState,
  validateSemanticState,
} from "./splitFlapEngine";

export type { IntegerSlots } from "./splitFlapEngine";

type SharedProps = {
  integerSlots?: IntegerSlots;
  presentationOnly?: boolean;
  className?: string;
  style?: CSSProperties;
};

export type SpendboardProps = SharedProps & (
  | { status: "settled"; cents: number }
  | { status: "busy"; cents?: never }
  | { status: "unknown"; cents?: never }
);

function ariaLabel(state: SplitFlapSemanticState): string {
  if (state.status === "settled") {
    return `Total spend: ${formatCents(state.cents)}`;
  }
  return state.status === "busy"
    ? "Total spend: calculating"
    : "Total spend unavailable";
}

function stateKey(state: SplitFlapSemanticState): string {
  return state.status === "settled" ? `settled:${state.cents}` : state.status;
}

function announcement(state: SplitFlapSemanticState): string | null {
  if (state.status === "settled") return `Total spend ${formatCents(state.cents)}`;
  return state.status === "unknown" ? "Total spend unavailable" : null;
}

export function Spendboard(props: SpendboardProps) {
  const integerSlots = props.integerSlots === undefined ? 2 : props.integerSlots;
  const presentationOnly = props.presentationOnly ?? false;
  const state: SplitFlapSemanticState = props.status === "settled"
    ? { status: "settled", cents: props.cents }
    : { status: props.status };
  validateSemanticState(state, integerSlots);

  const rootRef = useRef<HTMLSpanElement>(null);
  const rackRef = useRef<HTMLSpanElement>(null);
  const liveRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<SplitFlapEngine | null>(null);
  const appliedStateRef = useRef("");
  const pendingTerminalAnnouncementRef = useRef<string | null>(null);
  const announcementFrameRef = useRef(0);
  const initialAriaLabelRef = useRef<string | null>(null);
  // React seeds SSR once; the engine owns this label through animated landings.
  if (initialAriaLabelRef.current === null) {
    initialAriaLabelRef.current = ariaLabel(state);
  }

  const clearAnnouncement = useCallback(() => {
    if (announcementFrameRef.current) {
      window.cancelAnimationFrame(announcementFrameRef.current);
      announcementFrameRef.current = 0;
    }
    if (liveRef.current) liveRef.current.textContent = "";
  }, []);

  const announce = useCallback((message: string | null) => {
    clearAnnouncement();
    if (!message) return;
    announcementFrameRef.current = window.requestAnimationFrame(() => {
      if (liveRef.current) liveRef.current.textContent = message;
      announcementFrameRef.current = 0;
    });
  }, [clearAnnouncement]);

  const announceFromEngine = useCallback((message: string | null) => {
    if (message) pendingTerminalAnnouncementRef.current = null;
    announce(message);
  }, [announce]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const rack = rackRef.current;
    if (!root || !rack) return;

    const previousKey = appliedStateRef.current;
    const nextKey = stateKey(state);
    const nextAnnouncement = announcement(state);
    const pendingAnnouncement = pendingTerminalAnnouncementRef.current;
    pendingTerminalAnnouncementRef.current = null;
    const engine = new SplitFlapEngine(root, rack, {
      integerSlots,
      state,
      manageAria: !presentationOnly,
      onAnnounce: presentationOnly ? undefined : announceFromEngine,
    });
    engineRef.current = engine;
    appliedStateRef.current = nextKey;

    if (presentationOnly) {
      clearAnnouncement();
    } else if (pendingAnnouncement === nextAnnouncement && pendingAnnouncement) {
      announce(pendingAnnouncement);
    } else if (previousKey && previousKey !== nextKey) {
      announce(nextAnnouncement);
    }

    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [integerSlots, presentationOnly, announce, announceFromEngine, clearAnnouncement]);

  useEffect(() => () => {
    clearAnnouncement();
    appliedStateRef.current = "";
    pendingTerminalAnnouncementRef.current = null;
  }, [clearAnnouncement]);

  useLayoutEffect(() => {
    const key = stateKey(state);
    if (!engineRef.current || appliedStateRef.current === key) return;
    pendingTerminalAnnouncementRef.current = presentationOnly
      ? null
      : announcement(state);
    appliedStateRef.current = key;
    void engineRef.current.update(state);
  }, [
    integerSlots,
    presentationOnly,
    props.status,
    props.status === "settled" ? props.cents : undefined,
  ]);

  const className = props.className
    ? `${styles.root} ${props.className}`
    : styles.root;

  return (
    <>
      <span
        ref={rootRef}
        className={className}
        style={props.style}
        role={presentationOnly ? undefined : "img"}
        aria-hidden={presentationOnly || undefined}
        aria-label={presentationOnly ? undefined : initialAriaLabelRef.current}
        data-sf-slots={integerSlots}
      >
        <span data-sf-label>Total spend</span>
        <span data-sf-board aria-hidden="true">
          <span data-sf-currency>$</span>
          <span ref={rackRef} data-sf-rack aria-hidden="true" />
        </span>
      </span>
      {!presentationOnly && (
        <span
          ref={liveRef}
          className={styles.srOnly}
          aria-live="polite"
          aria-atomic="true"
        />
      )}
    </>
  );
}
