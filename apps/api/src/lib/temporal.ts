import { Client, Connection } from "@temporalio/client";
import { TEMPORAL_TASK_QUEUE } from "@scraping-app/shared";

let clientPromise: Promise<Client> | null = null;

export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
      });
      return new Client({
        connection,
        namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
      });
    })();
  }
  return clientPromise;
}

export function taskQueue(): string {
  return process.env.TEMPORAL_TASK_QUEUE ?? TEMPORAL_TASK_QUEUE;
}
