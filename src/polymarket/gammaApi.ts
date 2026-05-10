import { request } from "undici";
import type { MarketInfo } from "../types.js";

const GAMMA_API = "https://gamma-api.polymarket.com";

interface GammaMarketRaw {
  conditionId: string;
  question: string;
  slug: string;
  clobTokenIds?: string;
  outcomes?: string;
  outcomePrices?: string;
  minimumOrderSize?: string | number;
  orderPriceMinTickSize?: string | number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  endDate?: string;
  endDateIso?: string;
  umaResolutionStatus?: string;
  negRisk?: boolean;
}

export interface ResolutionState {
  active: boolean;
  closed: boolean;
  archived: boolean;
  acceptingOrders: boolean;
  endDate?: string;
  endDateIso?: string;
  umaResolutionStatus?: string;
  negRisk: boolean;
}

export interface MarketWithState extends MarketInfo {
  state: ResolutionState;
}

function parseJsonArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

function toMarketInfo(raw: GammaMarketRaw): MarketInfo {
  const tokenIds = parseJsonArray(raw.clobTokenIds);
  const outcomes = parseJsonArray(raw.outcomes);
  const prices = parseJsonArray(raw.outcomePrices).map(Number);
  return {
    conditionId: raw.conditionId,
    question: raw.question,
    slug: raw.slug,
    tokens: tokenIds.map((token_id, i) => ({
      token_id,
      outcome: outcomes[i] ?? `Outcome ${i}`,
      price: prices[i],
    })),
    minOrderSize: raw.minimumOrderSize != null ? Number(raw.minimumOrderSize) : undefined,
    tickSize: raw.orderPriceMinTickSize != null ? Number(raw.orderPriceMinTickSize) : undefined,
  };
}

function toMarketWithState(raw: GammaMarketRaw): MarketWithState {
  return {
    ...toMarketInfo(raw),
    state: {
      active: raw.active ?? false,
      closed: raw.closed ?? false,
      archived: raw.archived ?? false,
      acceptingOrders: raw.acceptingOrders ?? false,
      endDate: raw.endDate,
      endDateIso: raw.endDateIso,
      umaResolutionStatus: raw.umaResolutionStatus,
      negRisk: raw.negRisk ?? false,
    },
  };
}

export async function getMarketByConditionId(conditionId: string): Promise<MarketInfo | null> {
  const url = `${GAMMA_API}/markets?condition_ids=${conditionId}`;
  const res = await request(url);
  if (res.statusCode >= 400) return null;
  const rows = (await res.body.json()) as GammaMarketRaw[];
  if (!rows.length) return null;
  return toMarketInfo(rows[0]!);
}

export interface FetchMarketsOpts {
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  endDateMin?: string;
  endDateMax?: string;
  pageSize?: number;
  maxPages?: number;
}

export async function fetchActiveMarkets(opts: FetchMarketsOpts = {}): Promise<MarketWithState[]> {
  const pageSize = opts.pageSize ?? 500;
  const maxPages = opts.maxPages ?? 20;
  const params = new URLSearchParams();
  if (opts.active != null) params.set("active", String(opts.active));
  if (opts.closed != null) params.set("closed", String(opts.closed));
  if (opts.archived != null) params.set("archived", String(opts.archived));
  if (opts.endDateMin) params.set("end_date_min", opts.endDateMin);
  if (opts.endDateMax) params.set("end_date_max", opts.endDateMax);
  params.set("limit", String(pageSize));

  const all: MarketWithState[] = [];
  for (let page = 0; page < maxPages; page++) {
    params.set("offset", String(page * pageSize));
    const url = `${GAMMA_API}/markets?${params.toString()}`;
    const res = await request(url);
    if (res.statusCode >= 400) break;
    const rows = (await res.body.json()) as GammaMarketRaw[];
    if (!rows.length) break;
    all.push(...rows.map(toMarketWithState));
    if (rows.length < pageSize) break;
  }
  return all;
}
