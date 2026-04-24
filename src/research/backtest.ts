import { fetchAllTrades } from "../polymarket/dataApi.js";
import type { PolyTrade } from "../types.js";
import type { TrackedWallet } from "../config.js";

export interface BacktestConfig {
  notionalUsdc: number;
  maxOpenPositions: number;
  maxBuyPrice: number;
  slippageBps: number;
}

export interface ClosedCopy {
  conditionId: string;
  title?: string;
  slug?: string;
  sourceWallet: string;
  sourceLabel?: string;
  buyTs: number;
  sellTs: number;
  buyPrice: number;
  sellPrice: number;
  size: number;
  pnl: number;
  holdingHours: number;
}

export interface OpenCopy {
  conditionId: string;
  title?: string;
  slug?: string;
  sourceWallet: string;
  sourceLabel?: string;
  buyTs: number;
  buyPrice: number;
  size: number;
}

export interface BacktestResult {
  totalTrades: number;
  copiesOpened: number;
  copiesSkipped: number;
  copiesClosed: number;
  unresolvedOpen: number;
  realizedPnl: number;
  winRate: number;
  avgHoldingHours: number;
  maxDrawdown: number;
  closedCopies: ClosedCopy[];
  openCopies: OpenCopy[];
  equityCurve: Array<{ ts: number; equity: number }>;
  perSourceWallet: Record<string, { trades: number; pnl: number; wins: number; losses: number }>;
}

interface AnnotatedTrade extends PolyTrade {
  sourceLabel?: string;
}

export async function collectTrades(wallets: TrackedWallet[]): Promise<AnnotatedTrade[]> {
  const all: AnnotatedTrade[] = [];
  for (const w of wallets) {
    const trades = await fetchAllTrades(w.address);
    for (const t of trades) all.push({ ...t, sourceLabel: w.label });
  }
  return all.sort((a, b) => a.timestamp - b.timestamp);
}

export function simulate(
  trades: AnnotatedTrade[],
  cfg: BacktestConfig,
): BacktestResult {
  const open = new Map<string, OpenCopy>();
  const closed: ClosedCopy[] = [];
  const perWallet: Record<string, { trades: number; pnl: number; wins: number; losses: number }> = {};
  const equity: Array<{ ts: number; equity: number }> = [];
  let realized = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let opened = 0;
  let skipped = 0;

  const bump = (wallet: string) => {
    perWallet[wallet] ??= { trades: 0, pnl: 0, wins: 0, losses: 0 };
    return perWallet[wallet]!;
  };

  for (const t of trades) {
    const entry = bump(t.proxyWallet);
    entry.trades++;

    if (t.side === "BUY") {
      const hasOpen = open.has(t.conditionId);
      const canOpen =
        !hasOpen && open.size < cfg.maxOpenPositions && t.price <= cfg.maxBuyPrice;
      if (!canOpen) {
        skipped++;
        continue;
      }
      const fillPrice = Math.min(t.price * (1 + cfg.slippageBps / 10_000), 0.999);
      const size = cfg.notionalUsdc / fillPrice;
      open.set(t.conditionId, {
        conditionId: t.conditionId,
        title: t.title,
        slug: t.slug,
        sourceWallet: t.proxyWallet,
        sourceLabel: t.sourceLabel,
        buyTs: t.timestamp,
        buyPrice: fillPrice,
        size,
      });
      opened++;
    } else {
      const o = open.get(t.conditionId);
      if (!o || o.sourceWallet !== t.proxyWallet) continue;
      const fillPrice = Math.max(t.price * (1 - cfg.slippageBps / 10_000), 0.001);
      const pnl = (fillPrice - o.buyPrice) * o.size;
      realized += pnl;
      peak = Math.max(peak, realized);
      maxDrawdown = Math.max(maxDrawdown, peak - realized);
      equity.push({ ts: t.timestamp, equity: realized });
      closed.push({
        ...o,
        sellTs: t.timestamp,
        sellPrice: fillPrice,
        pnl,
        holdingHours: (t.timestamp - o.buyTs) / 3600,
      });
      const w = bump(o.sourceWallet);
      w.pnl += pnl;
      if (pnl > 0) w.wins++;
      else w.losses++;
      open.delete(t.conditionId);
    }
  }

  const wins = closed.filter((c) => c.pnl > 0).length;
  const avgHolding = closed.length
    ? closed.reduce((s, c) => s + c.holdingHours, 0) / closed.length
    : 0;

  return {
    totalTrades: trades.length,
    copiesOpened: opened,
    copiesSkipped: skipped,
    copiesClosed: closed.length,
    unresolvedOpen: open.size,
    realizedPnl: realized,
    winRate: closed.length ? wins / closed.length : 0,
    avgHoldingHours: avgHolding,
    maxDrawdown,
    closedCopies: closed,
    openCopies: [...open.values()],
    equityCurve: equity,
    perSourceWallet: perWallet,
  };
}
