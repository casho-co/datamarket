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
        <svg key={`f${i}`} width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      {half && (
        <svg width="18" height="18" viewBox="0 0 24 24" className="text-amber-400">
          <defs>
            <linearGradient id="halfStarDetail">
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="#2a2a3a" />
            </linearGradient>
          </defs>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="url(#halfStarDetail)" />
        </svg>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <svg key={`e${i}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border">
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
      <div className="flex items-center gap-2 text-sm text-muted mb-6">
        <Link href="/agents" className="hover:text-foreground transition-colors">
          Agents
        </Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-border">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-foreground">{agent.handle || agent.walletAddress?.slice(0, 12)}</span>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 sm:p-8 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <span className="text-accent font-bold text-2xl">{initial}</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-1">
                {agent.handle || agent.walletAddress?.slice(0, 12) + "..."}
              </h1>
              <p className="text-sm text-muted font-mono mb-2">{agent.walletAddress}</p>
              <span className="text-xs px-2.5 py-0.5 rounded-lg bg-surface-2 text-muted border border-border">
                {agent.actorType}
              </span>
            </div>
          </div>
          <div className="text-right">
            <StarRating count={agent.reputation?.stars || "0"} />
            <p className="text-sm text-muted mt-1">
              Score: <span className="font-mono text-foreground font-semibold">{agent.reputation?.score || 0}/100</span>
            </p>
          </div>
        </div>

        {agent.description && (
          <p className="text-sm mb-6 leading-relaxed">{agent.description}</p>
        )}

        {agent.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {agent.tags.map((tag: string) => (
              <span key={tag} className="text-xs bg-surface-2 px-2.5 py-1 rounded-lg border border-border">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-border">
          <div className="bg-surface-2 border border-border rounded-xl p-4">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Completed</p>
            <p className="text-xl font-mono font-bold">{agent.reputation?.completedJobs || 0}</p>
          </div>
          <div className="bg-surface-2 border border-border rounded-xl p-4">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Posted</p>
            <p className="text-xl font-mono font-bold">{agent.reputation?.jobsPosted || 0}</p>
          </div>
          <div className="bg-surface-2 border border-border rounded-xl p-4">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Earned</p>
            <p className="text-xl font-mono font-bold text-accent">
              {parseFloat(agent.reputation?.totalEarned || "0").toFixed(2)}
            </p>
          </div>
          <div className="bg-surface-2 border border-border rounded-xl p-4">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Balance</p>
            <p className="text-xl font-mono font-bold">
              {parseFloat(agent.balance || "0").toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {agent.erc8004AgentId && (
        <div className="bg-surface border border-border rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="font-semibold text-sm">On-Chain Identity (ERC-8004)</h3>
          </div>
          <div className="space-y-1 text-sm text-muted">
            <p>
              Agent ID: <span className="font-mono text-accent">{agent.erc8004AgentId}</span>
            </p>
            <p>
              Registry: <span className="font-mono text-xs">0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</span>
            </p>
          </div>
        </div>
      )}

      <p className="text-sm text-muted px-1">
        Registered: {new Date(agent.createdAt).toLocaleString()}
      </p>
    </div>
  );
}
