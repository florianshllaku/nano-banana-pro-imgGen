/**
 * Job Tracker - Auto-polls Higgsfield and sends callbacks when images are ready
 */

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 20000; // 20 seconds
const MAX_POLL_ATTEMPTS = 30; // 10 minutes max (30 * 20s)
const CALLBACK_2_DELAY_MS = 15000; // 15 seconds delay before triggering flow

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
    
    // Extract images - handle multiple formats:
    // Format 1: payload.images = [{ url: "..." }, { url: "..." }]
    // Format 2: payload.image_urls = ["...", "..."]
    // Format 3: payload.outputs = ["...", "..."]
    let images: string[] = [];
    
    if (payload?.images && Array.isArray(payload.images)) {
      // Handle { url: "..." } format
      images = payload.images.map((img: { url?: string } | string) => 
        typeof img === "object" && img.url ? img.url : (typeof img === "string" ? img : "")
      ).filter(Boolean);
    } else if (payload?.image_urls) {
      images = Array.isArray(payload.image_urls) ? payload.image_urls : [];
    } else if (payload?.outputs) {
      images = Array.isArray(payload.outputs) ? payload.outputs : [];
    } else if (payload?.result) {
      images = Array.isArray(payload.result) ? payload.result : [];
    }

    console.log(`[job-tracker] Job ${job.requestId} - Status: ${status}, Poll #${job.pollCount + 1}, Images: ${images.length}`);

    // Check for completion - Higgsfield uses "completed" not "succeeded"
    if (status === "completed" || status === "succeeded") {
      job.status = "succeeded";
      job.images = images;
      job.completedAt = new Date();
      console.log(`[job-tracker] ✓ Job ${job.requestId} completed with ${job.images.length} image(s)`);
      
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
    console.error(`[job-tracker] ❌ No images to send for job ${job.requestId}`);
    return;
  }

  const accessToken = process.env.CHATGPT_BUILDER_TOKEN || "1234372.w5LIIOK11XiUEEU4X6qnzjvwE7YXpQ0x";
  const imageUrl = job.images[0];

  console.log(`[job-tracker] ========================================`);
  console.log(`[job-tracker] STARTING CALLBACKS FOR JOB: ${job.requestId}`);
  console.log(`[job-tracker] Contact ID: ${job.contactId}`);
  console.log(`[job-tracker] User ID: ${job.userId}`);
  console.log(`[job-tracker] Image URL: ${imageUrl}`);
  console.log(`[job-tracker] ========================================`);

  // ========================================
  // CALLBACK 1: Save image URL to custom field
  // ========================================
  const customFieldId = process.env.CHATGPT_BUILDER_CUSTOM_FIELD_ID || "871218";
  const customFieldUrl = `https://app.chatgptbuilder.io/api/contacts/${job.contactId}/custom_fields/${customFieldId}`;
  const callback1Body = `value=${encodeURIComponent(imageUrl)}`;

  console.log(`[job-tracker] ----------------------------------------`);
  console.log(`[job-tracker] CALLBACK 1: Save Image to Custom Field`);
  console.log(`[job-tracker] URL: ${customFieldUrl}`);
  console.log(`[job-tracker] Method: POST`);
  console.log(`[job-tracker] Headers: { "Content-Type": "application/x-www-form-urlencoded", "X-ACCESS-TOKEN": "${accessToken.substring(0, 10)}..." }`);
  console.log(`[job-tracker] Body: ${callback1Body}`);

  try {
    const response = await fetch(customFieldUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "X-ACCESS-TOKEN": accessToken,
      },
      body: callback1Body,
    });

    const responseText = await response.text().catch(() => "");
    
    console.log(`[job-tracker] Response Status: ${response.status}`);
    console.log(`[job-tracker] Response Body: ${responseText}`);

    if (response.ok) {
      console.log(`[job-tracker] ✅ CALLBACK 1 SUCCESS`);
    } else {
      console.error(`[job-tracker] ❌ CALLBACK 1 FAILED - Status: ${response.status}`);
    }
  } catch (error) {
    console.error(`[job-tracker] ❌ CALLBACK 1 ERROR:`, error);
  }

  // ========================================
  // CALLBACK 2: Trigger flow to send message
  // ========================================
  // Wait 15 seconds before triggering flow
  console.log(`[job-tracker] ----------------------------------------`);
  console.log(`[job-tracker] Waiting ${CALLBACK_2_DELAY_MS / 1000} seconds before Callback 2...`);
  await new Promise((resolve) => setTimeout(resolve, CALLBACK_2_DELAY_MS));
  
  const flowId = process.env.CHATGPT_BUILDER_FLOW_ID || "1760629479392";
  const triggerFlowUrl = `https://app.chatgptbuilder.io/api/contacts/${job.contactId}/send/${flowId}`;

  console.log(`[job-tracker] CALLBACK 2: Trigger Flow`);
  console.log(`[job-tracker] URL: ${triggerFlowUrl}`);
  console.log(`[job-tracker] Method: POST`);
  console.log(`[job-tracker] Headers: { "Accept": "application/json", "X-ACCESS-TOKEN": "${accessToken.substring(0, 10)}..." }`);
  console.log(`[job-tracker] Body: (empty)`);

  try {
    const response = await fetch(triggerFlowUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "X-ACCESS-TOKEN": accessToken,
      },
    });

    const responseText = await response.text().catch(() => "");
    
    console.log(`[job-tracker] Response Status: ${response.status}`);
    console.log(`[job-tracker] Response Body: ${responseText}`);

    if (response.ok) {
      console.log(`[job-tracker] ✅ CALLBACK 2 SUCCESS`);
    } else {
      console.error(`[job-tracker] ❌ CALLBACK 2 FAILED - Status: ${response.status}`);
    }
  } catch (error) {
    console.error(`[job-tracker] ❌ CALLBACK 2 ERROR:`, error);
  }

  console.log(`[job-tracker] ========================================`);
  console.log(`[job-tracker] CALLBACKS COMPLETED FOR JOB: ${job.requestId}`);
  console.log(`[job-tracker] ========================================`);
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

