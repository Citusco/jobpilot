import { HealthController } from '../../../src/health/health.controller.js';

describe('HealthController', () => {
  it('returns status ok', () => {
    const controller = new HealthController();

    expect(controller.getHealth()).toEqual({ status: 'ok' });
  });
});
