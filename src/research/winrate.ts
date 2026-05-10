import { fetchPositions, fetchTrades } from "../polymarket/dataApi.js";
import type { PolyPosition } from "../types.js";

export interface WinRateStats {
  address: string;
  label?: string;
  pnl: number;
  settledMarkets: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlPerMarket: number;
  totalCashPnl: number;
  lastTradeTs: number;
  daysSinceTrade: number;
}

const RESOLVED_EPS = 0.01;
const CLOSED_SIZE_EPS = 0.5;

function isSettled(p: PolyPosition): boolean {
  const resolved = p.curPrice <= RESOLVED_EPS || p.curPrice >= 1 - RESOLVED_EPS;
  const closedOut = p.size < CLOSED_SIZE_EPS;
  return resolved || closedOut;
}

export async function computeWinRate(
  address: string,
  pnl: number,
  label?: string,
): Promise<WinRateStats> {
  const [positions, recent] = await Promise.all([
    fetchPositions(address, { sizeThreshold: 0, limit: 500 }),
    fetchTrades(address, 1, 0),
  ]);
  const settled = positions.filter(isSettled);
  const wins = settled.filter((p) => p.cashPnl > 0).length;
  const losses = settled.length - wins;
  const totalCashPnl = settled.reduce((s, p) => s + p.cashPnl, 0);
  const lastTradeTs = recent[0]?.timestamp ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const daysSinceTrade = lastTradeTs ? (nowSec - lastTradeTs) / 86400 : Infinity;
  return {
    address,
    label,
    pnl,
    settledMarkets: settled.length,
    wins,
    losses,
    winRate: settled.length ? wins / settled.length : 0,
    avgPnlPerMarket: settled.length ? totalCashPnl / settled.length : 0,
    totalCashPnl,
    lastTradeTs,
    daysSinceTrade,
  };
}
