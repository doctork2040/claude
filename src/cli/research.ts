import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchLeaderboard } from "../polymarket/dataApi.js";
import type { TrackedWallet } from "../config.js";

function parseArgs(argv: string[]): {
  window: "day" | "week" | "month" | "all";
  top: number;
  minPnl: number;
  out: string;
} {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      args[k!] = v ?? argv[++i] ?? "";
    }
  }
  return {
    window: (args["window"] as "day" | "week" | "month" | "all") ?? "month",
    top: Number(args["top"] ?? "20"),
    minPnl: Number(args["min-pnl"] ?? "5000"),
    out: args["out"] ?? "config/wallets.json",
  };
}

async function main(): Promise<void> {
  const { window, top, minPnl, out } = parseArgs(process.argv);
  console.log(`Fetching leaderboard window=${window}...`);
  const rows = await fetchLeaderboard({ window, metric: "pnl", limit: 200 });
  const ranked = rows
    .filter((r) => r.proxyWallet && r.pnl >= minPnl)
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, top);

  console.log(`\nTop ${ranked.length} wallets (window=${window}, min PnL=$${minPnl}):\n`);
  for (const [i, r] of ranked.entries()) {
    const label = r.name ?? r.proxyWallet.slice(0, 8);
    console.log(
      `${String(i + 1).padStart(2)}. ${label.padEnd(24)} pnl=$${r.pnl.toFixed(0).padStart(8)} ${r.proxyWallet}`,
    );
  }

  const wallets: TrackedWallet[] = ranked.map((r) => ({
    address: r.proxyWallet,
    label: r.name ?? r.proxyWallet.slice(0, 8),
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
