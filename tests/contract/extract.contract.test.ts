import { jest } from '@jest/globals';

import {
  AgentOrchestrationClient,
  AgentOrchestrationUnavailableError,
} from '../../src/agent-orchestration/agent-orchestration.client.js';

// Replaces tests/unit/agent-orchestration/agent-orchestration.client.test.ts, which
// covered extract() against the removed pipeline's shape. Placed alongside
// embed.contract.test.ts: both stub fetch and assert the cross-service contract, and
// neither reaches a provider.

const JD_TEXT =
  'We are hiring a Backend Engineer. Responsibilities include operating ' +
  'Queue-Based Load Leveling between services and tuning a message broker.';

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe('AgentOrchestrationClient.extract (contract, fetch stubbed)', () => {
  const originalFetch = globalThis.fetch;
  const originalAgentServiceUrl = process.env.AGENT_SERVICE_URL;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.AGENT_SERVICE_URL = originalAgentServiceUrl;
    jest.useRealTimers();
  });

  it('returns the validated items on a successful call', async () => {
    const body = {
      items: [
        {
          surface: 'Queue-Based Load Leveling',
          evidence: ['operating Queue-Based Load Leveling between services'],
        },
        { surface: 'message broker', evidence: ['tuning a message broker'] },
      ],
    };
    stubFetch(body);

    const client = new AgentOrchestrationClient();
    const result = await client.extract(JD_TEXT);

    expect(result).toEqual(body);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/extract'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: JD_TEXT }) }),
    );
  });

  it('returns an empty item list for a posting with no technical content', async () => {
    // FR-004: this is a success, not a rejection. There is no path left that refuses a
    // whole submission for lack of technical content.
    stubFetch({ items: [] });

    const client = new AgentOrchestrationClient();

    await expect(client.extract('A friendly team.')).resolves.toEqual({ items: [] });
  });

  it('rejects a response whose evidence span is not a substring of the submitted text', async () => {
    stubFetch({
      items: [
        { surface: 'message broker', evidence: ['the role involves working with message brokers'] },
      ],
    });

    const client = new AgentOrchestrationClient();

    await expect(client.extract(JD_TEXT)).rejects.toThrow(AgentOrchestrationUnavailableError);
  });

  it('rejects the removed pipeline’s sufficient/insufficient shape', async () => {
    stubFetch({ sufficient: false, reason: 'JD text is too short' });

    const client = new AgentOrchestrationClient();

    await expect(client.extract(JD_TEXT)).rejects.toThrow(AgentOrchestrationUnavailableError);
  });

  it('rejects a malformed payload', async () => {
    stubFetch({ unexpected: 'shape' });

    const client = new AgentOrchestrationClient();

    await expect(client.extract(JD_TEXT)).rejects.toThrow(AgentOrchestrationUnavailableError);
  });

  it('maps a non-2xx status to AgentOrchestrationUnavailableError', async () => {
    stubFetch({ detail: 'provider call failed' }, { ok: false, status: 502 });

    const client = new AgentOrchestrationClient();

    await expect(client.extract(JD_TEXT)).rejects.toThrow(AgentOrchestrationUnavailableError);
  });

  it('names the agent service when it is unreachable', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    const client = new AgentOrchestrationClient();

    await expect(client.extract(JD_TEXT)).rejects.toThrow(/agent orchestration service/i);
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
    const pending = client.extract(JD_TEXT);
    const assertion = expect(pending).rejects.toThrow(AgentOrchestrationUnavailableError);

    await jest.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
