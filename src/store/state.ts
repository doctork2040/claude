import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const STATE_PATH = resolve(process.cwd(), "data/state.json");

export interface StoreShape {
  lastTradeTs: Record<string, number>;
  openCopies: Record<string, { tokenId: string; size: number; price: number }>;
}

function empty(): StoreShape {
  return { lastTradeTs: {}, openCopies: {} };
}

export function loadState(): StoreShape {
  if (!existsSync(STATE_PATH)) return empty();
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as StoreShape;
  } catch {
    return empty();
  }
}

export function saveState(state: StoreShape): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
