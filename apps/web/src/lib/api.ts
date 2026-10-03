import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateJobInput, JobDTO } from "./types";

const API = ""; // same-origin via Vite proxy; set VITE_API_URL for direct calls

/** Hono zValidator returns { error: ZodError | string }; flatten to a readable message. */
function extractErrorMessage(body: unknown, status: number): string {
  const fallback = `Request failed (${status})`;
  if (!body || typeof body !== "object") return fallback;

  const err = (body as { error?: unknown }).error;
  if (typeof err === "string") return err;

  // ZodError: { issues: [{ path, message }] }
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: Array<{ path?: unknown[]; message?: string }> }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      const first = issues[0];
      const path = Array.isArray(first.path) ? first.path.join(".") : "";
      return path ? `${path}: ${first.message}` : (first.message ?? fallback);
    }
  }

  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(body, res.status));
  }
  return res.json() as Promise<T>;
}

export function useJobs(selectedId: string | null) {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: () => req<JobDTO[]>("/api/jobs"),
    // Poll while any job is active so the dashboard feels live.
    refetchInterval: (query) => {
      const jobs = query.state.data as JobDTO[] | undefined;
      const active = jobs?.some((j) => j.status === "QUEUED" || j.status === "RUNNING");
      return active ? 3000 : false;
    },
  });
}

export function useJobDetail(id: string | null) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => req<JobDTO>(`/api/jobs/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const j = query.state.data as JobDTO | undefined;
      return j && (j.status === "QUEUED" || j.status === "RUNNING") ? 2500 : false;
    },
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJobInput) =>
      req<JobDTO>("/api/jobs", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => req<JobDTO>(`/api/jobs/${id}/retry`, { method: "POST" }),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job", job.id] });
    },
  });
}
