import { fetchTrades } from "../polymarket/dataApi.js";
import { getMarketByConditionId } from "../polymarket/gammaApi.js";
import { getClob, placeCopyBuy, placeCopySell } from "../polymarket/clob.js";
import { postDiscord, tradeEmbed } from "../notify/discord.js";
import { appendEvent, loadState, saveState, type OpenCopy } from "../store/state.js";
import { filterByWinRate, type AppConfig, type TrackedWallet } from "../config.js";
import type { PolyTrade } from "../types.js";

function labelFor(w: TrackedWallet): string {
  return w.label ?? w.address.slice(0, 8);
}

async function processWallet(cfg: AppConfig, wallet: TrackedWallet): Promise<void> {
  const state = loadState();
  const since = state.lastTradeTs[wallet.address] ?? Math.floor(Date.now() / 1000) - 60;
  const trades = await fetchTrades(wallet.address, 25);
  if (!trades.length) return;

  const fresh = trades.filter((t) => t.timestamp > since).sort((a, b) => a.timestamp - b.timestamp);
  state.lastTradeTs[wallet.address] = Math.max(since, ...trades.map((t) => t.timestamp));

  for (const trade of fresh) {
    if (trade.side === "BUY") {
      await handleBuy(cfg, wallet, trade, state);
    } else {
      await handleSell(cfg, wallet, trade, state);
    }
  }
  saveState(state);
}

async function handleBuy(
  cfg: AppConfig,
  wallet: TrackedWallet,
  trade: PolyTrade,
  state: ReturnType<typeof loadState>,
): Promise<void> {
  const label = labelFor(wallet);
  console.log(
    `[${new Date(trade.timestamp * 1000).toISOString()}] ${label} BUY ${trade.outcome} @ ${trade.price} size=${trade.size}`,
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
      const size = cfg.copyNotionalUsdc / trade.price;
      copied = { filled: size, price: trade.price, dryRun: true };
      state.openCopies[trade.conditionId] = buildCopy(trade, wallet, size, trade.price, market.tokens[trade.outcomeIndex]?.token_id ?? trade.asset);
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
        state.openCopies[trade.conditionId] = buildCopy(trade, wallet, result.filled, result.price, result.tokenId);
        console.log(`  COPIED: ${result.filled} @ ${result.price} (${result.orderId})`);
      } catch (err) {
        console.error(`  copy buy failed:`, err);
        appendEvent(state, {
          ts: Date.now(),
          kind: "error",
          wallet: wallet.address,
          walletLabel: label,
          error: String(err),
        });
      }
    }
  }

  appendEvent(state, {
    ts: Date.now(),
    kind: copied ? "buy" : "signal",
    wallet: wallet.address,
    walletLabel: label,
    title: trade.title,
    slug: trade.slug,
    side: "BUY",
    outcome: trade.outcome,
    price: trade.price,
    size: trade.size,
    notional: trade.price * trade.size,
    copied: Boolean(copied),
    dryRun: copied?.dryRun,
  });

  try {
    await postDiscord(cfg.discordWebhookUrl, tradeEmbed(trade, label, copied));
  } catch (err) {
    console.error(`  discord notify failed:`, err);
  }
}

async function handleSell(
  cfg: AppConfig,
  wallet: TrackedWallet,
  trade: PolyTrade,
  state: ReturnType<typeof loadState>,
): Promise<void> {
  const label = labelFor(wallet);
  const openCopy = state.openCopies[trade.conditionId];
  if (!openCopy || openCopy.sourceWallet !== wallet.address) {
    return;
  }
  console.log(
    `[${new Date(trade.timestamp * 1000).toISOString()}] ${label} SELL ${trade.outcome} @ ${trade.price} - closing copy`,
  );

  let closed: { filled: number; price: number; dryRun: boolean } | undefined;
  if (cfg.dryRun) {
    closed = { filled: openCopy.size, price: trade.price, dryRun: true };
    console.log(`  DRY RUN: would close ${openCopy.size} @ ~${trade.price}`);
  } else {
    try {
      const clob = await getClob(cfg.privateKey, cfg.funderAddress);
      const result = await placeCopySell(clob, {
        tokenId: openCopy.tokenId,
        size: openCopy.size,
        minPrice: Math.max(trade.price * 0.97, 0.01),
      });
      closed = { filled: result.filled, price: result.price, dryRun: false };
      console.log(`  CLOSED: ${result.filled} @ ${result.price} (${result.orderId})`);
    } catch (err) {
      console.error(`  copy sell failed:`, err);
      appendEvent(state, {
        ts: Date.now(),
        kind: "error",
        wallet: wallet.address,
        walletLabel: label,
        error: String(err),
      });
      return;
    }
  }

  delete state.openCopies[trade.conditionId];

  appendEvent(state, {
    ts: Date.now(),
    kind: "sell",
    wallet: wallet.address,
    walletLabel: label,
    title: openCopy.title,
    slug: openCopy.slug,
    side: "SELL",
    outcome: trade.outcome,
    price: closed?.price,
    size: closed?.filled,
    copied: true,
    dryRun: closed?.dryRun,
  });

  try {
    await postDiscord(cfg.discordWebhookUrl, tradeEmbed(trade, label, closed));
  } catch (err) {
    console.error(`  discord notify failed:`, err);
  }
}

function buildCopy(
  trade: PolyTrade,
  wallet: TrackedWallet,
  size: number,
  price: number,
  tokenId: string,
): OpenCopy {
  return {
    conditionId: trade.conditionId,
    tokenId,
    outcomeIndex: trade.outcomeIndex,
    size,
    avgPrice: price,
    sourceWallet: wallet.address,
    sourceLabel: wallet.label,
    title: trade.title,
    slug: trade.slug,
    openedAt: Date.now(),
  };
}

export async function runWatcher(cfg: AppConfig): Promise<void> {
  const all = cfg.trackedWallets;
  const wallets = filterByWinRate(all, cfg.minWinRate, cfg.minSettledMarkets);
  const dropped = all.length - wallets.length;

  if (!wallets.length) {
    throw new Error(
      `No wallets pass filter (minWinRate=${cfg.minWinRate}, minSettledMarkets=${cfg.minSettledMarkets}). Run \`npm run winrate\` first.`,
    );
  }
  console.log(
    `Watching ${wallets.length} wallets (${dropped} dropped by filter) every ${cfg.pollIntervalMs}ms - dryRun=${cfg.dryRun}, minWinRate=${cfg.minWinRate}`,
  );
  for (const w of wallets) {
    console.log(`  - ${labelFor(w)}  winRate=${((w.winRate ?? 0) * 100).toFixed(1)}%  markets=${w.settledMarkets ?? "?"}`);
  }

  const tick = async () => {
    for (const wallet of wallets) {
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
