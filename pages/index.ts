import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Root endpoint - redirects to API documentation or returns API info
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({
    name: "SparkAI Fashion API",
    version: "0.1.0",
    endpoints: {
      health: "GET /api/health",
      generate: "POST /api/generate",
      status: "GET /api/status?requestId=xxx",
    },
    documentation: "See README.md for full API documentation",
  });
}

