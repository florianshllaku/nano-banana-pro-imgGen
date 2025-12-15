import type { NextApiRequest, NextApiResponse } from "next";
import { withCors } from "../../lib/middleware";

type HealthResponse = {
  status: "ok" | "error";
  timestamp: string;
  service: string;
  version: string;
  uptime: number;
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>,
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      timestamp: new Date().toISOString(),
      service: "sparkai-fashion-api",
      version: "0.1.0",
      uptime: process.uptime(),
    });
  }

  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "sparkai-fashion-api",
    version: "0.1.0",
    uptime: process.uptime(),
  });
}

export default withCors(handler);

