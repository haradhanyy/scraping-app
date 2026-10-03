import { useJobs, useRetryJob } from "../lib/api";
import { fmtNum, timeAgo } from "../lib/utils";
import { Badge, Button, Card } from "./ui";

export function JobDashboard({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data: jobs, isLoading, isError, refetch } = useJobs(selectedId);
  const retry = useRetryJob();

  if (isLoading) return <Card className="p-5 text-sm text-zinc-500">Loading jobs…</Card>;
  if (isError)
    return (
      <Card className="p-5 text-sm">
        <p className="text-red-600">API unreachable. Is <code>bun dev:api</code> running?</p>
        <Button variant="outline" className="mt-3" onClick={() => refetch()}>Retry</Button>
      </Card>
    );

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-zinc-200 px-5 py-3">
        <h2 className="text-base font-semibold">Jobs ({jobs?.length ?? 0})</h2>
        <p className="text-xs text-zinc-500">Live-polling while jobs are active</p>
      </div>
      <ul className="divide-y divide-zinc-100">
        {(jobs ?? []).map((j) => (
          <li key={j.id}>
            <button
              onClick={() => onSelect(j.id)}
              className={`block w-full px-5 py-3 text-left hover:bg-zinc-50 ${selectedId === j.id ? "bg-zinc-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  <span className="mr-2 capitalize text-zinc-400">{j.platform}</span>
                  {j.target}
                </span>
                <Badge status={j.status} />
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                <span>{j._count?.posts ?? 0} posts</span>
                <span>attempts: {j.attemptCount}</span>
                <span>{timeAgo(j.createdAt)}</span>
                {(j.status === "FAILED" || j.status === "RATE_LIMITED") && (
                  <span
                    role="button" tabIndex={0}
                    className="font-semibold text-blue-600 hover:underline"
                    onClick={(e) => { e.stopPropagation(); retry.mutate(j.id); }}
                    onKeyDown={(e) => { if (e.key === "Enter") retry.mutate(j.id); }}
                  >
                    {retry.isPending ? "retrying…" : "retry"}
                  </span>
                )}
              </div>
              {j.error && <p className="mt-1 truncate text-xs text-red-500">{j.error}</p>}
            </button>
          </li>
        ))}
        {(jobs ?? []).length === 0 && (
          <li className="px-5 py-8 text-center text-sm text-zinc-500">
            No jobs yet — submit the form to start scraping.
          </li>
        )}
      </ul>
      <div className="border-t border-zinc-100 px-5 py-2 text-xs text-zinc-400">
        Posts: {jobs?.reduce((a, j) => a + (j._count?.posts ?? 0), 0) ?? 0} total · {fmtNum(0).length >= 0 ? "" : ""}
        Temporal UI: http://localhost:8233
      </div>
    </Card>
  );
}
