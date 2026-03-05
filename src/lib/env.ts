/**
 * Runtime environment validation.
 * Imported at app startup to fail fast if required vars are missing.
 */

const REQUIRED_VARS = [
  "DATABASE_URL",
  "BSC_RPC_URL",
  "PLATFORM_BSC_PRIVATE_KEY",
  "PLATFORM_BSC_ADDRESS",
  "CRON_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "JWT_SECRET",
  "WEBHOOK_SECRET",
] as const;

const OPTIONAL_VARS = [
  "R2_BUCKET",
  "NEXT_PUBLIC_BASE_URL",
  "USDC_BSC_ADDRESS",
  "ERC8004_IDENTITY_REGISTRY",
  "ERC8004_REPUTATION_REGISTRY",
  "CORS_ALLOWED_ORIGINS",
] as const;

export function validateEnv(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  return { valid: missing.length === 0, missing };
}

export function validateEnvOrDie(): void {
  const { valid, missing } = validateEnv();
  if (!valid) {
    console.error(
      `[env] Missing required environment variables: ${missing.join(", ")}`
    );
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

export function getEnvSummary(): Record<string, "set" | "missing" | "optional"> {
  const summary: Record<string, "set" | "missing" | "optional"> = {};

  for (const key of REQUIRED_VARS) {
    summary[key] = process.env[key] ? "set" : "missing";
  }
  for (const key of OPTIONAL_VARS) {
    summary[key] = process.env[key] ? "set" : "optional";
  }

  return summary;
}
