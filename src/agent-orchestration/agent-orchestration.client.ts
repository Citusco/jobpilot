import { Injectable } from '@nestjs/common';

import { embedResponseSchema } from './schemas/embed-response.schema.js';
import { extractResponseSchema, type ExtractResponse } from './schemas/extract-response.schema.js';

const DEFAULT_AGENT_SERVICE_URL = 'http://localhost:8000';
const TIMEOUT_MS = 30_000;
// Longer than extract's 30s: a batch of ~70 texts is a single provider call,
// but a larger one (contracts/embed.md).
const EMBED_TIMEOUT_MS = 60_000;

export class AgentOrchestrationUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AgentOrchestrationUnavailableError';
  }
}

@Injectable()
export class AgentOrchestrationClient {
  async extract(text: string): Promise<ExtractResponse> {
    const baseUrl = process.env.AGENT_SERVICE_URL ?? DEFAULT_AGENT_SERVICE_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AgentOrchestrationUnavailableError('Failed to reach the agent orchestration service', {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new AgentOrchestrationUnavailableError(
        `Agent orchestration service responded with status ${response.status}`,
      );
    }

    const json: unknown = await response.json();
    const parsed = extractResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new AgentOrchestrationUnavailableError('Agent orchestration service returned an invalid response', {
        cause: parsed.error,
      });
    }

    return parsed.data;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const baseUrl = process.env.AGENT_SERVICE_URL ?? DEFAULT_AGENT_SERVICE_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AgentOrchestrationUnavailableError('Failed to reach the agent orchestration service', {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new AgentOrchestrationUnavailableError(
        `Agent orchestration service responded with status ${response.status}`,
      );
    }

    const json: unknown = await response.json();
    const parsed = embedResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new AgentOrchestrationUnavailableError('Agent orchestration service returned an invalid response', {
        cause: parsed.error,
      });
    }

    if (parsed.data.vectors.length !== texts.length) {
      throw new AgentOrchestrationUnavailableError(
        `Agent orchestration service returned ${parsed.data.vectors.length} vectors for ${texts.length} texts`,
      );
    }

    return parsed.data.vectors;
  }
}
