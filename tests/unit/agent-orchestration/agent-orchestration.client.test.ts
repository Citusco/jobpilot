import { jest } from '@jest/globals';

import {
  AgentOrchestrationClient,
  AgentOrchestrationUnavailableError,
} from '../../../src/agent-orchestration/agent-orchestration.client.js';

describe('AgentOrchestrationClient', () => {
  const originalFetch = globalThis.fetch;
  const originalAgentServiceUrl = process.env.AGENT_SERVICE_URL;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.AGENT_SERVICE_URL = originalAgentServiceUrl;
    jest.useRealTimers();
  });

  it('returns the validated response on a successful call', async () => {
    const body = { sufficient: false, reason: 'not enough information' };
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as unknown as Response);

    const client = new AgentOrchestrationClient();
    const result = await client.extract('short text');

    expect(result).toEqual(body);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/extract'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws AgentOrchestrationUnavailableError on network failure', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED'));

    const client = new AgentOrchestrationClient();

    await expect(client.extract('text')).rejects.toThrow(AgentOrchestrationUnavailableError);
  });

  it('throws AgentOrchestrationUnavailableError on a non-2xx response', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    const client = new AgentOrchestrationClient();

    await expect(client.extract('text')).rejects.toThrow(AgentOrchestrationUnavailableError);
  });

  it('throws AgentOrchestrationUnavailableError when the response fails schema validation', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ unexpected: 'shape' }),
    } as unknown as Response);

    const client = new AgentOrchestrationClient();

    await expect(client.extract('text')).rejects.toThrow(AgentOrchestrationUnavailableError);
  });

  it('throws AgentOrchestrationUnavailableError when the call times out', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const client = new AgentOrchestrationClient();
    const pending = client.extract('text');
    const assertion = expect(pending).rejects.toThrow(AgentOrchestrationUnavailableError);

    await jest.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
