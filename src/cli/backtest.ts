import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { collectTrades, simulate, type BacktestConfig } from "../research/backtest.js";
import { filterByWinRate, type TrackedWallet } from "../config.js";

interface Args {
  walletsFile: string;
  notional: number;
  maxOpen: number;
  maxPrice: number;
  slippageBps: number;
  minWinRate: number;
  minMarkets: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      args[k!] = v ?? argv[++i] ?? "";
    }
  }
  return {
    walletsFile: args["wallets"] ?? "config/wallets.json",
    notional: Number(args["notional"] ?? "10"),
    maxOpen: Number(args["max-open"] ?? "20"),
    maxPrice: Number(args["max-price"] ?? "0.95"),
    slippageBps: Number(args["slippage-bps"] ?? "100"),
    minWinRate: Number(args["min-win-rate"] ?? process.env.MIN_WIN_RATE ?? "0.6"),
    minMarkets: Number(args["min-markets"] ?? process.env.MIN_SETTLED_MARKETS ?? "30"),
    out: args["out"] ?? "data/backtest.json",
  };
}

function loadWallets(file: string): TrackedWallet[] {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) throw new Error(`Wallets file not found: ${file}`);
  return (JSON.parse(readFileSync(path, "utf8")) as TrackedWallet[]).map((w) => ({
    ...w,
    address: w.address.toLowerCase(),
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const all = loadWallets(args.walletsFile);
  const wallets = filterByWinRate(all, args.minWinRate, args.minMarkets);
  if (!wallets.length) {
    throw new Error(
      `No wallets pass filter (minWinRate=${args.minWinRate}, minMarkets=${args.minMarkets}). Run \`npm run winrate\`.`,
    );
  }
  console.log(`Backtesting ${wallets.length}/${all.length} wallets (after win-rate filter)`);
  console.log(`  notional=$${args.notional}  maxOpen=${args.maxOpen}  maxPrice=${args.maxPrice}  slippage=${args.slippageBps}bps`);

  console.log(`Fetching historical trades...`);
  const trades = await collectTrades(wallets);
  console.log(`  ${trades.length} total trades across ${wallets.length} wallets`);

  const cfg: BacktestConfig = {
    notionalUsdc: args.notional,
    maxOpenPositions: args.maxOpen,
    maxBuyPrice: args.maxPrice,
    slippageBps: args.slippageBps,
  };
  const result = simulate(trades, cfg);

  const capitalDeployed = result.copiesOpened * args.notional;
  const roi = capitalDeployed > 0 ? (result.realizedPnl / capitalDeployed) * 100 : 0;
  const span =
    trades.length && trades[0] && trades[trades.length - 1]
      ? (trades[trades.length - 1]!.timestamp - trades[0]!.timestamp) / 86400
      : 0;

  console.log(`\n=== Summary ===`);
  console.log(`  Copies opened:    ${result.copiesOpened}  (skipped ${result.copiesSkipped})`);
  console.log(`  Copies closed:    ${result.copiesClosed}  (still open: ${result.unresolvedOpen})`);
  console.log(`  Win rate:         ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`  Realized PnL:     $${result.realizedPnl.toFixed(2)}`);
  console.log(`  ROI on capital:   ${roi.toFixed(1)}% (deployed $${capitalDeployed.toFixed(0)})`);
  console.log(`  Max drawdown:     $${result.maxDrawdown.toFixed(2)}`);
  console.log(`  Avg holding:      ${result.avgHoldingHours.toFixed(1)} hours`);
  console.log(`  Time span:        ${span.toFixed(1)} days`);

  const perWallet = Object.entries(result.perSourceWallet)
    .map(([addr, stats]) => {
      const label = wallets.find((w) => w.address === addr)?.label ?? addr.slice(0, 8);
      return { addr, label, ...stats };
    })
    .filter((s) => s.wins + s.losses > 0)
    .sort((a, b) => b.pnl - a.pnl);

  if (perWallet.length) {
    console.log(`\n=== Per-wallet PnL ===`);
    console.log(
      `  ${"label".padEnd(22)} ${"pnl".padStart(10)} ${"W/L".padStart(10)} ${"winrate".padStart(8)}`,
    );
    for (const w of perWallet) {
      const wr = w.wins + w.losses > 0 ? ((w.wins / (w.wins + w.losses)) * 100).toFixed(0) + "%" : "-";
      console.log(
        `  ${w.label.padEnd(22)} $${w.pnl.toFixed(0).padStart(8)} ${`${w.wins}/${w.losses}`.padStart(10)} ${wr.padStart(7)}`,
      );
    }
  }

  const outPath = resolve(process.cwd(), args.out);
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nFull result written to ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
