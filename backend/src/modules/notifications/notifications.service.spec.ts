import { Queue } from 'bullmq';
import { NOTIFICATION_JOBS } from './notifications.constants';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockQueue: { add: jest.Mock; close: jest.Mock };

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    service = new NotificationsService(mockQueue as unknown as Queue);
  });

  it('enqueues all 4 notification job types with expected names and payloads', async () => {
    await service.sendOtpVerification({
      to: 'user@test.local',
      fullName: 'Ana',
      otpCode: '123456',
      expiresInMinutes: 10,
      storeName: 'Moda',
    });
    expect(mockQueue.add).toHaveBeenLastCalledWith(
      NOTIFICATION_JOBS.OTP_VERIFICATION,
      expect.objectContaining({ otpCode: '123456', to: 'user@test.local' }),
    );

    await service.sendPasswordResetOtp({
      to: 'user@test.local',
      fullName: 'Ana',
      otpCode: '654321',
      expiresInMinutes: 15,
    });
    expect(mockQueue.add).toHaveBeenLastCalledWith(
      NOTIFICATION_JOBS.PASSWORD_RESET_OTP,
      expect.objectContaining({ otpCode: '654321' }),
    );

    await service.sendWelcome({
      to: 'user@test.local',
      fullName: 'Ana',
      storeName: 'Moda',
      loginUrl: 'http://moda.localhost:3000/login',
    });
    expect(mockQueue.add).toHaveBeenLastCalledWith(
      NOTIFICATION_JOBS.WELCOME,
      expect.objectContaining({ loginUrl: 'http://moda.localhost:3000/login' }),
    );

    await service.sendSubscriptionPaymentApproved({
      to: 'owner@test.local',
      ownerName: 'Carlos',
      storeName: 'Urban Threads',
      planName: 'Crecimiento Pro',
      amount: '49.00',
      currency: 'USD',
      externalReference: 'TRF-001',
    });
    expect(mockQueue.add).toHaveBeenLastCalledWith(
      NOTIFICATION_JOBS.SUBSCRIPTION_PAYMENT_APPROVED,
      expect.objectContaining({ externalReference: 'TRF-001', amount: '49.00' }),
    );
  });

  it('closes the BullMQ queue on onModuleDestroy', async () => {
    await service.onModuleDestroy();
    expect(mockQueue.close).toHaveBeenCalledTimes(1);
  });
});
