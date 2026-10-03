import { useJobDetail, useRetryJob } from "../lib/api";
import { fmtNum, timeAgo } from "../lib/utils";
import { Badge, Button, Card } from "./ui";

export function JobDetail({ id }: { id: string | null }) {
  const { data: job, isLoading } = useJobDetail(id);
  const retry = useRetryJob();

  if (!id) return <Card className="p-8 text-center text-sm text-zinc-500">Select a job to inspect scraped posts.</Card>;
  if (isLoading || !job) return <Card className="p-5 text-sm text-zinc-500">Loading job…</Card>;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{job.target}</h2>
          <p className="break-all text-xs text-zinc-500">
            {job.targetUrl} · {timeAgo(job.createdAt)} · workflow{" "}
            <code>{job.temporalWorkflowId ?? "—"}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge status={job.status} />
          <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(job.id)}>
            {retry.isPending ? "Retrying…" : "Retry"}
          </Button>
        </div>
      </div>

      {job.error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{job.error}</p>
      )}
      {(job.status === "QUEUED" || job.status === "RUNNING") && (
        <p className="mt-3 animate-pulse rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          Scraping in progress — results appear automatically…
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(job.posts ?? []).map((p) => (
          <article key={p.id} className="overflow-hidden rounded-xl border border-zinc-200">
            {p.mediaUrls[0] && (
              <img src={p.mediaUrls[0]} alt="" className="aspect-square w-full object-cover" loading="lazy" />
            )}
            <div className="p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">@{p.author}</span>
                {p.postUrl && (
                  <a href={p.postUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    open ↗
                  </a>
                )}
              </div>
              {p.caption && <p className="mt-1 line-clamp-4 text-sm text-zinc-700">{p.caption}</p>}
              <div className="mt-2 flex gap-3 text-xs text-zinc-500">
                <span>❤ {fmtNum(p.likes)}</span>
                <span>💬 {fmtNum(p.commentsCount)}</span>
                {p.postedAt && <span>{timeAgo(p.postedAt)}</span>}
              </div>
            </div>
          </article>
        ))}
      </div>
      {(job.posts ?? []).length === 0 && job.status === "COMPLETED" && (
        <p className="mt-4 text-sm text-zinc-500">Completed but no posts were extracted — the page may be private or the layout changed.</p>
      )}
    </Card>
  );
}
