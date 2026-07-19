/**
 * SiteLink back end — pluggable EmailService (payslip-share, Servio).
 *
 * SMTP via nodemailer. UNIVERSAL: the operator points SMTP_* at any provider
 * (Gmail app-password, SendGrid, Mailgun, SES, Postmark, …) — no vendor lock-in.
 *
 * KEY-GATED like CloudConvert: the feature is CONFIGURED only when SMTP_HOST +
 * SMTP_USER + SMTP_PASS + EMAIL_FROM are all present. When not configured,
 * sendWithAttachment() throws a clean 503 AppError so the endpoint returns an
 * actionable error instead of half-attempting a send.
 *
 * SECURITY RULE: SMTP_USER / SMTP_PASS live ONLY here (read from config),
 * server-side. They are NEVER logged, echoed, or placed in any AppError
 * message/details returned to a client. Only the recipient address is ever
 * surfaced. nodemailer is LAZY-IMPORTED so a missing dep can't break tsc/build
 * for the (env-gated-off) common path — mirrors the CloudConvert lazy pattern.
 */
import type { AppConfig } from '../config.js';
import { AppError } from './errors.js';

/** A single file attachment (the payslip PDF bytes). */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendWithAttachmentInput {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachment: EmailAttachment;
}

export const EMAIL_NOT_CONFIGURED_MESSAGE = 'Email sending is not configured';

/**
 * Distinct error for the KEY-GATED-off case. The route maps this to a clean HTTP
 * 503 (Service Unavailable) — the shared AppError enum has no 503 code, so we use
 * a dedicated tagged error the route recognises rather than widening errors.ts.
 */
export class EmailNotConfiguredError extends Error {
  readonly statusCode = 503;
  constructor(message: string = EMAIL_NOT_CONFIGURED_MESSAGE) {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

/**
 * Minimal structural type for the slice of nodemailer we use. Declared locally so
 * this module type-checks even before `nodemailer` is installed (lazy import).
 */
interface NodemailerLike {
  createTransport(opts: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }): { sendMail(mail: unknown): Promise<{ messageId?: string }> };
}

export class EmailService {
  constructor(private readonly config: AppConfig) {}

  /**
   * True only when EVERY required SMTP setting is present. The endpoint checks
   * this to decide 503 vs. attempt; tests stub it to exercise the send path.
   */
  isConfigured(): boolean {
    const c = this.config;
    return Boolean(c.SMTP_HOST && c.SMTP_USER && c.SMTP_PASS && c.EMAIL_FROM);
  }

  /**
   * Send an email with a single attachment. Throws 503 if not configured, and a
   * generic 500 on provider failure (real cause logged server-side, redacted).
   * The recipient is the ONLY caller-influenced value ever accepted here.
   */
  async sendWithAttachment(input: SendWithAttachmentInput): Promise<{ sent: true }> {
    if (!this.isConfigured()) {
      throw new EmailNotConfiguredError();
    }
    // Lazy import: keep nodemailer out of the module graph until an actual send is
    // requested (feature is off by default). Cast through the local shape so tsc
    // does not require @types/nodemailer to be installed.
    const mod = (await import('nodemailer')) as unknown as {
      default?: NodemailerLike;
    } & NodemailerLike;
    const nodemailer: NodemailerLike = mod.default ?? mod;

    const c = this.config;
    const transporter = nodemailer.createTransport({
      host: c.SMTP_HOST!,
      port: c.SMTP_PORT,
      secure: c.SMTP_PORT === 465, // implicit TLS on 465; STARTTLS otherwise
      auth: { user: c.SMTP_USER!, pass: c.SMTP_PASS! },
    });

    try {
      await transporter.sendMail({
        from: c.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: [
          {
            filename: input.attachment.filename,
            content: input.attachment.content,
            contentType: input.attachment.contentType,
          },
        ],
      });
    } catch (err) {
      // Never surface provider internals (which may echo credentials). Log a
      // redacted server-side line and return a generic error to the client.
      logRedacted(c, err);
      throw AppError.internal('Failed to send email');
    }
    return { sent: true };
  }
}

/** Redacted server log — scrub SMTP_PASS from any provider error text. */
function logRedacted(config: AppConfig, err: unknown): void {
  const text = err instanceof Error ? err.message : String(err);
  const pass = config.SMTP_PASS;
  const scrubbed = pass ? text.split(pass).join('***') : text;
  console.error(`[email] send failed: ${scrubbed}`);
}
