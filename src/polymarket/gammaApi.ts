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

export async function getMarketByConditionId(conditionId: string): Promise<MarketInfo | null> {
  const url = `${GAMMA_API}/markets?condition_ids=${conditionId}`;
  const res = await request(url);
  if (res.statusCode >= 400) return null;
  const rows = (await res.body.json()) as GammaMarketRaw[];
  if (!rows.length) return null;
  return toMarketInfo(rows[0]!);
}
