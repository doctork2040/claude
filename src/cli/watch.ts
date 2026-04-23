import { loadConfig } from "../config.js";
import { runWatcher } from "../bot/watcher.js";

const cfg = loadConfig();
runWatcher(cfg).catch((err) => {
  console.error(err);
  process.exit(1);
});
