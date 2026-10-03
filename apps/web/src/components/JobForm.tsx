import { useState } from "react";
import { useCreateJob } from "../lib/api";
import { Badge, Button, Card, Input, Label, Select } from "./ui";

export function JobForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [platform, setPlatform] = useState<"instagram" | "threads">("instagram");
  const [target, setTarget] = useState("");
  const [maxPosts, setMaxPosts] = useState(10);
  const create = useCreateJob();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      { platform, target: target.trim(), maxPosts },
      { onSuccess: (job) => { setTarget(""); onCreated(job.id); } },
    );
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">New scraping job</h2>
        <Badge status={platform.toUpperCase()} />
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Platform</Label>
            <Select value={platform} onChange={(e) => setPlatform(e.target.value as "instagram" | "threads")}>
              <option value="instagram">Instagram</option>
              <option value="threads">Threads</option>
            </Select>
          </div>
          <div>
            <Label>Max posts (1–50)</Label>
            <Input
              type="number" min={1} max={50} value={maxPosts}
              onChange={(e) => setMaxPosts(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
        </div>
        <div>
          <Label>Target URL or username</Label>
          <Input
            placeholder={platform === "instagram" ? "natgeo or https://www.instagram.com/p/…" : "@username or https://www.threads.com/…"}
            value={target} onChange={(e) => setTarget(e.target.value)} required
          />
          <p className="mt-1 text-xs text-zinc-500">
            Profiles scrape the grid; paste a post URL to scrape a single post card.
          </p>
        </div>
        {create.isError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {(create.error as Error).message}
          </p>
        )}
        <Button type="submit" disabled={create.isPending || !target.trim()} className="w-full">
          {create.isPending ? "Submitting…" : "Start scraping"}
        </Button>
      </form>
    </Card>
  );
}
