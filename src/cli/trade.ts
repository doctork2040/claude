import { loadConfig } from "../config.js";
import { getMarketByConditionId } from "../polymarket/gammaApi.js";
import { getClob, placeCopyBuy } from "../polymarket/clob.js";

function parseArgs(argv: string[]): {
  conditionId: string;
  outcome: number;
  notional: number;
  maxPrice: number;
} {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      args[k!] = v ?? argv[++i] ?? "";
    }
  }
  const conditionId = args["condition-id"];
  if (!conditionId) throw new Error("--condition-id required");
  return {
    conditionId,
    outcome: Number(args["outcome"] ?? "0"),
    notional: Number(args["notional"] ?? "5"),
    maxPrice: Number(args["max-price"] ?? "0.99"),
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { conditionId, outcome, notional, maxPrice } = parseArgs(process.argv);
  const market = await getMarketByConditionId(conditionId);
  if (!market) throw new Error(`Market not found: ${conditionId}`);
  console.log(`Market: ${market.question}`);
  console.log(`Outcome ${outcome}: ${market.tokens[outcome]?.outcome}`);

  if (cfg.dryRun) {
    console.log(`DRY RUN: would buy ${notional} USDC at max price ${maxPrice}`);
    return;
  }
  const clob = await getClob(cfg.privateKey, cfg.funderAddress);
  const res = await placeCopyBuy(clob, { market, outcomeIndex: outcome, notionalUsdc: notional, maxPrice });
  console.log(`Filled ${res.filled} @ ${res.price} (order ${res.orderId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
