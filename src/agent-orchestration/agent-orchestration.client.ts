import { Injectable } from '@nestjs/common';

import { extractResponseSchema, type ExtractResponse } from './schemas/extract-response.schema.js';

const DEFAULT_AGENT_SERVICE_URL = 'http://localhost:8000';
const TIMEOUT_MS = 30_000;

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
}
