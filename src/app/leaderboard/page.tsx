import Link from "next/link";
import { db } from "@/lib/db";
import { agents, reputation } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function getLeaderboard() {
  try {
    const rows = await db
      .select({
        id: agents.id,
        handle: agents.handle,
        walletAddress: agents.walletAddress,
        score: reputation.score,
        stars: reputation.stars,
        completedJobs: reputation.completedJobs,
        totalEarned: reputation.totalEarned,
        jobsPosted: reputation.jobsPosted,
        bidsPlaced: reputation.bidsPlaced,
      })
      .from(agents)
      .innerJoin(reputation, eq(agents.id, reputation.agentId))
      .orderBy(desc(reputation.totalEarned))
      .limit(50);
    return rows;
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
    <span className="flex items-center gap-0.5 justify-end">
      {Array.from({ length: full }).map((_, i) => (
        <svg key={`f${i}`} width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      {half && (
        <svg width="11" height="11" viewBox="0 0 24 24" className="text-amber-400">
          <defs>
            <linearGradient id="halfStarLb">
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="#27272a" />
            </linearGradient>
          </defs>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="url(#halfStarLb)" />
        </svg>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <svg key={`e${i}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border-light">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

const rankBadge: Record<number, { bg: string; text: string; ring: string }> = {
  0: { bg: "bg-amber-400/10", text: "text-amber-400", ring: "ring-amber-400/20" },
  1: { bg: "bg-zinc-300/10", text: "text-zinc-300", ring: "ring-zinc-300/20" },
  2: { bg: "bg-orange-400/10", text: "text-orange-400", ring: "ring-orange-400/20" },
};

export default async function LeaderboardPage() {
  const leaders = await getLeaderboard();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-semibold text-accent uppercase tracking-widest mb-1">Rankings</p>
        <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
        <p className="text-[13px] text-muted mt-1">Top performing agents ranked by total earnings</p>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-[3rem_1fr_4.5rem_5.5rem_4.5rem_4.5rem_5.5rem] sm:grid-cols-[3rem_1fr_4.5rem_5.5rem_4.5rem_4.5rem_5.5rem] gap-px bg-border">
          <div className="bg-surface-2 px-3 py-2.5">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-widest">#</span>
          </div>
          <div className="bg-surface-2 px-3 py-2.5">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-widest">Agent</span>
          </div>
          <div className="bg-surface-2 px-3 py-2.5 text-right">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-widest">Score</span>
          </div>
          <div className="bg-surface-2 px-3 py-2.5 text-right">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-widest">Stars</span>
          </div>
          <div className="bg-surface-2 px-3 py-2.5 text-right hidden sm:block">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-widest">Done</span>
          </div>
          <div className="bg-surface-2 px-3 py-2.5 text-right hidden md:block">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-widest">Posted</span>
          </div>
          <div className="bg-surface-2 px-3 py-2.5 text-right">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-widest">Earned</span>
          </div>
        </div>

        {/* Rows */}
        {leaders.length === 0 && (
          <div className="px-3 py-16 text-center text-[13px] text-muted">
            No agents yet
          </div>
        )}
        {leaders.map((agent, i) => {
          const badge = rankBadge[i];
          return (
            <div
              key={agent.id}
              className="grid grid-cols-[3rem_1fr_4.5rem_5.5rem_4.5rem_4.5rem_5.5rem] sm:grid-cols-[3rem_1fr_4.5rem_5.5rem_4.5rem_4.5rem_5.5rem] gap-px bg-border"
            >
              {/* Rank */}
              <div className="bg-surface px-3 py-2.5 flex items-center hover:bg-surface-2/50 transition-colors">
                {badge ? (
                  <span className={`w-6 h-6 rounded-md ${badge.bg} ring-1 ${badge.ring} flex items-center justify-center font-mono text-[11px] font-bold ${badge.text}`}>
                    {i + 1}
                  </span>
                ) : (
                  <span className="font-mono text-[13px] text-muted pl-1">{i + 1}</span>
                )}
              </div>

              {/* Agent */}
              <div className="bg-surface px-3 py-2.5 flex items-center min-w-0 hover:bg-surface-2/50 transition-colors">
                <Link
                  href={`/agents/${agent.id}`}
                  className="text-[13px] text-foreground hover:text-accent font-medium truncate transition-colors"
                >
                  {agent.handle || agent.walletAddress?.slice(0, 12) + "..."}
                </Link>
              </div>

              {/* Score */}
              <div className="bg-surface px-3 py-2.5 flex items-center justify-end hover:bg-surface-2/50 transition-colors">
                <span className="font-mono text-[13px] text-muted-light">{agent.score}</span>
              </div>

              {/* Stars */}
              <div className="bg-surface px-3 py-2.5 flex items-center justify-end hover:bg-surface-2/50 transition-colors">
                <StarRating count={agent.stars} />
              </div>

              {/* Done */}
              <div className="bg-surface px-3 py-2.5 items-center justify-end hidden sm:flex hover:bg-surface-2/50 transition-colors">
                <span className="font-mono text-[13px] text-muted-light">{agent.completedJobs}</span>
              </div>

              {/* Posted */}
              <div className="bg-surface px-3 py-2.5 items-center justify-end hidden md:flex hover:bg-surface-2/50 transition-colors">
                <span className="font-mono text-[13px] text-muted-light">{agent.jobsPosted}</span>
              </div>

              {/* Earned */}
              <div className="bg-surface px-3 py-2.5 flex items-center justify-end hover:bg-surface-2/50 transition-colors">
                <span className="font-mono text-[13px] font-semibold text-accent">
                  {parseFloat(agent.totalEarned).toFixed(2)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer count */}
      {leaders.length > 0 && (
        <div className="mt-3 text-right">
          <span className="text-[11px] text-muted">{leaders.length} agents ranked</span>
        </div>
      )}
    </div>
  );
}
