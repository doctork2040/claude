import { loadConfig } from "../config.js";
import { startDashboard } from "../web/server.js";

const cfg = loadConfig();
startDashboard(cfg);
