import { jest } from '@jest/globals';

import { AgentOrchestrationClient, AgentOrchestrationUnavailableError } from '../../src/agent-orchestration/agent-orchestration.client.js';
import { EMBEDDING_DIMENSIONS } from '../../src/agent-orchestration/schemas/embed-response.schema.js';

function vector(seed = 0.1): number[] {
  return Array(EMBEDDING_DIMENSIONS).fill(seed);
}

describe('AgentOrchestrationClient.embed (contract, fetch stubbed)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns vectors in the same order as the request on a valid response', async () => {
    const body = {
      vectors: [vector(0.1), vector(0.2)],
      model: 'text-embedding-3-small',
      dimensions: EMBEDDING_DIMENSIONS,
    };
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as unknown as Response);

    const client = new AgentOrchestrationClient();
    const vectors = await client.embed(['Throttling', 'Rate Limiting']);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/embed'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ texts: ['Throttling', 'Rate Limiting'] }),
      }),
    );
  });

  it('rejects a vectors/texts length mismatch rather than silently misaligning', async () => {
    const body = {
      vectors: [vector()], // 1 vector for 2 requested texts
      model: 'text-embedding-3-small',
      dimensions: EMBEDDING_DIMENSIONS,
    };
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as unknown as Response);

    const client = new AgentOrchestrationClient();
    await expect(client.embed(['Throttling', 'Rate Limiting'])).rejects.toThrow(AgentOrchestrationUnavailableError);
  });

  it('maps a non-2xx status to AgentOrchestrationUnavailableError', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ detail: 'provider call failed' }),
    } as unknown as Response);

    const client = new AgentOrchestrationClient();
    await expect(client.embed(['Throttling'])).rejects.toThrow(AgentOrchestrationUnavailableError);
  });

  it('names the agent service on connection refused', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    const client = new AgentOrchestrationClient();
    await expect(client.embed(['Throttling'])).rejects.toThrow(/agent orchestration service/i);
  });

  it('rejects a response whose vectors have the wrong dimension', async () => {
    const body = {
      vectors: [Array(3072).fill(0.1)],
      model: 'text-embedding-3-large',
      dimensions: EMBEDDING_DIMENSIONS,
    };
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as unknown as Response);

    const client = new AgentOrchestrationClient();
    await expect(client.embed(['Throttling'])).rejects.toThrow(AgentOrchestrationUnavailableError);
  });
});
