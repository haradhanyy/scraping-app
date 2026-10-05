import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, Button, Input, Badge, Modal, Label, Select } from "./ui";
import { format } from "date-fns";

const API = "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  key?: string;
}

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState("30");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data: keys, isLoading } = useQuery({
    queryKey: ["apiKeys"],
    queryFn: () => req<ApiKey[]>("/api/v1/api-keys"),
  });

  const createMutation = useMutation({
    mutationFn: (input: { name: string; expiresInDays: number }) =>
      req<ApiKey & { key: string }>("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setShowCreateModal(false);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      req(`/api/v1/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ name: newKeyName, expiresInDays: Number(newKeyExpiry) });
  };

  if (isLoading) return <div className="p-5 text-sm text-zinc-500">Loading API keys…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">API Keys</h2>
        <Button onClick={() => setShowCreateModal(true)} className="w-auto">
          + New API Key
        </Button>
      </div>

      <Card>
        {keys && keys.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No API keys yet. Create one to start using the API.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {keys?.map((k) => (
              <div key={k.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-medium">{k.name}</p>
                    <p className="text-xs text-zinc-500 font-mono">{k.prefix}…</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge status={k.isActive ? "LIVE" : "IDLE"} />
                    {k.expiresAt && (
                      <span className="text-xs text-zinc-500">
                        Expires {format(new Date(k.expiresAt), "MMM d, yyyy")}
                      </span>
                    )}
                    {k.lastUsedAt && (
                      <span className="text-xs text-zinc-400">
                        Last used {format(new Date(k.lastUsedAt), "MMM d, yyyy")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(`${k.prefix}…`)}
                    disabled={!k.isActive}
                  >
                    Copy Prefix
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => deleteMutation.mutate(k.id)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Create Modal */}
      <Modal open={showCreateModal} onOpenChange={setShowCreateModal}>
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Create New API Key</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production, Staging, Mobile App"
                required
              />
            </div>
            <div>
              <Label>Expires In</Label>
              <Select value={newKeyExpiry} onChange={(e) => setNewKeyExpiry(e.target.value)}>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
                <option value="3650">Never (10 years)</option>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create API Key"}
              </Button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Created Key Modal - Shows ONCE */}
      <Modal open={!!createdKey} onOpenChange={() => setCreatedKey(null)}>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <h3 className="text-lg font-semibold">API Key Created!</h3>
          </div>
          <div className="rounded-lg bg-zinc-100 p-4 font-mono text-sm break-all">
            {createdKey}
          </div>
          <div className="rounded-lg bg-red-50 p-3">
            <p className="text-sm text-red-600">
              <span className="font-bold">Copy this now!</span> This is the only time the full key will be shown.
              It cannot be retrieved again.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                navigator.clipboard.writeText(createdKey!);
                setCreatedKey(null);
              }}
              className="flex-1"
            >
              Copy & Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}