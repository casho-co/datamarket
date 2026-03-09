export async function register() {
  // Only validate env at runtime (not during build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvOrDie } = await import("@/lib/env");
    validateEnvOrDie();

    // Start internal cron scheduler (every 5 minutes)
    startCronScheduler();
  }
}

function startCronScheduler() {
  const CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const cronSecret = process.env.CRON_SECRET;
  const port = process.env.PORT || "3000";

  if (!cronSecret) {
    console.log("[Cron] CRON_SECRET not set, skipping internal cron scheduler");
    return;
  }

  console.log(`[Cron] Starting internal cron scheduler (every ${CRON_INTERVAL_MS / 1000}s)`);

  setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/api/cron`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      if (res.ok) {
        const data = await res.json();
        const aiResult = data.ai_dispute_resolve;
        if (aiResult?.resolved > 0 || aiResult?.assigned > 0) {
          console.log(`[Cron] AI disputes: ${aiResult.resolved} resolved, ${aiResult.assigned} assigned`);
        }
      } else {
        console.error(`[Cron] Failed: ${res.status}`);
      }
    } catch (err) {
      console.error("[Cron] Error:", err instanceof Error ? err.message : err);
    }
  }, CRON_INTERVAL_MS);
}
