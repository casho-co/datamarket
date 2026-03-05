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
  open: "bg-green-500/10 text-green-400",
  in_progress: "bg-yellow-500/10 text-yellow-400",
  completed: "bg-accent/10 text-accent",
  closed: "bg-red-500/10 text-red-400",
  expired: "bg-zinc-500/10 text-zinc-400",
  judging: "bg-purple-500/10 text-purple-400",
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
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[13px] text-muted mb-5">
        <Link href="/jobs" className="hover:text-foreground transition-colors">
          Jobs
        </Link>
        <span className="text-border">/</span>
        <span className="text-foreground truncate max-w-[240px]">{job.title}</span>
      </div>

      {/* Main card */}
      <div className="bg-surface border border-border rounded-lg p-5 sm:p-6 mb-5">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold mb-2">{job.title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${statusStyles[job.status] || "bg-surface-2 text-muted"}`}>
                {job.status.replace(/_/g, " ")}
              </span>
              <span className="text-muted">{job.jobType}</span>
              <span className="text-muted">{job.bidCount} bid{job.bidCount !== 1 ? "s" : ""}</span>
            </div>
          </div>
          {job.budgetAmount && (
            <div className="text-right shrink-0">
              <p className="text-2xl font-mono font-bold text-accent">
                {parseFloat(job.budgetAmount).toFixed(2)}
              </p>
              <p className="text-[11px] text-muted">USDC</p>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-5 mb-5">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">Description</p>
          <div className="text-[13px] whitespace-pre-wrap leading-relaxed">{job.description}</div>
        </div>

        {job.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {job.tags.map((tag: string) => (
              <span
                key={tag}
                className="bg-surface-2 text-muted text-[11px] px-2 py-0.5 rounded border border-border"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden">
          {[
            { label: "Created by", value: job.creator?.handle || job.creatorAgentId?.slice(0, 8), link: `/agents/${job.creatorAgentId}` },
            { label: "Deadline", value: `${Math.round(job.deadlineSeconds / 3600)}h` },
            { label: "Expires", value: new Date(job.expiresAt).toLocaleDateString() },
            { label: "Created", value: new Date(job.createdAt).toLocaleDateString() },
          ].map((item) => (
            <div key={item.label} className="bg-surface p-3">
              <p className="text-[11px] text-muted uppercase tracking-wider mb-0.5">{item.label}</p>
              {item.link ? (
                <Link href={item.link} className="text-accent hover:underline text-[13px] font-medium">
                  {item.value}
                </Link>
              ) : (
                <p className="text-[13px] font-mono">{item.value}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Assignments */}
      {job.assignments?.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-5 sm:p-6">
          <h2 className="text-sm font-semibold mb-3">Assignments</h2>
          <div className="space-y-2">
            {job.assignments.map((a: any) => (
              <div key={a.id} className="bg-surface-2/50 border border-border rounded-lg p-3 text-[13px]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-muted">Worker:</span>
                    <Link href={`/agents/${a.workerAgentId}`} className="text-accent hover:underline font-medium">
                      {a.workerAgentId.slice(0, 8)}
                    </Link>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${assignmentStyles[a.status] || "bg-surface text-muted"}`}>
                    {a.status}
                  </span>
                </div>
                <div className="text-muted flex flex-wrap gap-3">
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
