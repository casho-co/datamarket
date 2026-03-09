/**
 * Register the AI Dispute Resolver agent via the API.
 * Run: npx tsx scripts/register-ai-resolver.ts
 */

import { createHash, randomBytes } from "crypto";

const BASE_URL = process.env.BASE_URL || "https://market.datalayer.xyz";

// Platform wallet signs the challenge — we use a deterministic wallet for the resolver
// This is a fresh wallet just for the resolver agent
const { privateKeyToAccount } = await import("viem/accounts");
const { createWalletClient, http } = await import("viem");
const { bsc } = await import("viem/chains");

// Generate a new wallet for the resolver agent
const resolverPrivateKey = process.env.RESOLVER_PRIVATE_KEY;
if (!resolverPrivateKey) {
  console.error("Set RESOLVER_PRIVATE_KEY env var (with 0x prefix)");
  process.exit(1);
}

const account = privateKeyToAccount(resolverPrivateKey as `0x${string}`);
console.log("Resolver wallet address:", account.address);

const walletClient = createWalletClient({
  account,
  chain: bsc,
  transport: http(),
});

// Step 1: Request challenge
console.log("\n1. Requesting challenge...");
const challengeRes = await fetch(`${BASE_URL}/api/v1/auth/challenge`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    wallet_address: account.address,
    action: "register",
  }),
});
const challengeData = await challengeRes.json();
if (!challengeRes.ok) {
  console.error("Challenge failed:", challengeData);
  process.exit(1);
}
console.log("Challenge received, nonce:", challengeData.nonce);

// Step 2: Sign the EIP-712 challenge
console.log("\n2. Signing challenge...");
const signature = await walletClient.signTypedData({
  domain: challengeData.domain,
  types: challengeData.types,
  primaryType: "Challenge",
  message: challengeData.message,
});
console.log("Signature:", signature.slice(0, 20) + "...");

// Step 3: Register the agent
console.log("\n3. Registering AI Resolver agent...");
const registerRes = await fetch(`${BASE_URL}/api/v1/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    wallet_address: account.address,
    signature,
    handle: "datalayer_resolver",
    actor_type: "agent",
    description:
      "Datalayer AI Dispute Resolver — an impartial, AI-powered agent that analyzes dispute evidence and issues fair rulings for the marketplace.",
    capabilities: ["dispute_resolution", "evidence_analysis"],
    tags: ["resolver", "ai", "disputes"],
  }),
});

const registerData = await registerRes.json();
if (!registerRes.ok) {
  if (registerData.error?.includes("already registered")) {
    console.log("Agent already registered, attempting login...");

    // Login instead
    const loginChallengeRes = await fetch(`${BASE_URL}/api/v1/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: account.address,
        action: "login",
      }),
    });
    const loginChallenge = await loginChallengeRes.json();

    const loginSig = await walletClient.signTypedData({
      domain: loginChallenge.domain,
      types: loginChallenge.types,
      primaryType: "Challenge",
      message: loginChallenge.message,
    });

    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: account.address,
        signature: loginSig,
      }),
    });
    const loginData = await loginRes.json();
    console.log("Login result:", JSON.stringify(loginData, null, 2));
  } else {
    console.error("Registration failed:", registerData);
    process.exit(1);
  }
} else {
  console.log("\nAI Resolver agent registered successfully!");
  console.log("Agent ID:", registerData.agent?.id || registerData.id);
  console.log("Handle:", registerData.agent?.handle || "datalayer_resolver");
  console.log(
    "API Key (save this!):",
    registerData.api_key || registerData.apiKey || "check response"
  );
  console.log("\nFull response:", JSON.stringify(registerData, null, 2));
}
