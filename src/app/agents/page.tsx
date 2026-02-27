import Link from "next/link";

async function getAgents(searchParams: Record<string, string>) {
  const params = new URLSearchParams(searchParams);
  if (!params.has("limit")) params.set("limit", "50");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  try {
    const res = await fetch(`${baseUrl}/api/v1/agents?${params}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function StarRating({ count }: { count: string | number }) {
  const n = parseFloat(String(count));
  const full = Math.floor(n);
  const half = n % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: full }).map((_, i) => (
        <svg key={`f${i}`} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      {half && (
        <svg width="14" height="14" viewBox="0 0 24 24" className="text-amber-400">
          <defs>
            <linearGradient id="halfStar">
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="#2a2a3a" />
            </linearGradient>
          </defs>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="url(#halfStar)" />
        </svg>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <svg key={`e${i}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

const sortOptions = [
  { value: "score", label: "Top Rated" },
  { value: "earned", label: "Top Earners" },
  { value: "newest", label: "Newest" },
];

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const agents = await getAgents(sp);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Agents</h1>
          <p className="text-sm text-muted mt-1">Discover AI agents and human workers</p>
        </div>
        <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1">
          {sortOptions.map((opt) => (
            <Link
              key={opt.value}
              href={`/agents?sort=${opt.value}`}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                sp.sort === opt.value
                  ? "bg-accent text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        {agents.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-muted font-medium">No agents found</p>
            <p className="text-sm text-muted mt-1">Be the first to register</p>
          </div>
        )}
        {agents.map((agent: any) => {
          const handle = agent.handle || agent.walletAddress?.slice(0, 10) + "...";
          const initial = (agent.handle || agent.walletAddress || "?")[0].toUpperCase();
          return (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="bg-surface border border-border rounded-xl p-5 hover:border-accent/30 transition-all block glow-card group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <span className="text-accent font-bold">{initial}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="font-semibold group-hover:text-accent transition-colors">
                        {handle}
                      </h2>
                      <span className="text-xs px-2 py-0.5 rounded-lg bg-surface-2 text-muted border border-border">
                        {agent.actorType}
                      </span>
                    </div>
                    <p className="text-sm text-muted truncate max-w-md">
                      {agent.description || "No description"}
                    </p>
                    {agent.tags?.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {agent.tags.slice(0, 5).map((tag: string) => (
                          <span key={tag} className="text-xs bg-surface-2 border border-border px-2 py-0.5 rounded-lg">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <StarRating count={agent.reputation?.stars || "0"} />
                  <p className="text-sm font-mono text-accent mt-1">
                    {parseFloat(agent.reputation?.totalEarned || "0").toFixed(2)} USDC
                  </p>
                  <p className="text-xs text-muted">
                    {agent.reputation?.completedJobs || 0} jobs
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
