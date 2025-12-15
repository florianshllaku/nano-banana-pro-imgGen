import type { NextApiRequest, NextApiResponse, NextApiHandler } from "next";

type ApiError = {
  error: string;
  code?: string;
};

/**
 * Validates the API key from the request headers
 */
function validateApiKey(req: NextApiRequest): boolean {
  const apiKey = process.env.API_KEY;
  
  // If no API key is configured, skip authentication (development mode)
  if (!apiKey) {
    console.warn("[middleware] No API_KEY configured - authentication disabled");
    return true;
  }

  const providedKey = req.headers["x-api-key"] as string | undefined;
  return providedKey === apiKey;
}

/**
 * Sets CORS headers for cross-origin requests
 */
function setCorsHeaders(req: NextApiRequest, res: NextApiResponse): boolean {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || ["*"];
  const origin = req.headers.origin || "";

  // Check if origin is allowed
  const isAllowed = allowedOrigins.includes("*") || allowedOrigins.includes(origin);

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigins.includes("*") ? "*" : origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true; // Request handled
  }

  return false; // Continue to handler
}

/**
 * Middleware wrapper that adds authentication and CORS
 */
export function withMiddleware(handler: NextApiHandler): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse<ApiError | unknown>) => {
    // Handle CORS
    const handled = setCorsHeaders(req, res);
    if (handled) return;

    // Validate API key
    if (!validateApiKey(req)) {
      return res.status(401).json({
        error: "Unauthorized - Invalid or missing API key",
        code: "UNAUTHORIZED",
      });
    }

    // Call the actual handler
    return handler(req, res);
  };
}

/**
 * Lightweight CORS-only middleware (for public endpoints like health check)
 */
export function withCors(handler: NextApiHandler): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const handled = setCorsHeaders(req, res);
    if (handled) return;
    return handler(req, res);
  };
}

