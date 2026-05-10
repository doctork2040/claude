import { loadConfig } from "../config.js";
import { scanLateResolution, type ArbCandidate } from "../research/lateResolution.js";
import { getClob, placeCopyBuy } from "../polymarket/clob.js";
import { postDiscord } from "../notify/discord.js";
import { getMarketByConditionId } from "../polymarket/gammaApi.js";

interface Args {
  maxAsk: number;
  minAsk: number;
  minHours: number;
  minCapacity: number;
  notional: number;
  topN: number;
  execute: boolean;
  loopSec: number;
  notify: boolean;
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
    maxAsk: Number(args["max-ask"] ?? "0.99"),
    minAsk: Number(args["min-ask"] ?? "0.92"),
    minHours: Number(args["min-hours-past-end"] ?? "0"),
    minCapacity: Number(args["min-capacity"] ?? "5"),
    notional: Number(args["notional"] ?? "10"),
    topN: Number(args["top"] ?? "20"),
    execute: args["execute"] === "true",
    loopSec: Number(args["loop"] ?? "0"),
    notify: args["notify"] === "true",
  };
}

function fmtCandidate(c: ArbCandidate, i: number): string {
  const edge = (c.expectedEdge * 100).toFixed(2);
  const ask = c.bestAsk.toFixed(3);
  const cap = c.capacityUsdc.toFixed(0);
  const aged = c.hoursPastEnd > 0 ? ` (${c.hoursPastEnd.toFixed(1)}h past end)` : "";
  const title = (c.question || c.slug || c.conditionId).slice(0, 60);
  return `${String(i + 1).padStart(2)}. ${edge.padStart(5)}% edge · ask ${ask} · cap $${cap.padStart(5)}${aged}\n    ${c.outcome}: ${title}\n    https://polymarket.com/event/${c.slug}`;
}

async function tryExecute(
  cands: ArbCandidate[],
  args: Args,
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  console.log(`\nExecuting up to ${cands.length} candidates (dryRun=${cfg.dryRun})...`);
  for (const c of cands) {
    const notional = Math.min(args.notional, c.capacityUsdc);
    if (notional < 1) {
      console.log(`  skip ${c.outcome}: capacity $${c.capacityUsdc.toFixed(2)} too small`);
      continue;
    }
    try {
      const market = await getMarketByConditionId(c.conditionId);
      if (!market) {
        console.warn(`  market lookup failed: ${c.conditionId}`);
        continue;
      }
      if (cfg.dryRun) {
        console.log(`  DRY RUN: would buy ${notional} USDC of "${c.outcome}" @ ${c.bestAsk}`);
        continue;
      }
      const clob = await getClob(cfg.privateKey, cfg.funderAddress);
      const result = await placeCopyBuy(clob, {
        market,
        outcomeIndex: c.outcomeIndex,
        notionalUsdc: notional,
        maxPrice: Math.min(c.bestAsk, args.maxAsk),
      });
      console.log(`  FILLED ${result.filled.toFixed(2)} @ ${result.price.toFixed(3)}: ${c.outcome} (${result.orderId})`);
    } catch (err) {
      console.error(`  failed ${c.outcome}:`, err);
    }
  }
}

async function tick(args: Args, cfg: ReturnType<typeof loadConfig>): Promise<void> {
  const start = Date.now();
  console.log(
    `[${new Date().toISOString()}] Scanning · askRange=[${args.minAsk}, ${args.maxAsk}] minCap=$${args.minCapacity} minHours=${args.minHours}`,
  );
  const result = await scanLateResolution({
    maxAsk: args.maxAsk,
    minAsk: args.minAsk,
    minHoursPastEnd: args.minHours,
    minCapacityUsdc: args.minCapacity,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `  scanned ${result.scanned} markets, ${result.prefiltered} pre-filtered, ${result.candidates.length} candidates (${elapsed}s)`,
  );
  if (!result.candidates.length) {
    console.log(`  no candidates`);
    return;
  }
  const top = result.candidates.slice(0, args.topN);
  console.log("");
  for (const [i, c] of top.entries()) console.log(fmtCandidate(c, i));

  if (args.notify && cfg.discordWebhookUrl) {
    const summary = top
      .slice(0, 10)
      .map((c, i) => `**${i + 1}.** ${(c.expectedEdge * 100).toFixed(2)}% edge · ask ${c.bestAsk.toFixed(3)} · cap $${c.capacityUsdc.toFixed(0)} — ${c.outcome}: ${(c.question ?? c.slug).slice(0, 80)}`)
      .join("\n");
    try {
      await postDiscord(cfg.discordWebhookUrl, {
        title: `Late-resolution arb: ${result.candidates.length} candidates`,
        description: summary,
        color: 0x22c55e,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("  discord notify failed:", err);
    }
  }

  if (args.execute) {
    await tryExecute(top, args, cfg);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const cfg = loadConfig();
  await tick(args, cfg);
  if (args.loopSec > 0) {
    console.log(`\nLooping every ${args.loopSec}s. Ctrl+C to stop.`);
    setInterval(() => {
      tick(args, cfg).catch((err) => console.error("scan error:", err));
    }, args.loopSec * 1000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
