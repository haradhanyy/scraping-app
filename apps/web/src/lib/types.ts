export type Platform = "instagram" | "threads";
export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "RATE_LIMITED";

export interface CreateJobInput {
  platform: Platform;
  target: string;
  maxPosts?: number;
}

export interface ScrapedPostDTO {
  id: string;
  jobId: string;
  platform: Platform;
  author: string;
  authorAvatar?: string | null;
  caption?: string | null;
  likes: number;
  commentsCount: number;
  mediaUrls: string[];
  postUrl?: string | null;
  postedAt?: string | null;
  scrapedAt: string;
}

export interface JobDTO {
  id: string;
  platform: Platform;
  target: string;
  targetUrl?: string | null;
  status: JobStatus;
  attemptCount: number;
  maxPosts: number;
  error?: string | null;
  temporalWorkflowId?: string | null;
  createdAt: string;
  updatedAt: string;
  posts?: ScrapedPostDTO[];
  _count?: { posts: number };
}
