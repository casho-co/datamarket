/**
 * Register the AI Dispute Resolver agent via the API.
 * Run from bnbpro/datalyer-market: node scripts/register-ai-resolver.mjs
 */
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { bsc } from "viem/chains";

const BASE_URL = process.env.BASE_URL || "https://market.datalayer.xyz";
const resolverPrivateKey = process.env.RESOLVER_PRIVATE_KEY;
if (!resolverPrivateKey) {
  console.error("Set RESOLVER_PRIVATE_KEY env var (with 0x prefix)");
  process.exit(1);
}

const account = privateKeyToAccount(resolverPrivateKey);
console.log("Resolver wallet address:", account.address);

const walletClient = createWalletClient({
  account,
  chain: bsc,
  transport: http(),
});

// Step 1: Request challenge
console.log("\n1. Requesting challenge...");
const challengeRes = await fetch(`${BASE_URL}/api/v1/agents/challenge`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ wallet_address: account.address, action: "register" }),
});
const challengeData = await challengeRes.json();
if (!challengeRes.ok) {
  console.error("Challenge failed:", challengeData);
  process.exit(1);
}
console.log("Challenge nonce:", challengeData.nonce);

// Step 2: Sign the EIP-712 challenge
console.log("\n2. Signing challenge...");
const td = challengeData.typed_data || challengeData;
const signature = await walletClient.signTypedData({
  domain: td.domain,
  types: td.types,
  primaryType: td.primaryType || "Challenge",
  message: td.message,
});

// Step 3: Register the agent
console.log("\n3. Registering AI Resolver agent...");
const registerRes = await fetch(`${BASE_URL}/api/v1/agents/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    wallet_address: account.address,
    signature,
    nonce: challengeData.nonce,
    handle: "datalayer_resolver",
    actor_type: "agent",
    description:
      "Datalayer AI Dispute Resolver — impartial, AI-powered agent that analyzes dispute evidence and issues fair rulings.",
    capabilities: { dispute_resolution: true, evidence_analysis: true },
    tags: ["resolver", "ai", "disputes"],
  }),
});

const registerData = await registerRes.json();
if (!registerRes.ok) {
  if (
    registerData.error?.includes("already registered") ||
    registerData.error?.includes("already")
  ) {
    console.log("Agent already registered. Logging in...");
    const lc = await fetch(`${BASE_URL}/api/v1/agents/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet_address: account.address, action: "login" }),
    });
    const lcd = await lc.json();
    const ltd = lcd.typed_data || lcd;
    const ls = await walletClient.signTypedData({
      domain: ltd.domain,
      types: ltd.types,
      primaryType: ltd.primaryType || "Challenge",
      message: ltd.message,
    });
    const lr = await fetch(`${BASE_URL}/api/v1/agents/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet_address: account.address, signature: ls }),
    });
    const ld = await lr.json();
    console.log("Login result:", JSON.stringify(ld, null, 2));
  } else {
    console.error("Registration failed:", registerData);
    process.exit(1);
  }
} else {
  console.log("\nAI Resolver agent registered!");
  console.log("Full response:", JSON.stringify(registerData, null, 2));
}
