import { request } from "undici";
import type { PolyTrade } from "../types.js";

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: string;
}

export async function postDiscord(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  const res = await request(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`Discord webhook ${res.statusCode}: ${body.slice(0, 200)}`);
  }
}

export function tradeEmbed(
  trade: PolyTrade,
  walletLabel: string,
  copied?: { filled: number; price: number; dryRun: boolean },
): DiscordEmbed {
  const color = trade.side === "BUY" ? 0x22c55e : 0xef4444;
  const notional = trade.size * trade.price;
  const fields: DiscordEmbed["fields"] = [
    { name: "Wallet", value: walletLabel, inline: true },
    { name: "Side", value: trade.side, inline: true },
    { name: "Outcome", value: trade.outcome, inline: true },
    { name: "Price", value: trade.price.toFixed(3), inline: true },
    { name: "Size", value: trade.size.toFixed(2), inline: true },
    { name: "Notional", value: `$${notional.toFixed(2)}`, inline: true },
  ];
  if (copied) {
    fields.push({
      name: copied.dryRun ? "Copy (DRY RUN)" : "Copied",
      value: `filled ${copied.filled.toFixed(2)} @ ${copied.price.toFixed(3)}`,
      inline: false,
    });
  }
  return {
    title: trade.title ?? trade.slug ?? trade.conditionId,
    url: trade.slug ? `https://polymarket.com/event/${trade.slug}` : undefined,
    color,
    fields,
    timestamp: new Date(trade.timestamp * 1000).toISOString(),
  };
}
