import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { EnvConfig } from '../../config/env.validation';
import { NOTIFICATIONS_QUEUE, NOTIFICATION_JOBS } from './notifications.constants';
import {
  OtpVerificationJobData,
  PasswordResetOtpJobData,
  SubscriptionPaymentApprovedJobData,
  WelcomeJobData,
} from './notifications.types';

interface RenderedEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHttpUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function wrapEmailHtml(brandName: string, title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="font-family: Arial, Helvetica, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 600px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px;">
            <tr>
              <td>
                <p style="margin: 0 0 12px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #2563eb;">
                  ${escapeHtml(brandName)}
                </p>
                <h1 style="margin: 0 0 16px; font-size: 22px; color: #0f172a;">
                  ${escapeHtml(title)}
                </h1>
                ${bodyHtml}
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px;" />
                <p style="margin: 0; font-size: 12px; color: #64748b;">
                  Este correo fue enviado automáticamente por ${escapeHtml(brandName)}. Si no solicitaste esta acción, puedes ignorar este mensaje.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private readonly transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo>;
  private readonly fromAddress: string;
  private readonly platformName: string;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    super();

    const host = this.config.get('SMTP_HOST', { infer: true });
    const port = this.config.get('SMTP_PORT', { infer: true });
    const secure = this.config.get('SMTP_SECURE', { infer: true });
    const user = this.config.get('SMTP_USER', { infer: true }).trim();
    const pass = this.config.get('SMTP_PASS', { infer: true }).trim();

    const mailFromName = this.config.get('MAIL_FROM_NAME', { infer: true });
    const mailFromAddress = this.config.get('MAIL_FROM_ADDRESS', { infer: true });
    this.platformName = this.config.get('PLATFORM_NAME', { infer: true });
    this.fromAddress = `"${mailFromName}" <${mailFromAddress}>`;

    const transportOptions: SMTPTransport.Options = {
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    };

    this.transporter = nodemailer.createTransport(transportOptions);
  }

  async process(job: Job<unknown, void, string>): Promise<void> {
    const email = this.renderEmail(job.name, job.data);

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    this.logger.log(`Correo [${job.name}] enviado a ${email.to}`);
  }

  private renderEmail(jobName: string, data: unknown): RenderedEmail {
    switch (jobName) {
      case NOTIFICATION_JOBS.OTP_VERIFICATION:
        return this.renderOtpVerification(data as OtpVerificationJobData);
      case NOTIFICATION_JOBS.PASSWORD_RESET_OTP:
        return this.renderPasswordResetOtp(data as PasswordResetOtpJobData);
      case NOTIFICATION_JOBS.WELCOME:
        return this.renderWelcome(data as WelcomeJobData);
      case NOTIFICATION_JOBS.SUBSCRIPTION_PAYMENT_APPROVED:
        return this.renderSubscriptionPaymentApproved(data as SubscriptionPaymentApprovedJobData);
      default:
        throw new Error(`Tipo de notificación desconocido: ${jobName}`);
    }
  }

  private renderOtpVerification(payload: OtpVerificationJobData): RenderedEmail {
    const brandName = payload.storeName?.trim() || this.platformName;
    const subject = `Código de verificación (${brandName}): ${payload.otpCode}`;
    const text = [
      `Hola ${payload.fullName},`,
      '',
      `Tu código de verificación para ${brandName} es: ${payload.otpCode}`,
      `Este código expira en ${payload.expiresInMinutes} minutos.`,
    ].join('\n');

    const bodyHtml = `
      <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.5;">
        Hola <strong>${escapeHtml(payload.fullName)}</strong>,
      </p>
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
        Usa el siguiente código OTP para verificar tu correo en <strong>${escapeHtml(brandName)}</strong>:
      </p>
      <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; text-align: center; font-size: 28px; font-weight: 700; letter-spacing: 0.25em; color: #0f172a; margin: 16px 0;">
        ${escapeHtml(payload.otpCode)}
      </div>
      <p style="margin: 0; font-size: 14px; color: #475569;">
        Este código expira en <strong>${escapeHtml(payload.expiresInMinutes)} minutos</strong>.
      </p>
    `;

    return {
      to: payload.to,
      subject,
      text,
      html: wrapEmailHtml(brandName, 'Verifica tu correo electrónico', bodyHtml),
    };
  }

  private renderPasswordResetOtp(payload: PasswordResetOtpJobData): RenderedEmail {
    const brandName = payload.storeName?.trim() || this.platformName;
    const subject = `Restablece tu contraseña en ${brandName}`;
    const text = [
      `Hola ${payload.fullName},`,
      '',
      `Recibimos una solicitud para restablecer tu contraseña en ${brandName}.`,
      `Tu código de recuperación es: ${payload.otpCode}`,
      `Este código expira en ${payload.expiresInMinutes} minutos.`,
    ].join('\n');

    const bodyHtml = `
      <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.5;">
        Hola <strong>${escapeHtml(payload.fullName)}</strong>,
      </p>
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
        Recibimos una solicitud para restablecer tu contraseña en <strong>${escapeHtml(brandName)}</strong>. Ingresa el siguiente código OTP:
      </p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; text-align: center; font-size: 28px; font-weight: 700; letter-spacing: 0.25em; color: #991b1b; margin: 16px 0;">
        ${escapeHtml(payload.otpCode)}
      </div>
      <p style="margin: 0; font-size: 14px; color: #475569;">
        Este código expira en <strong>${escapeHtml(payload.expiresInMinutes)} minutos</strong>.
      </p>
    `;

    return {
      to: payload.to,
      subject,
      text,
      html: wrapEmailHtml(brandName, 'Restablecimiento de contraseña', bodyHtml),
    };
  }

  private renderWelcome(payload: WelcomeJobData): RenderedEmail {
    const brandName = payload.storeName?.trim() || this.platformName;
    const subject = `¡Bienvenido a ${brandName}!`;
    const safeLoginUrl = sanitizeHttpUrl(payload.loginUrl);
    const loginLine = safeLoginUrl ? `Ingresa aquí: ${safeLoginUrl}` : '';
    const text = [
      `¡Hola ${payload.fullName}!`,
      '',
      `Tu cuenta en ${brandName} ya está verificada y lista para usar.`,
      loginLine,
    ]
      .filter(Boolean)
      .join('\n');

    const ctaHtml = safeLoginUrl
      ? `<p style="margin: 20px 0 0;">
          <a href="${escapeHtml(safeLoginUrl)}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; padding: 12px 20px; border-radius: 8px;">
            Ir a mi cuenta
          </a>
        </p>`
      : '';

    const bodyHtml = `
      <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.5;">
        ¡Hola <strong>${escapeHtml(payload.fullName)}</strong>!
      </p>
      <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.5;">
        Te damos la bienvenida a <strong>${escapeHtml(brandName)}</strong>. Tu cuenta ha sido activada exitosamente.
      </p>
      ${ctaHtml}
    `;

    return {
      to: payload.to,
      subject,
      text,
      html: wrapEmailHtml(brandName, `Bienvenido a ${brandName}`, bodyHtml),
    };
  }

  private renderSubscriptionPaymentApproved(
    payload: SubscriptionPaymentApprovedJobData,
  ): RenderedEmail {
    const subject = `Pago de suscripción aprobado — ${payload.storeName}`;
    const referenceText = payload.externalReference
      ? `Referencia: ${payload.externalReference}`
      : '';
    const text = [
      `Hola ${payload.ownerName},`,
      '',
      `Tu pago de suscripción para la tienda ${payload.storeName} (${payload.planName}) fue aprobado.`,
      `Monto: ${payload.amount} ${payload.currency}`,
      referenceText,
    ]
      .filter(Boolean)
      .join('\n');

    const referenceHtml = payload.externalReference
      ? `<li><strong>Referencia:</strong> ${escapeHtml(payload.externalReference)}</li>`
      : '';

    const bodyHtml = `
      <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.5;">
        Hola <strong>${escapeHtml(payload.ownerName)}</strong>,
      </p>
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
        Confirmamos que el pago de suscripción para tu tienda <strong>${escapeHtml(payload.storeName)}</strong> ha sido aprobado.
      </p>
      <ul style="margin: 0 0 16px; padding-left: 20px; font-size: 14px; line-height: 1.7; color: #334155;">
        <li><strong>Plan:</strong> ${escapeHtml(payload.planName)}</li>
        <li><strong>Monto:</strong> ${escapeHtml(payload.amount)} ${escapeHtml(payload.currency)}</li>
        ${referenceHtml}
      </ul>
    `;

    return {
      to: payload.to,
      subject,
      text,
      html: wrapEmailHtml(this.platformName, 'Suscripción activada', bodyHtml),
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.transporter.close();
    try {
      await this.worker.close();
    } catch {
      // Worker no inicializado cuando se crea el contexto sin app.init() (ej. export-openapi)
    }
  }
}
