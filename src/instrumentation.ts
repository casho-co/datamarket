export async function register() {
  // Only validate env at runtime (not during build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvOrDie } = await import("@/lib/env");
    validateEnvOrDie();
  }
}
