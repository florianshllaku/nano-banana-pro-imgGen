import type { NextApiRequest, NextApiResponse } from "next";
import { withMiddleware } from "../../lib/middleware";
import { getJob, getAllJobs } from "../../lib/job-tracker";

/**
 * GET /api/jobs - List all jobs (for debugging)
 * GET /api/jobs?requestId=xxx - Get specific job status
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const requestId = req.query.requestId as string | undefined;

  if (requestId) {
    // Get specific job
    const job = getJob(requestId);
    if (!job) {
      return res.status(404).json({
        error: "Job not found",
        requestId,
      });
    }

    return res.status(200).json({
      requestId: job.requestId,
      contactId: job.contactId,
      userId: job.userId,
      status: job.status,
      pollCount: job.pollCount,
      images: job.images,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  }

  // List all jobs
  const jobs = getAllJobs();
  
  return res.status(200).json({
    total: jobs.length,
    polling: jobs.filter((j) => j.status === "polling").length,
    succeeded: jobs.filter((j) => j.status === "succeeded").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    jobs: jobs.map((job) => ({
      requestId: job.requestId,
      contactId: job.contactId,
      status: job.status,
      pollCount: job.pollCount,
      images: job.images.length,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    })),
  });
}

export default withMiddleware(handler);

