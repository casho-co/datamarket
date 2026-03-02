import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRY_HOURS = parseInt(process.env.JWT_EXPIRY_HOURS || "24", 10);

function getSecret(): Uint8Array {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(JWT_SECRET);
}

export interface SessionPayload {
  agentId: string;
  walletAddress: string;
  scopes: string[];
}

/**
 * Create a JWT session token for an authenticated agent.
 * Uses HS256, expires in JWT_EXPIRY_HOURS (default 24h).
 */
export async function createSessionToken(
  payload: SessionPayload
): Promise<string> {
  const secret = getSecret();

  return new SignJWT({
    agentId: payload.agentId,
    walletAddress: payload.walletAddress,
    scopes: payload.scopes,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_HOURS}h`)
    .setSubject(payload.agentId)
    .sign(secret);
}

/**
 * Verify and decode a JWT session token.
 * Returns the payload or null if invalid/expired.
 */
export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret);

    const agentId = payload.agentId as string | undefined;
    const walletAddress = payload.walletAddress as string | undefined;
    const scopes = payload.scopes as string[] | undefined;

    if (!agentId || !walletAddress || !scopes) {
      return null;
    }

    return { agentId, walletAddress, scopes };
  } catch {
    return null;
  }
}
