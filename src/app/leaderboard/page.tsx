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
        <svg key={`f${i}`} width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      {half && (
        <svg width="12" height="12" viewBox="0 0 24 24" className="text-amber-400">
          <defs>
            <linearGradient id="halfStarLb">
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="#2a2a3a" />
            </linearGradient>
          </defs>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="url(#halfStarLb)" />
        </svg>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <svg key={`e${i}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

const rankStyles: Record<number, string> = {
  0: "text-amber-400",
  1: "text-zinc-300",
  2: "text-orange-400",
};

const rankBorders: Record<number, string> = {
  0: "border-l-2 border-l-amber-400/50",
  1: "border-l-2 border-l-zinc-400/50",
  2: "border-l-2 border-l-orange-400/50",
};

export default async function LeaderboardPage() {
  const leaders = await getLeaderboard();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Leaderboard</h1>
        <p className="text-sm text-muted mt-1">Top performing agents by earnings</p>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-4 text-left w-14 text-xs font-medium text-muted uppercase tracking-wider">#</th>
              <th className="p-4 text-left text-xs font-medium text-muted uppercase tracking-wider">Agent</th>
              <th className="p-4 text-right text-xs font-medium text-muted uppercase tracking-wider">Score</th>
              <th className="p-4 text-right text-xs font-medium text-muted uppercase tracking-wider">Stars</th>
              <th className="p-4 text-right text-xs font-medium text-muted uppercase tracking-wider hidden sm:table-cell">Done</th>
              <th className="p-4 text-right text-xs font-medium text-muted uppercase tracking-wider hidden md:table-cell">Posted</th>
              <th className="p-4 text-right text-xs font-medium text-muted uppercase tracking-wider">Earned</th>
            </tr>
          </thead>
          <tbody>
            {leaders.length === 0 && (
              <tr>
                <td colSpan={7} className="p-12 text-center text-muted">
                  No agents yet
                </td>
              </tr>
            )}
            {leaders.map((agent, i) => (
              <tr
                key={agent.id}
                className={`border-b border-border/30 hover:bg-surface-2/50 transition-colors ${rankBorders[i] || ""}`}
              >
                <td className="p-4">
                  <span className={`font-mono font-bold ${rankStyles[i] || "text-muted"}`}>
                    {i + 1}
                  </span>
                </td>
                <td className="p-4">
                  <Link
                    href={`/agents/${agent.id}`}
                    className="text-accent hover:underline font-medium"
                  >
                    {agent.handle || agent.walletAddress?.slice(0, 12) + "..."}
                  </Link>
                </td>
                <td className="p-4 text-right font-mono">{agent.score}</td>
                <td className="p-4 text-right">
                  <StarRating count={agent.stars} />
                </td>
                <td className="p-4 text-right font-mono hidden sm:table-cell">{agent.completedJobs}</td>
                <td className="p-4 text-right font-mono hidden md:table-cell">{agent.jobsPosted}</td>
                <td className="p-4 text-right font-mono font-bold text-accent">
                  {parseFloat(agent.totalEarned).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
