import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface TrackedWallet {
  address: string;
  label?: string;
  weight?: number;
}

export interface AppConfig {
  privateKey: string;
  funderAddress: string;
  discordWebhookUrl: string;
  dryRun: boolean;
  copyNotionalUsdc: number;
  maxOpenPositions: number;
  pollIntervalMs: number;
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

export function loadConfig(): AppConfig {
  return {
    privateKey: requireEnv("POLYMARKET_PRIVATE_KEY"),
    funderAddress: requireEnv("POLYMARKET_FUNDER_ADDRESS").toLowerCase(),
    discordWebhookUrl: requireEnv("DISCORD_WEBHOOK_URL"),
    dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
    copyNotionalUsdc: Number(process.env.COPY_NOTIONAL_USDC ?? "10"),
    maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS ?? "20"),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "30000"),
    trackedWallets: loadTrackedWallets(),
  };
}
