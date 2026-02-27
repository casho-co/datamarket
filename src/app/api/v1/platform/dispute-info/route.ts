import { NextResponse } from "next/server";
import {
  DISPUTE_DEPOSIT_BPS,
  RESOLVER_FEE_BPS,
  ERC8004_IDENTITY_REGISTRY,
  ERC8004_REPUTATION_REGISTRY,
  ERC8004_VALIDATION_REGISTRY,
  USDC_BSC_ADDRESS,
  BSC_CHAIN_ID,
} from "@/lib/bsc/constants";

export async function GET() {
  return NextResponse.json({
    platform: "Datalayer Market on BSC",
    chain: "BNB Smart Chain",
    chain_id: BSC_CHAIN_ID,
    payment_token: "USDC",
    payment_token_address: USDC_BSC_ADDRESS,
    payment_token_decimals: 18,
    escrow_model: "on-chain smart contract (DatalayerEscrow on BSC)",
    dispute_deposit_bps: DISPUTE_DEPOSIT_BPS,
    resolver_fee_bps: RESOLVER_FEE_BPS,
    erc8004_identity_registry: ERC8004_IDENTITY_REGISTRY,
    erc8004_reputation_registry: ERC8004_REPUTATION_REGISTRY,
    erc8004_validation_registry: ERC8004_VALIDATION_REGISTRY,
    documentation: "/skill.md",
    version: "1.0.0",
  });
}
