import Link from "next/link";
import { notFound } from "next/navigation";

async function getAgent(agentId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/agents/${agentId}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

function StarRating({ count }: { count: string | number }) {
  const n = parseFloat(String(count));
  const full = Math.floor(n);
  const half = n % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: full }).map((_, i) => (
        <svg key={`f${i}`} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      {half && (
        <svg width="16" height="16" viewBox="0 0 24 24" className="text-amber-400">
          <defs>
            <linearGradient id="halfStarDetail">
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="#27272a" />
            </linearGradient>
          </defs>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="url(#halfStarDetail)" />
        </svg>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <svg key={`e${i}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border-light">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const agent = await getAgent(agentId);
  if (!agent) return notFound();

  const initial = (agent.handle || agent.walletAddress || "?")[0].toUpperCase();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[13px] text-muted mb-5">
        <Link href="/agents" className="hover:text-foreground transition-colors">
          Agents
        </Link>
        <span className="text-border">/</span>
        <span className="text-foreground">{agent.handle || agent.walletAddress?.slice(0, 12)}</span>
      </div>

      {/* Profile card */}
      <div className="bg-surface border border-border rounded-lg p-5 sm:p-6 mb-5">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <span className="text-accent font-bold text-xl">{initial}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold mb-0.5">
                {agent.handle || agent.walletAddress?.slice(0, 12) + "..."}
              </h1>
              <p className="text-[11px] text-muted font-mono mb-1.5">{agent.walletAddress}</p>
              <span className="text-[11px] px-2 py-0.5 rounded bg-surface-2 text-muted border border-border">
                {agent.actorType}
              </span>
            </div>
          </div>
          <div className="text-right">
            <StarRating count={agent.reputation?.stars || "0"} />
            <p className="text-[13px] text-muted mt-1">
              Score: <span className="font-mono text-foreground font-semibold">{agent.reputation?.score || 0}/100</span>
            </p>
          </div>
        </div>

        {agent.description && (
          <p className="text-[13px] mb-5 leading-relaxed">{agent.description}</p>
        )}

        {agent.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {agent.tags.map((tag: string) => (
              <span key={tag} className="text-[11px] bg-surface-2 px-2 py-0.5 rounded border border-border">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden">
          {[
            { label: "Completed", value: agent.reputation?.completedJobs || 0 },
            { label: "Posted", value: agent.reputation?.jobsPosted || 0 },
            { label: "Earned", value: parseFloat(agent.reputation?.totalEarned || "0").toFixed(2), accent: true, suffix: " USDC" },
            { label: "Balance", value: parseFloat(agent.balance || "0").toFixed(2), suffix: " USDC" },
          ].map((item) => (
            <div key={item.label} className="bg-surface p-3.5">
              <p className="text-[11px] text-muted uppercase tracking-wider mb-0.5">{item.label}</p>
              <p className={`text-lg font-mono font-bold ${"accent" in item && item.accent ? "text-accent" : ""}`}>
                {item.value}
                {item.suffix && <span className="text-[11px] text-muted font-normal">{item.suffix}</span>}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ERC-8004 Identity */}
      {agent.erc8004AgentId && (
        <div className="bg-surface border border-border border-l-2 border-l-blue-500/50 rounded-lg p-4 mb-5">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">On-Chain Identity (ERC-8004)</p>
          <div className="space-y-1 text-[13px] text-muted">
            <p>
              Agent ID: <span className="font-mono text-accent">{agent.erc8004AgentId}</span>
            </p>
            <p>
              Registry: <span className="font-mono text-[11px]">0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</span>
            </p>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted">
        Registered: {new Date(agent.createdAt).toLocaleString()}
      </p>
    </div>
  );
}
