/**
 * HempForge Data Source Middleware
 * 
 * Item 1: Server-side enforcement of output labeling.
 * Every API response MUST include _dataSource classification.
 * Production mode rejects responses that use demo/simulated data sources.
 */

import type { Request, Response, NextFunction } from "express";
import type { OutputClassification, TaggedResponse } from "../../shared/types";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Middleware that tags all API responses with data source classification.
 * In production mode, blocks demo-only data from being served.
 */
export function dataSourceMiddleware(defaultClassification: OutputClassification = "production-real") {
  return (req: Request, res: Response, next: NextFunction) => {
    // Store the original json method
    const originalJson = res.json.bind(res);

    // Override res.json to automatically tag responses
    res.json = function (body: any) {
      // If the body already has a _dataSource tag, respect it
      if (body && body._dataSource) {
        // In production, reject demo-only data
        if (IS_PRODUCTION && body._dataSource === "demo-only") {
          return originalJson({
            error: "Data source rejected",
            details: "Demo-only data cannot be served in production mode.",
            _dataSource: "production-real",
            _timestamp: new Date().toISOString(),
          });
        }
        // Ensure timestamp is present
        if (!body._timestamp) {
          body._timestamp = new Date().toISOString();
        }
        return originalJson(body);
      }

      // If body is an array or primitive, wrap it
      if (Array.isArray(body) || typeof body !== "object" || body === null) {
        const tagged: TaggedResponse = {
          data: body,
          _dataSource: defaultClassification,
          _timestamp: new Date().toISOString(),
          _tenantId: (req as any).authContext?.tenantId || "unknown",
        };
        return originalJson(tagged);
      }

      // For objects without explicit tagging, add metadata
      body._dataSource = body._dataSource || defaultClassification;
      body._timestamp = body._timestamp || new Date().toISOString();

      // In production, block demo data
      if (IS_PRODUCTION && body._dataSource === "demo-only") {
        return originalJson({
          error: "Data source rejected",
          details: "Demo-only data cannot be served in production mode.",
          _dataSource: "production-real",
          _timestamp: new Date().toISOString(),
        });
      }

      return originalJson(body);
    } as any;

    next();
  };
}

/**
 * Helper to create a properly tagged API response.
 */
export function createTaggedResponse<T>(
  data: T,
  classification: OutputClassification,
  tenantId: string,
  disclaimers?: string[]
): TaggedResponse<T> {
  return {
    data,
    _dataSource: classification,
    _timestamp: new Date().toISOString(),
    _tenantId: tenantId,
    _disclaimers: disclaimers,
  };
}

/**
 * Guard function that blocks demo data access in production.
 * Use in route handlers that load from local-db-fallback.json.
 */
export function guardDemoDataAccess(res: Response): boolean {
  if (IS_PRODUCTION) {
    res.status(403).json({
      error: "Demo data access denied",
      details: "Demo/seed data is not available in production mode. Connect to a live data source.",
      _dataSource: "production-real" as OutputClassification,
      _timestamp: new Date().toISOString(),
    });
    return false; // Indicates the response was blocked
  }
  return true; // Allowed in non-production
}

/**
 * Determine output classification based on service availability.
 */
export function classifyOutputSource(services: {
  firestoreAvailable: boolean;
  geminiAvailable: boolean;
  ollamaAvailable: boolean;
}): OutputClassification {
  if (services.firestoreAvailable) {
    return "production-real";
  }
  return "demo-only";
}
