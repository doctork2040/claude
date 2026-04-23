import express from "express";
import { resolve } from "node:path";
import { filterByWinRate, type AppConfig } from "../config.js";
import { loadState } from "../store/state.js";

export function startDashboard(cfg: AppConfig): void {
  const app = express();

  app.get("/api/state", (_req, res) => {
    const state = loadState();
    const active = filterByWinRate(cfg.trackedWallets, cfg.minWinRate, cfg.minSettledMarkets);
    const activeSet = new Set(active.map((w) => w.address));
    const wallets = cfg.trackedWallets.map((w) => ({
      ...w,
      tracked: activeSet.has(w.address),
    }));
    const openCopies = Object.values(state.openCopies);
    const events = state.events.slice(-100).reverse();
    res.json({
      config: {
        dryRun: cfg.dryRun,
        copyNotionalUsdc: cfg.copyNotionalUsdc,
        maxOpenPositions: cfg.maxOpenPositions,
        minWinRate: cfg.minWinRate,
        minSettledMarkets: cfg.minSettledMarkets,
        pollIntervalMs: cfg.pollIntervalMs,
      },
      wallets,
      openCopies,
      events,
    });
  });

  app.use(express.static(resolve(process.cwd(), "src/web/public")));

  app.listen(cfg.dashboardPort, () => {
    console.log(`Dashboard: http://localhost:${cfg.dashboardPort}`);
  });
}
