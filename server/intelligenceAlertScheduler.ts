import { deliverIntelligenceEmail } from "./intelligenceEmail";
import { dbAll, dbGet } from "./db";
import { browseStoredConferences } from "./braveSearch";
import { evaluateAlerts, parseState } from "../src/intelligence/engine";

let scanning = false;
// A bounded operational rehearsal may scan one consenting account. The timer still scans all accounts.
export async function scanProfessionalIntelligenceAlerts(userId?: string): Promise<{ scanned: number; changed: number }> {
  if (scanning) return { scanned: 0, changed: 0 };
  scanning = true;
  let scanned = 0, changed = 0;
  try {
    const results = await browseStoredConferences(10000);
    const accounts = await dbAll<{user_id: string; state_json: string}>(
      "SELECT user_id, state_json FROM professional_intelligence_state" + (userId ? " WHERE user_id=?" : ""),
      userId ? [userId] : []
    );
    const recentThreshold = Date.now() - 2 * 60 * 60 * 1000;
    for (const account of accounts) {
      try {
        const before = parseState(account.state_json);
        const emailCandidates = (alerts: typeof before.alerts) => {
          const seen = new Set<string>();
          return alerts.filter(alert => {
            const created = Date.parse(alert.createdAt);
            if (!Number.isFinite(created) || created < recentThreshold) return false;
            const key = alert.result.link.trim().toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).slice(0, 3);
        };
        if (!before.rules.some(rule => rule.enabled)) continue;
        scanned++;
        const after = evaluateAlerts(before, results);
        const next = JSON.stringify(after);
        if (next === JSON.stringify(before)) {
          for (const alert of emailCandidates(after.alerts)) await deliverIntelligenceEmail(account.user_id, alert);
          continue;
        }
        // Optimistic update prevents overwriting a user's concurrent browser changes.
        const saved = await dbGet(
          "UPDATE professional_intelligence_state SET state_json=?, updated_at=? WHERE user_id=? AND state_json=? RETURNING user_id",
          [next, new Date().toISOString(), account.user_id, account.state_json]
        );
        if (!saved) continue;
        changed++;
        for (const alert of emailCandidates(after.alerts)) await deliverIntelligenceEmail(account.user_id, alert);

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
