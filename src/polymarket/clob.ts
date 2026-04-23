import { ClobClient, Side as ClobSide, OrderType, Chain } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import type { MarketInfo } from "../types.js";

const CLOB_HOST = "https://clob.polymarket.com";

export interface CopyOrderRequest {
  market: MarketInfo;
  outcomeIndex: number;
  notionalUsdc: number;
  maxPrice: number;
}

export interface PlacedOrder {
  orderId: string;
  filled: number;
  price: number;
  tokenId: string;
}

let cached: ClobClient | null = null;

export async function getClob(privateKey: string, funderAddress: string): Promise<ClobClient> {
  if (cached) return cached;
  const signer = new Wallet(privateKey);
  const bootstrap = new ClobClient(CLOB_HOST, Chain.POLYGON, signer, undefined, 2, funderAddress);
  const creds = await bootstrap.createOrDeriveApiKey();
  cached = new ClobClient(CLOB_HOST, Chain.POLYGON, signer, creds, 2, funderAddress);
  return cached;
}

function roundToTick(price: number, tickSize: number): number {
  const steps = Math.round(price / tickSize);
  return Number((steps * tickSize).toFixed(4));
}

export async function placeCopyBuy(
  client: ClobClient,
  req: CopyOrderRequest,
): Promise<PlacedOrder> {
  const token = req.market.tokens[req.outcomeIndex];
  if (!token) throw new Error(`Outcome ${req.outcomeIndex} not found in market`);
  const tick = req.market.tickSize ?? 0.01;
  const limitPrice = roundToTick(Math.min(req.maxPrice, 0.99), tick);

  const signed = await client.createMarketOrder({
    tokenID: token.token_id,
    amount: req.notionalUsdc,
    price: limitPrice,
    side: ClobSide.BUY,
    orderType: OrderType.FOK,
  });
  const res = (await client.postOrder(signed, OrderType.FOK)) as {
    orderID?: string;
    orderHash?: string;
    makingAmount?: string | number;
  };
  const filled = res.makingAmount != null ? Number(res.makingAmount) : req.notionalUsdc / limitPrice;
  return {
    orderId: String(res.orderID ?? res.orderHash ?? ""),
    filled,
    price: limitPrice,
    tokenId: token.token_id,
  };
}

export interface CopySellRequest {
  tokenId: string;
  size: number;
  minPrice: number;
  tickSize?: number;
}

export async function placeCopySell(
  client: ClobClient,
  req: CopySellRequest,
): Promise<PlacedOrder> {
  const tick = req.tickSize ?? 0.01;
  const limitPrice = roundToTick(Math.max(req.minPrice, tick), tick);

  const signed = await client.createMarketOrder({
    tokenID: req.tokenId,
    amount: req.size,
    price: limitPrice,
    side: ClobSide.SELL,
    orderType: OrderType.FOK,
  });
  const res = (await client.postOrder(signed, OrderType.FOK)) as {
    orderID?: string;
    orderHash?: string;
    makingAmount?: string | number;
  };
  const filled = res.makingAmount != null ? Number(res.makingAmount) : req.size;
  return {
    orderId: String(res.orderID ?? res.orderHash ?? ""),
    filled,
    price: limitPrice,
    tokenId: req.tokenId,
  };
}
