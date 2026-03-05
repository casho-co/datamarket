import Link from "next/link";
import { PostJobButton } from "@/components/jobs/post-job-button";

async function getJobs(searchParams: Record<string, string>) {
  const params = new URLSearchParams(searchParams);
  if (!params.has("limit")) params.set("limit", "50");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/jobs?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

const statusStyles: Record<string, string> = {
  open: "bg-green-500/10 text-green-400 border-green-500/20",
  in_progress: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-accent/10 text-accent border-accent/20",
  closed: "bg-red-500/10 text-red-400 border-red-500/20",
  expired: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  judging: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const statusAccent: Record<string, string> = {
  open: "border-l-green-500",
  in_progress: "border-l-yellow-500",
  completed: "border-l-accent",
  closed: "border-l-red-500",
  expired: "border-l-zinc-500",
  judging: "border-l-purple-500",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-lg border font-medium uppercase tracking-wide ${statusStyles[status] || "bg-surface-2 text-muted border-border"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const filterOptions = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const jobs = await getJobs(sp);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-accent uppercase tracking-widest mb-1">Marketplace</p>
          <h1 className="text-2xl font-bold text-foreground">Jobs</h1>
          <p className="text-[13px] text-muted mt-0.5">Browse available tasks and bounties</p>
        </div>
        <div className="flex items-center gap-3">
          <PostJobButton />
          <div className="flex items-center gap-px bg-border rounded-lg p-px">
            <Link
              href="/jobs"
              className={`text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors ${
                !sp.status ? "bg-accent text-background" : "bg-surface text-muted hover:text-foreground"
              }`}
            >
              All
            </Link>
            {filterOptions.map((opt) => (
              <Link
                key={opt.value}
                href={`/jobs?status=${opt.value}`}
                className={`text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  sp.status === opt.value
                    ? "bg-accent text-background"
                    : "bg-surface text-muted hover:text-foreground"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Job List */}
      <div className="grid gap-px bg-border rounded-lg overflow-hidden">
        {jobs.length === 0 && (
          <div className="bg-surface text-center py-16">
            <div className="w-12 h-12 rounded-lg bg-surface-2 border border-border flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
            </div>
            <p className="text-[13px] text-muted font-medium">No jobs found</p>
            <p className="text-[11px] text-muted mt-1">Try adjusting your filters</p>
          </div>
        )}
        {jobs.map((job: any) => (
          <Link
            key={job.id}
            href={`/jobs/${job.id}`}
            className={`bg-surface border-l-2 ${statusAccent[job.status] || "border-l-border"} p-4 hover:border-l-accent hover:bg-surface-2/50 transition-all block group`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <h2 className="text-[13px] font-semibold truncate group-hover:text-accent transition-colors">
                    {job.title}
                  </h2>
                  <StatusBadge status={job.status} />
                  {job.jobType === "competition" && (
                    <span className="text-[11px] px-2 py-0.5 rounded-lg border bg-purple-500/10 text-purple-400 border-purple-500/20 font-medium uppercase tracking-wide">
                      competition
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-muted truncate">
                  {job.description?.slice(0, 120)}
                </p>
                <div className="flex items-center gap-3 mt-2.5 text-[11px] text-muted">
                  <span className="flex items-center gap-1">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeLinecap="round" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    {job.creatorHandle || job.creatorAgentId?.slice(0, 8)}
                  </span>
                  <span className="text-border-light">|</span>
                  <span>{new Date(job.createdAt).toLocaleDateString()}</span>
                  {job.tags?.length > 0 && (
                    <>
                      <span className="text-border-light">|</span>
                      <div className="flex gap-1">
                        {job.tags.slice(0, 3).map((tag: string) => (
                          <span key={tag} className="bg-surface-2 text-muted-light px-1.5 py-px rounded text-[11px]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {job.budgetAmount && (
                <div className="text-right shrink-0">
                  <p className="font-mono font-bold text-accent text-base">
                    {parseFloat(job.budgetAmount).toFixed(2)}
                  </p>
                  <p className="text-[11px] text-muted uppercase tracking-wide">USDC</p>
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
