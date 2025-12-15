/**
 * Job Tracker - Auto-polls Higgsfield and sends callbacks when images are ready
 */

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 15000; // 15 seconds
const MAX_POLL_ATTEMPTS = 40; // 10 minutes max (40 * 15s)

type JobStatus = "polling" | "succeeded" | "failed" | "cancelled";

interface Job {
  requestId: string;
  contactId: string;
  userId: string;
  status: JobStatus;
  pollCount: number;
  images: string[];
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

// In-memory job storage
const jobs = new Map<string, Job>();

// Polling interval reference
let pollInterval: NodeJS.Timeout | null = null;

/**
 * Build Higgsfield auth headers from environment
 */
function buildAuthHeaders(): Record<string, string> {
  const keyId = process.env.HIGGSFIELD_KEY_ID;
  const keySecret = process.env.HIGGSFIELD_KEY_SECRET;
  const bearer = process.env.HIGGSFIELD_BEARER_TOKEN;
  const headers: Record<string, string> = {};

  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  } else if (keyId && keySecret) {
    headers.Authorization = `Key ${keyId}:${keySecret}`;
  }

  if (process.env.HIGGSFIELD_API_KEY) {
    headers["x-api-key"] = process.env.HIGGSFIELD_API_KEY;
  }

  return headers;
}

/**
 * Check status of a single job with Higgsfield
 */
async function checkJobStatus(job: Job): Promise<void> {
  try {
    const headers = buildAuthHeaders();
    const response = await fetch(
      `${HIGGSFIELD_BASE}/requests/${job.requestId}/status`,
      { headers: { Accept: "application/json", ...headers } }
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      console.log(`[job-tracker] Status check failed for ${job.requestId}:`, payload);
      job.pollCount++;
      return;
    }

    const status = payload?.status || payload?.state;
    const images = payload?.image_urls || payload?.outputs || payload?.result || [];

    console.log(`[job-tracker] Job ${job.requestId} - Status: ${status}, Poll #${job.pollCount + 1}`);

    if (status === "succeeded") {
      job.status = "succeeded";
      job.images = Array.isArray(images) ? images : [];
      job.completedAt = new Date();
      console.log(`[job-tracker] ✓ Job ${job.requestId} succeeded with ${job.images.length} image(s)`);
      
      // Send callback to ChatGPT Builder
      await sendCallback(job);
    } else if (status === "failed" || status === "error" || status === "cancelled") {
      job.status = "failed";
      job.error = payload?.error || payload?.message || `Generation ${status}`;
      job.completedAt = new Date();
      console.error(`[job-tracker] ✗ Job ${job.requestId} failed:`, job.error);
    } else {
      // Still processing
      job.pollCount++;
      
      // Check if max attempts reached
      if (job.pollCount >= MAX_POLL_ATTEMPTS) {
        job.status = "failed";
        job.error = "Polling timeout - max attempts reached";
        job.completedAt = new Date();
        console.error(`[job-tracker] ✗ Job ${job.requestId} timed out after ${job.pollCount} attempts`);
      }
    }
  } catch (error) {
    console.error(`[job-tracker] Error checking job ${job.requestId}:`, error);
    job.pollCount++;
  }
}

/**
 * Send callback to ChatGPT Builder with the generated image URL
 */
async function sendCallback(job: Job): Promise<void> {
  if (job.images.length === 0) {
    console.error(`[job-tracker] No images to send for job ${job.requestId}`);
    return;
  }

  const accessToken = process.env.CHATGPT_BUILDER_TOKEN || "1234372.w5LIIOK11XiUEEU4X6qnzjvwE7YXpQ0x";
  const imageUrl = job.images[0];

  // ========================================
  // CALLBACK 1: Save image URL to custom field
  // ========================================
  const customFieldUrl = `https://app.chatgptbuilder.io/api/contacts/${job.contactId}/custom_fields/871218`;

  try {
    console.log(`[job-tracker] Callback 1: Saving image to custom field for job ${job.requestId}`);

    const response = await fetch(customFieldUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ACCESS-TOKEN": accessToken,
      },
      body: JSON.stringify({
        value: imageUrl,
      }),
    });

    if (response.ok) {
      console.log(`[job-tracker] ✓ Callback 1 success: Image saved for job ${job.requestId}`);
    } else {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[job-tracker] ✗ Callback 1 failed for job ${job.requestId}:`, response.status, errorText);
    }
  } catch (error) {
    console.error(`[job-tracker] ✗ Callback 1 error for job ${job.requestId}:`, error);
  }

  // ========================================
  // CALLBACK 2: Trigger flow to send message
  // ========================================
  const flowId = process.env.CHATGPT_BUILDER_FLOW_ID || "1760629479392";
  const triggerFlowUrl = `https://app.chatgptbuilder.io/api/contacts/${job.contactId}/send/${flowId}`;

  try {
    console.log(`[job-tracker] Callback 2: Triggering flow ${flowId} for contact ${job.contactId}`);

    const response = await fetch(triggerFlowUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ACCESS-TOKEN": accessToken,
      },
    });

    if (response.ok) {
      console.log(`[job-tracker] ✓ Callback 2 success: Flow triggered for job ${job.requestId}`);
    } else {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[job-tracker] ✗ Callback 2 failed for job ${job.requestId}:`, response.status, errorText);
    }
  } catch (error) {
    console.error(`[job-tracker] ✗ Callback 2 error for job ${job.requestId}:`, error);
  }
}

/**
 * Poll all pending jobs
 */
async function pollAllJobs(): Promise<void> {
  const pendingJobs = Array.from(jobs.values()).filter((job) => job.status === "polling");

  if (pendingJobs.length === 0) {
    return;
  }

  console.log(`[job-tracker] Polling ${pendingJobs.length} pending job(s)...`);

  // Poll all jobs in parallel
  await Promise.all(pendingJobs.map(checkJobStatus));

  // Clean up completed jobs older than 1 hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [requestId, job] of jobs.entries()) {
    if (job.completedAt && job.completedAt < oneHourAgo) {
      jobs.delete(requestId);
      console.log(`[job-tracker] Cleaned up old job ${requestId}`);
    }
  }
}

/**
 * Start the polling interval (if not already running)
 */
function startPolling(): void {
  if (pollInterval) return;

  console.log("[job-tracker] Starting auto-poll interval (every 15s)");
  pollInterval = setInterval(() => {
    void pollAllJobs();
  }, POLL_INTERVAL_MS);
}

/**
 * Add a new job to track
 */
export function addJob(requestId: string, contactId: string, userId: string): Job {
  const job: Job = {
    requestId,
    contactId,
    userId,
    status: "polling",
    pollCount: 0,
    images: [],
    createdAt: new Date(),
  };

  jobs.set(requestId, job);
  console.log(`[job-tracker] Added job ${requestId} for contact ${contactId}`);

  // Start polling if not already running
  startPolling();

  // Do an immediate first check after 5 seconds
  setTimeout(() => {
    const j = jobs.get(requestId);
    if (j && j.status === "polling") {
      void checkJobStatus(j);
    }
  }, 5000);

  return job;
}

/**
 * Get job status by requestId
 */
export function getJob(requestId: string): Job | undefined {
  return jobs.get(requestId);
}

/**
 * Get all jobs (for debugging)
 */
export function getAllJobs(): Job[] {
  return Array.from(jobs.values());
}

