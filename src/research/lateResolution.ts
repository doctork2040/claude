import { fetchActiveMarkets, type MarketWithState } from "../polymarket/gammaApi.js";
import { fetchOrderbooksBatch, type Orderbook } from "../polymarket/clob.js";

export interface ArbCandidate {
  conditionId: string;
  question: string;
  slug: string;
  outcome: string;
  outcomeIndex: number;
  tokenId: string;
  bestAsk: number;
  askSize: number;
  expectedEdge: number;
  capacityUsdc: number;
  endDate?: string;
  hoursPastEnd: number;
  negRisk: boolean;
  umaResolutionStatus?: string;
}

export interface ScanOpts {
  maxAsk: number;
  minAsk: number;
  minHoursPastEnd: number;
  minCapacityUsdc: number;
}

const DEFAULTS: ScanOpts = {
  maxAsk: 0.99,
  minAsk: 0.85,
  minHoursPastEnd: 0,
  minCapacityUsdc: 5,
};

function pickEndTs(m: MarketWithState): number | undefined {
  const iso = m.state.endDateIso ?? m.state.endDate;
  if (!iso) return undefined;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : undefined;
}

function bestOutcomeFromBook(ob: Orderbook | undefined): { ask: number; size: number } | null {
  if (!ob || !ob.asks.length) return null;
  const best = ob.asks[0]!;
  return { ask: best.price, size: best.size };
}

export function filterCandidates(
  markets: MarketWithState[],
  books: Map<string, Orderbook>,
  opts: Partial<ScanOpts> = {},
): ArbCandidate[] {
  const cfg = { ...DEFAULTS, ...opts };
  const now = Date.now();
  const out: ArbCandidate[] = [];

  for (const m of markets) {
    if (!m.state.active || m.state.archived) continue;
    if (!m.state.acceptingOrders) continue;

    const endTs = pickEndTs(m);
    const hoursPastEnd = endTs ? (now - endTs) / 3_600_000 : 0;
    if (cfg.minHoursPastEnd > 0 && hoursPastEnd < cfg.minHoursPastEnd) continue;

    for (let i = 0; i < m.tokens.length; i++) {
      const tok = m.tokens[i]!;
      const book = books.get(tok.token_id);
      const best = bestOutcomeFromBook(book);
      if (!best) continue;
      if (best.ask < cfg.minAsk || best.ask > cfg.maxAsk) continue;

      const capacity = best.ask * best.size;
      if (capacity < cfg.minCapacityUsdc) continue;

      const edge = 1 - best.ask;
      out.push({
        conditionId: m.conditionId,
        question: m.question,
        slug: m.slug,
        outcome: tok.outcome,
        outcomeIndex: i,
        tokenId: tok.token_id,
        bestAsk: best.ask,
        askSize: best.size,
        expectedEdge: edge,
        capacityUsdc: capacity,
        endDate: m.state.endDateIso ?? m.state.endDate,
        hoursPastEnd,
        negRisk: m.state.negRisk,
        umaResolutionStatus: m.state.umaResolutionStatus,
      });
    }
  }

  return out.sort((a, b) => b.expectedEdge - a.expectedEdge);
}

export async function scanLateResolution(opts: Partial<ScanOpts> = {}): Promise<{
  candidates: ArbCandidate[];
  scanned: number;
  prefiltered: number;
}> {
  const cfg = { ...DEFAULTS, ...opts };
  const markets = await fetchActiveMarkets({ active: true, closed: false });

  const prefilter = markets.filter((m) => {
    if (!m.state.active || m.state.archived || !m.state.acceptingOrders) return false;
    const maxPrice = Math.max(...m.tokens.map((t) => t.price ?? 0));
    return maxPrice >= cfg.minAsk && maxPrice <= cfg.maxAsk + 0.01;
  });

  const tokenIds: string[] = [];
  for (const m of prefilter) {
    for (const t of m.tokens) {
      if (t.price != null && t.price >= cfg.minAsk - 0.05 && t.price <= cfg.maxAsk + 0.01) {
        tokenIds.push(t.token_id);
      }
    }
  }

  const books = await fetchOrderbooksBatch(tokenIds);
  const candidates = filterCandidates(prefilter, books, cfg);

  return { candidates, scanned: markets.length, prefiltered: prefilter.length };
}
