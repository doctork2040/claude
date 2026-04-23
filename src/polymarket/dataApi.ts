import { request } from "undici";
import type { LeaderboardEntry, PolyPosition, PolyTrade } from "../types.js";

const DATA_API = "https://data-api.polymarket.com";
const LB_API = "https://lb-api.polymarket.com";

async function getJson<T>(url: string): Promise<T> {
  const res = await request(url, { method: "GET" });
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`GET ${url} -> ${res.statusCode}: ${body.slice(0, 200)}`);
  }
  return (await res.body.json()) as T;
}

export async function fetchLeaderboard(opts: {
  window?: "day" | "week" | "month" | "all";
  metric?: "pnl" | "volume";
  limit?: number;
}): Promise<LeaderboardEntry[]> {
  const window = opts.window ?? "week";
  const metric = opts.metric ?? "pnl";
  const limit = opts.limit ?? 100;
  const url = `${LB_API}/leaderboard?window=${window}&type=${metric}&limit=${limit}`;
  const rows = await getJson<Array<Record<string, unknown>>>(url);
  return rows.map((r) => ({
    proxyWallet: String(r["proxyWallet"] ?? r["wallet"] ?? "").toLowerCase(),
    name: (r["name"] as string) ?? undefined,
    pnl: Number(r["amount"] ?? r["pnl"] ?? 0),
    volume: r["volume"] != null ? Number(r["volume"]) : undefined,
  }));
}

export async function fetchPositions(
  user: string,
  opts: { sizeThreshold?: number; limit?: number } = {},
): Promise<PolyPosition[]> {
  const sizeThreshold = opts.sizeThreshold ?? 0.1;
  const limit = opts.limit ?? 500;
  const url = `${DATA_API}/positions?user=${user.toLowerCase()}&sizeThreshold=${sizeThreshold}&limit=${limit}`;
  const rows = await getJson<Array<Record<string, unknown>>>(url);
  return rows.map((r) => ({
    proxyWallet: String(r["proxyWallet"] ?? user).toLowerCase(),
    asset: String(r["asset"] ?? ""),
    conditionId: String(r["conditionId"] ?? ""),
    outcome: String(r["outcome"] ?? ""),
    outcomeIndex: Number(r["outcomeIndex"] ?? 0),
    size: Number(r["size"] ?? 0),
    avgPrice: Number(r["avgPrice"] ?? 0),
    curPrice: Number(r["curPrice"] ?? 0),
    realizedPnl: Number(r["realizedPnl"] ?? 0),
    cashPnl: Number(r["cashPnl"] ?? 0),
    title: r["title"] as string | undefined,
    slug: r["slug"] as string | undefined,
  }));
}

export async function fetchTrades(user: string, limit = 50): Promise<PolyTrade[]> {
  const url = `${DATA_API}/trades?user=${user.toLowerCase()}&limit=${limit}`;
  const rows = await getJson<Array<Record<string, unknown>>>(url);
  return rows.map((r) => ({
    transactionHash: String(r["transactionHash"] ?? r["hash"] ?? ""),
    timestamp: Number(r["timestamp"] ?? 0),
    proxyWallet: String(r["proxyWallet"] ?? user).toLowerCase(),
    conditionId: String(r["conditionId"] ?? ""),
    asset: String(r["asset"] ?? ""),
    side: String(r["side"] ?? "BUY").toUpperCase() as PolyTrade["side"],
    outcome: String(r["outcome"] ?? ""),
    outcomeIndex: Number(r["outcomeIndex"] ?? 0),
    price: Number(r["price"] ?? 0),
    size: Number(r["size"] ?? 0),
    title: r["title"] as string | undefined,
    slug: r["slug"] as string | undefined,
  }));
}
