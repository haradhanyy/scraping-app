import { useState } from "react";
import { JobDashboard } from "./components/JobDashboard";
import { JobDetail } from "./components/JobDetail";
import { JobForm } from "./components/JobForm";
import { ApiKeysPage } from "./components/ApiKeysPage";

type Page = "dashboard" | "api-keys";

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">ScrapeDeck</h1>
            <p className="text-xs text-zinc-500">Instagram & Threads scraping · Hono + Temporal + Playwright</p>
          </div>
          <a
            href="http://localhost:8233"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100"
          >
            Temporal UI ↗
          </a>
        </div>
      </header>

      <nav className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex gap-6">
            <button
              onClick={() => setPage("dashboard")}
              className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${
                page === "dashboard"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setPage("api-keys")}
              className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${
                page === "api-keys"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              API Keys
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[380px_1fr]">
        {page === "dashboard" && (
          <>
            <div className="space-y-4">
              <JobForm onCreated={setSelectedId} />
              <JobDashboard selectedId={selectedId} onSelect={setSelectedId} />
            </div>
            <JobDetail id={selectedId} />
          </>
        )}
        {page === "api-keys" && <ApiKeysPage />}
      </main>
    </div>
  );
}