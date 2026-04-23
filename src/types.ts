export type Side = "BUY" | "SELL";

export interface PolyTrade {
  transactionHash: string;
  timestamp: number;
  proxyWallet: string;
  conditionId: string;
  asset: string;
  side: Side;
  outcome: string;
  outcomeIndex: number;
  price: number;
  size: number;
  title?: string;
  slug?: string;
}

export interface PolyPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  outcome: string;
  outcomeIndex: number;
  size: number;
  avgPrice: number;
  curPrice: number;
  realizedPnl: number;
  cashPnl: number;
  title?: string;
  slug?: string;
}

export interface LeaderboardEntry {
  proxyWallet: string;
  name?: string;
  pnl: number;
  volume?: number;
}

export interface MarketToken {
  token_id: string;
  outcome: string;
  price?: number;
}

export interface MarketInfo {
  conditionId: string;
  question: string;
  slug: string;
  tokens: MarketToken[];
  minOrderSize?: number;
  tickSize?: number;
}
