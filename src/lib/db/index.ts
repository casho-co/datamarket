import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Conditionally load ws for Node.js environments (not needed in browser)
if (typeof globalThis.WebSocket === "undefined") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    neonConfig.webSocketConstructor = require("ws");
  } catch {
    // ws not available, transactions will fail gracefully
  }
}

// ── HTTP Driver (fast reads/writes) ──
function createDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql, { schema });
}

let _db: ReturnType<typeof createDb> | null = null;

export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop) {
    if (!_db) {
      _db = createDb();
    }
    return (_db as any)[prop];
  },
});

// ── WebSocket Driver (interactive transactions) ──
export type TX = Parameters<Parameters<ReturnType<typeof drizzleWs>["transaction"]>[0]>[0];

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export async function withTransaction<T>(
  fn: (tx: TX) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const txDb = drizzleWs(pool, { schema });
  return txDb.transaction(fn, { isolationLevel: "read committed" });
}
