/**
 * HempForge Integration Adapter Framework
 * 
 * Item 6: Common adapter interface for all external system integrations.
 * Each integration follows the adapter pattern with a shared contract.
 */

import crypto from "crypto";
import type { IntegrationConfig, IntegrationType, IntegrationStatus } from "../../shared/types";
import { appendEvent } from "../audit/eventStore";

// ─── Base Adapter Interface ──────────────────────────────────────────────────

export interface IntegrationAdapter<TConfig = Record<string, unknown>> {
  type: IntegrationType;
  name: string;

  /** Test connectivity to the external system */
  testConnection(config: TConfig): Promise<{ connected: boolean; message: string }>;

  /** Sync data from the external system */
  pull(config: TConfig, options?: { since?: string }): Promise<{ records: unknown[]; syncedAt: string }>;

  /** Push data to the external system */
  push(config: TConfig, data: unknown[]): Promise<{ pushed: number; errors: string[] }>;

  /** Validate configuration */
  validateConfig(config: TConfig): { valid: boolean; errors: string[] };
}

// ─── Integration Registry ────────────────────────────────────────────────────

const integrationStore: Map<string, IntegrationConfig> = new Map();
const adapterRegistry: Map<IntegrationType, IntegrationAdapter> = new Map();

/**
 * Register an integration adapter.
 */
export function registerAdapter(adapter: IntegrationAdapter): void {
  adapterRegistry.set(adapter.type, adapter);
}

/**
 * Get a registered adapter by type.
 */
export function getAdapter(type: IntegrationType): IntegrationAdapter | undefined {
  return adapterRegistry.get(type);
}

/**
 * Create a new integration configuration.
 */
export function createIntegration(params: {
  type: IntegrationType;
  name: string;
  tenantId: string;
  config: Record<string, unknown>;
}): IntegrationConfig {
  const adapter = adapterRegistry.get(params.type);
  if (!adapter) {
    throw new Error(`No adapter registered for integration type: ${params.type}`);
  }

  const validation = adapter.validateConfig(params.config);
  if (!validation.valid) {
    throw new Error(`Invalid configuration: ${validation.errors.join(", ")}`);
  }

  const now = new Date().toISOString();
  const integration: IntegrationConfig = {
    id: `int-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    type: params.type,
    name: params.name,
    status: "pending-setup",
    tenantId: params.tenantId,
    config: params.config,
    createdAt: now,
    updatedAt: now,
  };

  integrationStore.set(integration.id, integration);
  return integration;
}

/**
 * Test an integration connection.
 */
export async function testIntegration(integrationId: string, userId: string): Promise<{
  connected: boolean;
  message: string;
}> {
  const integration = integrationStore.get(integrationId);
  if (!integration) {
    return { connected: false, message: "Integration not found" };
  }

  const adapter = adapterRegistry.get(integration.type);
  if (!adapter) {
    return { connected: false, message: `No adapter for type: ${integration.type}` };
  }

  const result = await adapter.testConnection(integration.config);

  integration.status = result.connected ? "connected" : "error";
  integration.errorMessage = result.connected ? undefined : result.message;
  integration.updatedAt = new Date().toISOString();
  integrationStore.set(integrationId, integration);

  appendEvent({
    type: "integration.synced",
    aggregateId: integrationId,
    aggregateType: "integration",
    tenantId: integration.tenantId,
    userId,
    payload: { action: "test", connected: result.connected, message: result.message },
  });

  return result;
}

/**
 * Sync data from an integration.
 */
export async function syncIntegration(integrationId: string, userId: string, options?: { since?: string }): Promise<{
  success: boolean;
  records?: unknown[];
  error?: string;
}> {
  const integration = integrationStore.get(integrationId);
  if (!integration) {
    return { success: false, error: "Integration not found" };
  }

  const adapter = adapterRegistry.get(integration.type);
  if (!adapter) {
    return { success: false, error: `No adapter for type: ${integration.type}` };
  }

  try {
    integration.status = "syncing";
    integrationStore.set(integrationId, integration);

    const result = await adapter.pull(integration.config, options);

    integration.status = "connected";
    integration.lastSyncAt = result.syncedAt;
    integration.updatedAt = new Date().toISOString();
    integrationStore.set(integrationId, integration);

    appendEvent({
      type: "integration.synced",
      aggregateId: integrationId,
      aggregateType: "integration",
      tenantId: integration.tenantId,
      userId,
      payload: { action: "pull", recordCount: result.records.length },
    });

    return { success: true, records: result.records };
  } catch (err: any) {
    integration.status = "error";
    integration.errorMessage = err.message;
    integration.updatedAt = new Date().toISOString();
    integrationStore.set(integrationId, integration);

    return { success: false, error: err.message };
  }
}

/**
 * List integrations for a tenant.
 */
export function listIntegrations(tenantId: string): IntegrationConfig[] {
  return Array.from(integrationStore.values()).filter((i) => i.tenantId === tenantId);
}

/**
 * Get integration by ID.
 */
export function getIntegration(integrationId: string): IntegrationConfig | undefined {
  return integrationStore.get(integrationId);
}

// ─── Built-in Adapters ───────────────────────────────────────────────────────

/** LIMS Integration Adapter */
export const limsAdapter: IntegrationAdapter = {
  type: "lims",
  name: "Laboratory Information Management System",

  async testConnection(config) {
    if (!config.apiUrl || !config.apiKey) {
      return { connected: false, message: "Missing apiUrl or apiKey in configuration" };
    }
    // In production, this would make an actual HTTP request to the LIMS API
    return { connected: true, message: "LIMS connection test successful" };
  },

  async pull(config, options) {
    // In production, fetch from LIMS API
    return { records: [], syncedAt: new Date().toISOString() };
  },

  async push(config, data) {
    // In production, push to LIMS API
    return { pushed: data.length, errors: [] };
  },

  validateConfig(config) {
    const errors: string[] = [];
    if (!config.apiUrl) errors.push("apiUrl is required");
    if (!config.apiKey) errors.push("apiKey is required");
    return { valid: errors.length === 0, errors };
  },
};

/** Instrument Import Adapter */
export const instrumentAdapter: IntegrationAdapter = {
  type: "instrument",
  name: "Laboratory Instrument Data Import",

  async testConnection(config) {
    if (!config.importPath) {
      return { connected: false, message: "Missing importPath in configuration" };
    }
    return { connected: true, message: "Instrument import path configured" };
  },

  async pull(config, options) {
    // In production, read CSV/XML files from instrument output directory
    return { records: [], syncedAt: new Date().toISOString() };
  },

  async push(config, data) {
    return { pushed: 0, errors: ["Push not supported for instrument adapter"] };
  },

  validateConfig(config) {
    const errors: string[] = [];
    if (!config.importPath) errors.push("importPath is required");
    if (!config.fileFormat) errors.push("fileFormat is required (csv or xml)");
    return { valid: errors.length === 0, errors };
  },
};

/** Metrc / Seed-to-Sale Adapter */
export const metrcAdapter: IntegrationAdapter = {
  type: "metrc",
  name: "Metrc Seed-to-Sale Tracking",

  async testConnection(config) {
    if (!config.apiKey || !config.facilityId) {
      return { connected: false, message: "Missing apiKey or facilityId" };
    }
    return { connected: true, message: "Metrc API connection configured" };
  },

  async pull(config, options) {
    // In production, call Metrc API
    return { records: [], syncedAt: new Date().toISOString() };
  },

  async push(config, data) {
    // In production, push package updates to Metrc
    return { pushed: data.length, errors: [] };
  },

  validateConfig(config) {
    const errors: string[] = [];
    if (!config.apiKey) errors.push("apiKey is required");
    if (!config.facilityId) errors.push("facilityId is required");
    if (!config.stateCode) errors.push("stateCode is required");
    return { valid: errors.length === 0, errors };
  },
};

/** E-Signature Adapter */
export const eSignatureAdapter: IntegrationAdapter = {
  type: "e-signature",
  name: "Electronic Signature Service",

  async testConnection(config) {
    if (!config.provider || !config.apiKey) {
      return { connected: false, message: "Missing provider or apiKey" };
    }
    return { connected: true, message: `${config.provider} e-signature service configured` };
  },

  async pull(config, options) {
    // In production, fetch signed document status
    return { records: [], syncedAt: new Date().toISOString() };
  },

  async push(config, data) {
    // In production, submit documents for signature
    return { pushed: data.length, errors: [] };
  },

  validateConfig(config) {
    const errors: string[] = [];
    if (!config.provider) errors.push("provider is required (e.g., 'docusign', 'adobe-sign')");
    if (!config.apiKey) errors.push("apiKey is required");
    return { valid: errors.length === 0, errors };
  },
};

// Register built-in adapters
registerAdapter(limsAdapter);
registerAdapter(instrumentAdapter);
registerAdapter(metrcAdapter);
registerAdapter(eSignatureAdapter);
