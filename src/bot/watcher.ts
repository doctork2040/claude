import { fetchTrades } from "../polymarket/dataApi.js";
import { getMarketByConditionId } from "../polymarket/gammaApi.js";
import { getClob, placeCopyBuy } from "../polymarket/clob.js";
import { postDiscord, tradeEmbed } from "../notify/discord.js";
import { loadState, saveState } from "../store/state.js";
import type { AppConfig, TrackedWallet } from "../config.js";
import type { PolyTrade } from "../types.js";

function labelFor(w: TrackedWallet): string {
  return w.label ?? w.address.slice(0, 8);
}

async function processWallet(cfg: AppConfig, wallet: TrackedWallet): Promise<void> {
  const state = loadState();
  const since = state.lastTradeTs[wallet.address] ?? Math.floor(Date.now() / 1000) - 60;
  const trades = await fetchTrades(wallet.address, 25);
  const fresh = trades
    .filter((t) => t.timestamp > since && t.side === "BUY")
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!trades.length) return;
  state.lastTradeTs[wallet.address] = Math.max(since, ...trades.map((t) => t.timestamp));

  for (const trade of fresh) {
    await handleNewTrade(cfg, wallet, trade, state);
  }
  saveState(state);
}

async function handleNewTrade(
  cfg: AppConfig,
  wallet: TrackedWallet,
  trade: PolyTrade,
  state: ReturnType<typeof loadState>,
): Promise<void> {
  const label = labelFor(wallet);
  console.log(
    `[${new Date(trade.timestamp * 1000).toISOString()}] ${label} ${trade.side} ${trade.outcome} @ ${trade.price} size=${trade.size}`,
  );

  const openCount = Object.keys(state.openCopies).length;
  const alreadyCopied = Boolean(state.openCopies[trade.conditionId]);
  const shouldCopy = !alreadyCopied && openCount < cfg.maxOpenPositions && trade.price < 0.95;

  let copied: { filled: number; price: number; dryRun: boolean } | undefined;
  if (shouldCopy) {
    const market = await getMarketByConditionId(trade.conditionId);
    if (!market) {
      console.warn(`  market lookup failed for ${trade.conditionId}`);
    } else if (cfg.dryRun) {
      copied = { filled: cfg.copyNotionalUsdc / trade.price, price: trade.price, dryRun: true };
      console.log(`  DRY RUN: would copy ${cfg.copyNotionalUsdc} USDC`);
    } else {
      try {
        const clob = await getClob(cfg.privateKey, cfg.funderAddress);
        const result = await placeCopyBuy(clob, {
          market,
          outcomeIndex: trade.outcomeIndex,
          notionalUsdc: cfg.copyNotionalUsdc * (wallet.weight ?? 1),
          maxPrice: Math.min(trade.price * 1.03, 0.99),
        });
        copied = { filled: result.filled, price: result.price, dryRun: false };
        state.openCopies[trade.conditionId] = {
          tokenId: result.tokenId,
          size: result.filled,
          price: result.price,
        };
        console.log(`  COPIED: ${result.filled} @ ${result.price} (${result.orderId})`);
      } catch (err) {
        console.error(`  copy failed:`, err);
      }
    }
  }

  try {
    await postDiscord(cfg.discordWebhookUrl, tradeEmbed(trade, label, copied));
  } catch (err) {
    console.error(`  discord notify failed:`, err);
  }
}

export async function runWatcher(cfg: AppConfig): Promise<void> {
  if (!cfg.trackedWallets.length) {
    throw new Error("No tracked wallets. Run `npm run research` first.");
  }
  console.log(
    `Watching ${cfg.trackedWallets.length} wallets every ${cfg.pollIntervalMs}ms (dryRun=${cfg.dryRun})`,
  );

  const tick = async () => {
    for (const wallet of cfg.trackedWallets) {
      try {
        await processWallet(cfg, wallet);
      } catch (err) {
        console.error(`[${labelFor(wallet)}] poll error:`, err);
      }
    }
  };

  await tick();
  setInterval(tick, cfg.pollIntervalMs);
}
