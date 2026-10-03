import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "scraping-queue";

  console.log(`[worker] connecting to temporal @ ${address} (ns=${namespace}, queue=${taskQueue})`);
  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
    maxConcurrentActivityTaskExecutions: 4, // bound concurrent Chromium pages
  });

  console.log("[worker] running — press Ctrl+C to stop");
  await worker.run();
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
