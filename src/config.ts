import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface TrackedWallet {
  address: string;
  label?: string;
  weight?: number;
  winRate?: number;
  settledMarkets?: number;
  pnl?: number;
  lastTradeTs?: number;
}

export interface AppConfig {
  privateKey: string;
  funderAddress: string;
  discordWebhookUrl: string;
  dryRun: boolean;
  copyNotionalUsdc: number;
  maxOpenPositions: number;
  pollIntervalMs: number;
  minWinRate: number;
  minSettledMarkets: number;
  dashboardPort: number;
  trackedWallets: TrackedWallet[];
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function loadTrackedWallets(): TrackedWallet[] {
  const path = resolve(process.cwd(), "config/wallets.json");
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as TrackedWallet[];
  return raw.map((w) => ({ ...w, address: w.address.toLowerCase() }));
}

export function filterByWinRate(
  wallets: TrackedWallet[],
  minWinRate: number,
  minSettledMarkets: number,
): TrackedWallet[] {
  return wallets.filter(
    (w) =>
      (w.winRate ?? 0) >= minWinRate &&
      (w.settledMarkets ?? 0) >= minSettledMarkets,
  );
}

export function loadConfig(): AppConfig {
  return {
    privateKey: requireEnv("POLYMARKET_PRIVATE_KEY"),
    funderAddress: requireEnv("POLYMARKET_FUNDER_ADDRESS").toLowerCase(),
    discordWebhookUrl: requireEnv("DISCORD_WEBHOOK_URL"),
    dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
    copyNotionalUsdc: Number(process.env.COPY_NOTIONAL_USDC ?? "10"),
    maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS ?? "20"),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "30000"),
    minWinRate: Number(process.env.MIN_WIN_RATE ?? "0.6"),
    minSettledMarkets: Number(process.env.MIN_SETTLED_MARKETS ?? "30"),
    dashboardPort: Number(process.env.DASHBOARD_PORT ?? "3000"),
    trackedWallets: loadTrackedWallets(),
  };
}
