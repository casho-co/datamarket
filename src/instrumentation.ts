export async function register() {
  // Only validate env at runtime (not during build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvOrDie } = await import("@/lib/env");
    validateEnvOrDie();

    // Seed platform resolver agent if it doesn't exist
    await seedPlatformResolver();
  }
}

async function seedPlatformResolver() {
  const handle = process.env.DISPUTE_AGENT_HANDLE || "dispute_agent";
  const wallet = process.env.PLATFORM_BSC_ADDRESS;

  if (!wallet) {
    console.warn("[seed] PLATFORM_BSC_ADDRESS not set, skipping resolver seed");
    return;
  }

  try {
    const { db } = await import("@/lib/db");
    const { agents } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const [existing] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.handle, handle));

    if (existing) return;

    await db.insert(agents).values({
      handle,
      walletAddress: wallet,
      actorType: "agent",
      description: "Platform dispute resolver — AI-powered automatic dispute resolution",
      availabilityStatus: "online",
    });

    console.log(`[seed] Created platform resolver agent: ${handle}`);
  } catch (err) {
    // Unique constraint on wallet — resolver may exist with different handle
    console.error("[seed] Failed to create platform resolver:", err instanceof Error ? err.message : err);
  }
}
