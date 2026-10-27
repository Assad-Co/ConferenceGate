import { deliverIntelligenceEmail } from "./intelligenceEmail";
import { dbAll, dbRun } from "./db";
import { browseStoredConferences } from "./braveSearch";
import { evaluateAlerts, parseState } from "../src/intelligence/engine";

let scanning = false;
export async function scanProfessionalIntelligenceAlerts(): Promise<{ scanned: number; changed: number }> {
  if (scanning) return { scanned: 0, changed: 0 };
  scanning = true;
  let scanned = 0, changed = 0;
  try {
    const results = await browseStoredConferences(10000);
    const accounts = await dbAll<{user_id: string; state_json: string}>(
      "SELECT user_id, state_json FROM professional_intelligence_state"
    );
    for (const account of accounts) {
      try {
        const before = parseState(account.state_json);
        if (!before.rules.some(rule => rule.enabled)) continue;
        scanned++;
        const after = evaluateAlerts(before, results);
        const next = JSON.stringify(after);
        if (next === JSON.stringify(before)) {
          for (const alert of after.alerts.slice(0, 20)) await deliverIntelligenceEmail(account.user_id, alert);
          continue;
        }
        // Optimistic update prevents overwriting a user's concurrent browser changes.
        await dbRun(
          "UPDATE professional_intelligence_state SET state_json=?, updated_at=? WHERE user_id=? AND state_json=?",
          [next, new Date().toISOString(), account.user_id, account.state_json]
        );
        changed++;
        for (const alert of after.alerts.slice(0, 20)) await deliverIntelligenceEmail(account.user_id, alert);

      } catch (error) {
        console.warn("[intelligence-alerts] account scan failed", error instanceof Error ? error.message : "unknown error");
      }
    }
    return { scanned, changed };
  } finally {
    scanning = false;
  }
}
export function startProfessionalIntelligenceAlertScheduler() {
  if (process.env.NODE_ENV === "test" || process.env.INTELLIGENCE_BACKGROUND_ALERTS !== "enabled") return;
  const tick = () => void scanProfessionalIntelligenceAlerts().catch(error =>
    console.error("[intelligence-alerts] background scan failed", error));
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.();
  setTimeout(tick, 30 * 1000).unref?.();
}
