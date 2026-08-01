import { jest } from '@jest/globals';

import { PrismaClient } from '../../../src/generated/prisma/client.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

describe('PrismaService', () => {
  it('connects on module init', async () => {
    const connectSpy = jest.spyOn(PrismaClient.prototype, '$connect').mockResolvedValue(undefined);
    const service = new PrismaService();

    await service.onModuleInit();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    connectSpy.mockRestore();
  });

  it('disconnects on module destroy', async () => {
    const disconnectSpy = jest
      .spyOn(PrismaClient.prototype, '$disconnect')
      .mockResolvedValue(undefined);
    const service = new PrismaService();

    await service.onModuleDestroy();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    disconnectSpy.mockRestore();
  });

  it('propagates a connection failure from onModuleInit', async () => {
    const connectionError = new Error('connection refused');
    const connectSpy = jest
      .spyOn(PrismaClient.prototype, '$connect')
      .mockRejectedValue(connectionError);
    const service = new PrismaService();

    await expect(service.onModuleInit()).rejects.toThrow(connectionError);

    connectSpy.mockRestore();
  });
});
