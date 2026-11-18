import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { EnvConfig } from '../../config/env.validation';
import { NOTIFICATION_JOBS } from './notifications.constants';
import { NotificationsProcessor } from './notifications.processor';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('NotificationsProcessor', () => {
  let sendMailMock: jest.Mock;
  let closeMock: jest.Mock;
  let createConfig: (
    overrides?: Partial<Record<keyof EnvConfig, unknown>>,
  ) => ConfigService<EnvConfig, true>;

  beforeEach(() => {
    sendMailMock = jest.fn().mockResolvedValue({ messageId: 'msg-1' });
    closeMock = jest.fn();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: sendMailMock,
      close: closeMock,
    });

    createConfig = (overrides = {}) =>
      ({
        get: jest.fn((key: keyof EnvConfig) => {
          const defaults: Record<string, unknown> = {
            SMTP_HOST: 'localhost',
            SMTP_PORT: 1025,
            SMTP_SECURE: false,
            SMTP_USER: '',
            SMTP_PASS: '',
            MAIL_FROM_NAME: 'Vendexa E-Commerce',
            MAIL_FROM_ADDRESS: 'no-reply@vendexa.local',
            PLATFORM_NAME: 'Vendexa SaaS',
            ...overrides,
          };
          return defaults[key];
        }),
      }) as unknown as ConfigService<EnvConfig, true>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('omits SMTP auth when SMTP_USER/SMTP_PASS are empty and includes auth when provided', () => {
    new NotificationsProcessor(createConfig());
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
    });

    new NotificationsProcessor(createConfig({ SMTP_USER: 'smtp-user', SMTP_PASS: 'smtp-pass' }));
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
      auth: { user: 'smtp-user', pass: 'smtp-pass' },
    });
  });

  it('renders and sends all 4 email templates with HTML escaping', async () => {
    const processor = new NotificationsProcessor(createConfig());

    await processor.process({
      name: NOTIFICATION_JOBS.OTP_VERIFICATION,
      data: {
        to: 'a@test.local',
        fullName: 'Ana <Admin>',
        otpCode: '482910',
        expiresInMinutes: 10,
        storeName: 'Urban Threads',
      },
    } as Job);

    expect(sendMailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: '"Vendexa E-Commerce" <no-reply@vendexa.local>',
        to: 'a@test.local',
        subject: expect.stringContaining('482910'),
        text: expect.stringContaining('482910'),
        html: expect.stringContaining('Ana &lt;Admin&gt;'),
      }),
    );

    await processor.process({
      name: NOTIFICATION_JOBS.PASSWORD_RESET_OTP,
      data: {
        to: 'b@test.local',
        fullName: 'Luis',
        otpCode: '917352',
        expiresInMinutes: 15,
      },
    } as Job);
    expect(sendMailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: 'b@test.local',
        html: expect.stringContaining('917352'),
      }),
    );

    await processor.process({
      name: NOTIFICATION_JOBS.WELCOME,
      data: {
        to: 'c@test.local',
        fullName: 'Carla',
        storeName: 'Moda',
        loginUrl: 'http://moda.localhost:3000/login',
      },
    } as Job);
    expect(sendMailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: 'c@test.local',
        html: expect.stringContaining('http://moda.localhost:3000/login'),
      }),
    );

    await processor.process({
      name: NOTIFICATION_JOBS.SUBSCRIPTION_PAYMENT_APPROVED,
      data: {
        to: 'd@test.local',
        ownerName: 'Carlos',
        storeName: 'Urban Threads',
        planName: 'Crecimiento Pro',
        amount: '49.00',
        currency: 'USD',
        externalReference: 'TRF-99',
      },
    } as Job);
    expect(sendMailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: 'd@test.local',
        html: expect.stringContaining('TRF-99'),
      }),
    );
  });

  it('throws on unknown job names and closes safely on onModuleDestroy even if worker is uninitialized', async () => {
    const processor = new NotificationsProcessor(createConfig());

    await expect(processor.process({ name: 'unknown-job', data: {} } as Job)).rejects.toThrow(
      'Tipo de notificación desconocido: unknown-job',
    );

    await expect(processor.onModuleDestroy()).resolves.toBeUndefined();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('omits CTA link in welcome email when loginUrl does not use http: or https:', async () => {
    const processor = new NotificationsProcessor(createConfig());

    for (const unsafeUrl of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'not-a-valid-url',
    ]) {
      await processor.process({
        name: NOTIFICATION_JOBS.WELCOME,
        data: {
          to: 'xss@test.local',
          fullName: 'Carla',
          storeName: 'Moda',
          loginUrl: unsafeUrl,
        },
      } as Job);

      const sent = sendMailMock.mock.calls.at(-1)?.[0] as { html: string; text: string };
      expect(sent.html).not.toContain('<a ');
      expect(sent.html).not.toContain('javascript:');
      expect(sent.text).not.toContain(unsafeUrl);
    }
  });
});
