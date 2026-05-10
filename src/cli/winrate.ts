import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fetchLeaderboard } from "../polymarket/dataApi.js";
import { computeWinRate, type WinRateStats } from "../research/winrate.js";
import type { TrackedWallet } from "../config.js";

interface SeedEntry {
  address: string;
  label?: string;
  notes?: string;
}

interface Args {
  window: "day" | "week" | "month" | "all";
  pool: number;
  top: number;
  minMarkets: number;
  minPnl: number;
  maxStaleDays: number;
  concurrency: number;
  includeSeeds: boolean;
  seedsFile: string;
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
    window: (args["window"] as Args["window"]) ?? "month",
    pool: Number(args["pool"] ?? "150"),
    top: Number(args["top"] ?? "20"),
    minMarkets: Number(args["min-markets"] ?? "30"),
    minPnl: Number(args["min-pnl"] ?? "10000"),
    maxStaleDays: Number(args["max-stale-days"] ?? "7"),
    concurrency: Number(args["concurrency"] ?? "4"),
    includeSeeds: args["include-seeds"] === "true" || args["include-seeds"] === "",
    seedsFile: args["seeds"] ?? "seeds/known_whales.json",
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

interface Candidate {
  proxyWallet: string;
  pnl: number;
  name?: string;
  source: "leaderboard" | "seed";
}

function loadSeeds(file: string): SeedEntry[] {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as SeedEntry[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const lb = await fetchLeaderboard({ window: args.window, metric: "pnl", limit: args.pool });
  const lbCandidates: Candidate[] = lb
    .filter((r) => r.proxyWallet && r.pnl >= args.minPnl)
    .map((r) => ({ proxyWallet: r.proxyWallet, pnl: r.pnl, name: r.name, source: "leaderboard" }));

  let seedCandidates: Candidate[] = [];
  if (args.includeSeeds) {
    const seeds = loadSeeds(args.seedsFile);
    const seenAddrs = new Set(lbCandidates.map((c) => c.proxyWallet.toLowerCase()));
    seedCandidates = seeds
      .filter((s) => !seenAddrs.has(s.address.toLowerCase()))
      .map((s) => ({ proxyWallet: s.address.toLowerCase(), pnl: 0, name: s.label, source: "seed" as const }));
    console.log(`Seeds: loaded ${seeds.length} from ${args.seedsFile}, ${seedCandidates.length} new (rest already in leaderboard)`);
  }

  const candidates = [...lbCandidates, ...seedCandidates];
  console.log(
    `Analyzing ${candidates.length} candidates (leaderboard=${lbCandidates.length} seed=${seedCandidates.length}, window=${args.window}, minPnl=$${args.minPnl})`,
  );

  const stats = await mapWithConcurrency(candidates, args.concurrency, async (c, i) => {
    process.stdout.write(`  [${i + 1}/${candidates.length}] ${c.proxyWallet.slice(0, 10)}...\r`);
    try {
      return await computeWinRate(c.proxyWallet, c.pnl, c.name);
    } catch {
      return {
        address: c.proxyWallet,
        label: c.name,
        pnl: c.pnl,
        settledMarkets: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgPnlPerMarket: 0,
        totalCashPnl: 0,
        lastTradeTs: 0,
        daysSinceTrade: Infinity,
      } as WinRateStats;
    }
  });
  process.stdout.write("\n");

  const passed = stats.filter(
    (s) => s.settledMarkets >= args.minMarkets && s.daysSinceTrade <= args.maxStaleDays,
  );
  const droppedStale = stats.filter(
    (s) => s.settledMarkets >= args.minMarkets && s.daysSinceTrade > args.maxStaleDays,
  );
  const droppedSample = stats.filter((s) => s.settledMarkets < args.minMarkets);

  const ranked = passed
    .sort((a, b) => b.winRate - a.winRate || b.pnl - a.pnl)
    .slice(0, args.top);

  console.log(
    `\nFiltered: ${ranked.length} kept · ${droppedStale.length} stale (>${args.maxStaleDays}d) · ${droppedSample.length} small sample (<${args.minMarkets} markets)`,
  );
  console.log(
    `\nTop ${ranked.length} by win rate (active in last ${args.maxStaleDays} days):\n`,
  );
  console.log(
    `  # ${"label".padEnd(22)} ${"winrate".padStart(8)} ${"W/L".padStart(10)} ${"pnl".padStart(10)} ${"avg/mkt".padStart(9)} ${"lastTrade".padStart(11)}  address`,
  );
  for (const [i, s] of ranked.entries()) {
    const label = (s.label ?? s.address.slice(0, 8)).slice(0, 22);
    const lastTrade = isFinite(s.daysSinceTrade) ? `${s.daysSinceTrade.toFixed(1)}d ago` : "never";
    console.log(
      `${String(i + 1).padStart(3)} ${label.padEnd(22)} ${(s.winRate * 100).toFixed(1).padStart(7)}% ${`${s.wins}/${s.losses}`.padStart(10)} $${s.pnl.toFixed(0).padStart(8)} $${s.avgPnlPerMarket.toFixed(0).padStart(7)} ${lastTrade.padStart(11)}  ${s.address}`,
    );
  }

  if (droppedStale.length) {
    console.log(`\nDropped ${droppedStale.length} for staleness (no trade in ${args.maxStaleDays}+ days):`);
    for (const s of droppedStale.slice(0, 5)) {
      console.log(`  - ${s.label ?? s.address.slice(0, 10)} winRate=${(s.winRate * 100).toFixed(0)}% lastTrade=${s.daysSinceTrade.toFixed(0)}d ago`);
    }
  }

  const wallets: TrackedWallet[] = ranked.map((s) => ({
    address: s.address,
    label: s.label ?? s.address.slice(0, 8),
    weight: 1,
    winRate: Number(s.winRate.toFixed(4)),
    settledMarkets: s.settledMarkets,
    pnl: Math.round(s.pnl),
    lastTradeTs: s.lastTradeTs,
  }));

  const outPath = resolve(process.cwd(), args.out);
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, JSON.stringify(wallets, null, 2));
  console.log(`\nWrote ${wallets.length} wallets to ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
