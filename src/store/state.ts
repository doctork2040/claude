import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const STATE_PATH = resolve(process.cwd(), "data/state.json");
const MAX_EVENTS = 500;

export interface OpenCopy {
  conditionId: string;
  tokenId: string;
  outcomeIndex: number;
  size: number;
  avgPrice: number;
  sourceWallet: string;
  sourceLabel?: string;
  title?: string;
  slug?: string;
  openedAt: number;
}

export interface Event {
  ts: number;
  kind: "signal" | "buy" | "sell" | "error";
  wallet: string;
  walletLabel?: string;
  title?: string;
  slug?: string;
  side?: "BUY" | "SELL";
  outcome?: string;
  price?: number;
  size?: number;
  notional?: number;
  copied?: boolean;
  dryRun?: boolean;
  error?: string;
}

export interface StoreShape {
  lastTradeTs: Record<string, number>;
  openCopies: Record<string, OpenCopy>;
  events: Event[];
}

function empty(): StoreShape {
  return { lastTradeTs: {}, openCopies: {}, events: [] };
}

export function loadState(): StoreShape {
  if (!existsSync(STATE_PATH)) return empty();
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Partial<StoreShape>;
    return {
      lastTradeTs: raw.lastTradeTs ?? {},
      openCopies: raw.openCopies ?? {},
      events: raw.events ?? [],
    };
  } catch {
    return empty();
  }
}

export function saveState(state: StoreShape): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function appendEvent(state: StoreShape, event: Event): void {
  state.events.push(event);
}
