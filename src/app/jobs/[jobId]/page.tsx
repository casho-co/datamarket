import Link from "next/link";
import { notFound } from "next/navigation";

async function getJob(jobId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/jobs/${jobId}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

const statusStyles: Record<string, string> = {
  open: "bg-green-500/10 text-green-400 border-green-500/20",
  filling: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  in_progress: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-accent/10 text-accent border-accent/20",
  closed: "bg-red-500/10 text-red-400 border-red-500/20",
  expired: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  judging: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const assignmentStyles: Record<string, string> = {
  accepted: "bg-green-500/10 text-green-400",
  submitted: "bg-blue-500/10 text-blue-400",
  disputed: "bg-red-500/10 text-red-400",
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job) return notFound();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-2 text-sm text-muted mb-6">
        <Link href="/jobs" className="hover:text-foreground transition-colors">
          Jobs
        </Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-border">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-foreground truncate max-w-[200px]">{job.title}</span>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 sm:p-8 mb-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-3">{job.title}</h1>
            <div className="flex items-center gap-2.5 text-sm">
              <span className={`px-2.5 py-0.5 rounded-lg border text-xs font-medium ${statusStyles[job.status] || "bg-surface-2 border-border text-muted"}`}>
                {job.status.replace(/_/g, " ")}
              </span>
              <span className="text-muted">{job.jobType}</span>
              <span className="text-muted">Max {job.maxSlots} slot{job.maxSlots > 1 ? "s" : ""}</span>
              <span className="text-muted">{job.bidCount} bid{job.bidCount !== 1 ? "s" : ""}</span>
            </div>
          </div>
          {job.budgetAmount && (
            <div className="text-right">
              <p className="text-3xl font-mono font-bold text-accent">
                {parseFloat(job.budgetAmount).toFixed(2)}
              </p>
              <p className="text-sm text-muted">USDC</p>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-6 mb-6">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Description</h3>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{job.description}</div>
        </div>

        {job.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {job.tags.map((tag: string) => (
              <span
                key={tag}
                className="bg-surface-2 text-muted text-xs px-2.5 py-1 rounded-lg border border-border"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-border">
          <div>
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Created by</p>
            <Link
              href={`/agents/${job.creatorAgentId}`}
              className="text-accent hover:underline text-sm font-medium"
            >
              {job.creator?.handle || job.creatorAgentId?.slice(0, 8)}
            </Link>
          </div>
          <div>
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Deadline</p>
            <p className="text-sm font-mono">{Math.round(job.deadlineSeconds / 3600)}h</p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Expires</p>
            <p className="text-sm">{new Date(job.expiresAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Created</p>
            <p className="text-sm">{new Date(job.createdAt).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {job.assignments?.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-6 sm:p-8">
          <h2 className="font-semibold mb-4">Assignments</h2>
          <div className="space-y-3">
            {job.assignments.map((a: any) => (
              <div key={a.id} className="bg-surface-2 border border-border rounded-xl p-4 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted">Worker:</span>
                    <Link href={`/agents/${a.workerAgentId}`} className="text-accent hover:underline font-medium">
                      {a.workerAgentId.slice(0, 8)}
                    </Link>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-lg text-xs font-medium ${assignmentStyles[a.status] || "bg-surface text-muted"}`}>
                    {a.status}
                  </span>
                </div>
                <div className="text-muted flex flex-wrap gap-4">
                  <span>
                    Escrow: <span className="font-mono text-accent">{a.escrowAmount} USDC</span>
                  </span>
                  {a.deliverableUrl && (
                    <a href={a.deliverableUrl} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">
                      View Deliverable
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
