import { NextRequest, NextResponse } from "next/server";
import { validatedRoute } from "@/lib/utils/validated-route";
import { registerAgentSchema } from "@/lib/validators";
import {
  registerNonCustodialAgent,
  registerCustodialAgent,
} from "@/lib/services/agent";
import { verifyChallenge } from "@/lib/services/challenge";
import { checkRateLimit } from "@/lib/middleware/rate-limit";
import { logAudit, getClientIp } from "@/lib/services/audit";
import { getNextActions } from "@/lib/utils/next-actions";
import { safeErrorMessage } from "@/lib/utils/safe-error";
import { deliverWebhook } from "@/lib/services/webhook";

export const POST = validatedRoute(
  { body: registerAgentSchema },
  async (req: NextRequest, { body }) => {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(ip, "auth");
    if (rl) return rl;

    try {
      if (body.mode === "non_custodial") {
        // Verify wallet ownership via signed challenge
        const verification = await verifyChallenge(
          body.wallet_address,
          body.nonce,
          body.signature
        );

        if (!verification.valid) {
          return NextResponse.json(
            { error: verification.error || "Wallet verification failed" },
            { status: 401 }
          );
        }

        const result = await registerNonCustodialAgent({
          walletAddress: body.wallet_address,
          handle: body.handle,
          description: body.description,
          tags: body.tags,
          skillTags: body.skill_tags,
          capabilities: body.capabilities,
          actorType: body.actor_type,
          webhookUrl: body.webhook_url,
          mcpEndpoint: body.mcp_endpoint,
        });

        await logAudit({
          agentId: result.agentId,
          action: "register",
          resourceType: "agent",
          resourceId: result.agentId,
          metadata: {
            mode: "non_custodial",
            walletAddress: body.wallet_address,
            handle: body.handle,
          },
          ipAddress: ip,
        });

        deliverWebhook(result.agentId, "agent.registered", {
          agent_id: result.agentId,
          mode: "non_custodial",
          wallet_address: result.walletAddress,
        });

        return NextResponse.json(
          {
            agent_id: result.agentId,
            api_key: result.apiKey,
            api_key_prefix: result.apiKeyPrefix,
            wallet_address: result.walletAddress,
            wallet_mode: result.walletMode,
            erc8004_agent_id: result.erc8004AgentId,
            handle: result.handle,
            next_actions: getNextActions("registered"),
          },
          { status: 201 }
        );
      }

      // Custodial registration (Privy-managed)
      const result = await registerCustodialAgent({
        privyToken: body.privy_token,
        email: body.email,
        handle: body.handle,
        description: body.description,
        tags: body.tags,
        skillTags: body.skill_tags,
        capabilities: body.capabilities,
        actorType: body.actor_type,
        webhookUrl: body.webhook_url,
        mcpEndpoint: body.mcp_endpoint,
      });

      await logAudit({
        agentId: result.agentId,
        action: "register",
        resourceType: "agent",
        resourceId: result.agentId,
        metadata: {
          mode: "custodial",
          handle: body.handle,
        },
        ipAddress: ip,
      });

      deliverWebhook(result.agentId, "agent.registered", {
        agent_id: result.agentId,
        mode: "custodial",
        wallet_address: result.walletAddress,
      });

      return NextResponse.json(
        {
          agent_id: result.agentId,
          api_key: result.apiKey,
          api_key_prefix: result.apiKeyPrefix,
          wallet_address: result.walletAddress,
          wallet_mode: result.walletMode,
          privy_user_id: result.privyUserId,
          handle: result.handle,
          next_actions: getNextActions("registered"),
        },
        { status: 201 }
      );
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "23505") {
        return NextResponse.json(
          { error: "Wallet address or handle already registered" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: safeErrorMessage(err) },
        { status: 500 }
      );
    }
  }
);
