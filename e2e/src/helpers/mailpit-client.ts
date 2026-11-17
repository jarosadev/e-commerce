import { ENDPOINTS } from '../config/env';

export interface MailpitAddress {
  Name: string;
  Address: string;
}

export interface MailpitMessageSummary {
  ID: string;
  MessageID: string;
  Created: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Cc?: MailpitAddress[];
  Bcc?: MailpitAddress[];
  Subject: string;
  Snippet: string;
  Read: boolean;
}

export interface MailpitMessagesResponse {
  total: number;
  unread: number;
  count: number;
  messages: MailpitMessageSummary[];
}

export interface MailpitMessageDetail {
  ID: string;
  MessageID: string;
  Date: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
  Text: string;
  HTML: string;
}

export interface WaitForEmailOptions {
  to: string;
  subjectIncludes?: string;
  afterMs?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export class MailpitClient {
  private readonly apiBaseUrl: string;

  constructor(apiBaseUrl: string = ENDPOINTS.mailpitApiUrl) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
  }

  async listMessages(limit = 50, start = 0): Promise<MailpitMessagesResponse> {
    const res = await fetch(`${this.apiBaseUrl}/messages?limit=${limit}&start=${start}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Mailpit GET /messages failed with status ${res.status}`);
    }
    return (await res.json()) as MailpitMessagesResponse;
  }

  async getMessage(id: string): Promise<MailpitMessageDetail> {
    const res = await fetch(`${this.apiBaseUrl}/message/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Mailpit GET /message/${id} failed with status ${res.status}`);
    }
    return (await res.json()) as MailpitMessageDetail;
  }

  async waitForEmail(options: WaitForEmailOptions): Promise<MailpitMessageDetail> {
    const targetEmail = options.to.trim().toLowerCase();
    const subjectNeedle = options.subjectIncludes?.trim().toLowerCase();
    const minTimestamp = options.afterMs !== undefined ? options.afterMs - 2_000 : undefined;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const pollIntervalMs = options.pollIntervalMs ?? 300;
    const deadline = Date.now() + timeoutMs;

    let lastSeenCount = 0;

    while (Date.now() < deadline) {
      const list = await this.listMessages(50, 0);
      lastSeenCount = list.messages.length;

      const match = list.messages.find((msg) => {
        const recipients = msg.To ?? [];
        const recipientMatch = recipients.some(
          (addr) => addr.Address?.trim().toLowerCase() === targetEmail,
        );
        if (!recipientMatch) {
          return false;
        }
        if (subjectNeedle && !(msg.Subject ?? '').toLowerCase().includes(subjectNeedle)) {
          return false;
        }
        if (minTimestamp !== undefined) {
          const createdMs = Date.parse(msg.Created);
          if (!Number.isNaN(createdMs) && createdMs < minTimestamp) {
            return false;
          }
        }
        return true;
      });

      if (match) {
        return this.getMessage(match.ID);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for email to "${options.to}"` +
        (subjectNeedle ? ` (subject containing "${options.subjectIncludes}")` : '') +
        `. Checked ${lastSeenCount} recent messages in Mailpit.`,
    );
  }

  extractOtpCode(message: Pick<MailpitMessageDetail, 'Text' | 'HTML'>): string {
    const sources = [message.Text ?? '', stripHtml(message.HTML ?? '')];
    for (const source of sources) {
      const match = source.match(/\b(\d{6})\b/);
      if (match?.[1]) {
        return match[1];
      }
    }
    throw new Error(
      `Could not extract 6-digit OTP code from email content. Text="${message.Text?.slice(0, 160)}"`,
    );
  }

  extractResetTokenOrOtp(message: Pick<MailpitMessageDetail, 'Text' | 'HTML'>): string {
    const sources = [message.Text ?? '', message.HTML ?? '', stripHtml(message.HTML ?? '')];
    for (const source of sources) {
      const queryMatch = source.match(/[?&](?:token|otp|code)=([A-Za-z0-9._-]{6,})/i);
      if (queryMatch?.[1]) {
        return queryMatch[1];
      }
    }
    return this.extractOtpCode(message);
  }
}
