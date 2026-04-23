import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchLeaderboard } from "../polymarket/dataApi.js";
import { computeWinRate, type WinRateStats } from "../research/winrate.js";
import type { TrackedWallet } from "../config.js";

interface Args {
  window: "day" | "week" | "month" | "all";
  pool: number;
  top: number;
  minMarkets: number;
  minPnl: number;
  concurrency: number;
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
    window: (args["window"] as Args["window"]) ?? "all",
    pool: Number(args["pool"] ?? "150"),
    top: Number(args["top"] ?? "20"),
    minMarkets: Number(args["min-markets"] ?? "30"),
    minPnl: Number(args["min-pnl"] ?? "10000"),
    concurrency: Number(args["concurrency"] ?? "4"),
    out: args["out"] ?? "config/wallets.json",
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const { window, pool, top, minMarkets, minPnl, concurrency, out } = parseArgs(process.argv);
  console.log(
    `Leaderboard pool: window=${window} size=${pool} (min PnL=$${minPnl} filter applied after fetch)`,
  );
  const lb = await fetchLeaderboard({ window, metric: "pnl", limit: pool });
  const candidates = lb.filter((r) => r.proxyWallet && r.pnl >= minPnl);
  console.log(`Analyzing ${candidates.length} candidates (min PnL=$${minPnl}, concurrency=${concurrency})...`);

  const stats = await mapWithConcurrency(candidates, concurrency, async (row, i) => {
    process.stdout.write(`  [${i + 1}/${candidates.length}] ${row.proxyWallet.slice(0, 10)}...\r`);
    try {
      return await computeWinRate(row.proxyWallet, row.pnl, row.name);
    } catch (err) {
      return {
        address: row.proxyWallet,
        label: row.name,
        pnl: row.pnl,
        settledMarkets: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgPnlPerMarket: 0,
        totalCashPnl: 0,
      } as WinRateStats;
    }
  });
  process.stdout.write("\n");

  const ranked = stats
    .filter((s) => s.settledMarkets >= minMarkets)
    .sort((a, b) => b.winRate - a.winRate || b.pnl - a.pnl)
    .slice(0, top);

  console.log(
    `\nTop ${ranked.length} by win rate (min ${minMarkets} settled markets):\n`,
  );
  console.log(
    `  # ${"label".padEnd(22)} ${"winrate".padStart(8)} ${"W/L".padStart(10)} ${"pnl".padStart(10)} ${"avg/mkt".padStart(9)}  address`,
  );
  for (const [i, s] of ranked.entries()) {
    const label = (s.label ?? s.address.slice(0, 8)).slice(0, 22);
    console.log(
      `${String(i + 1).padStart(3)} ${label.padEnd(22)} ${(s.winRate * 100).toFixed(1).padStart(7)}% ${`${s.wins}/${s.losses}`.padStart(10)} $${s.pnl.toFixed(0).padStart(8)} $${s.avgPnlPerMarket.toFixed(0).padStart(7)}  ${s.address}`,
    );
  }

  const wallets: TrackedWallet[] = ranked.map((s) => ({
    address: s.address,
    label: `${s.label ?? s.address.slice(0, 8)} (${(s.winRate * 100).toFixed(0)}% ${s.wins}W/${s.losses}L)`,
    weight: 1,
  }));

  const outPath = resolve(process.cwd(), out);
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, JSON.stringify(wallets, null, 2));
  console.log(`\nWrote ${wallets.length} wallets to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
