/**
 * SiteLink back end — CloudConvert HTML→PDF client (reports rendering).
 *
 * A THIN fetch client (no SDK dependency) around CloudConvert's Jobs API. Given a
 * self-contained HTML string it creates a job with three chained tasks —
 *   import/raw (inline HTML)  →  convert (html→pdf)  →  export/url
 * — polls the job to completion, downloads the produced PDF, and returns a Buffer.
 *
 * SECURITY RULE: the CLOUDCONVERT_API_KEY lives ONLY here (read from config),
 * server-side. It is sent as a Bearer token to CloudConvert and is NEVER logged,
 * echoed, or placed in any AppError message/details returned to a client. All
 * provider failures map to a GENERIC AppError; the real cause is logged server-side
 * with the key redacted.
 *
 * Docs: https://cloudconvert.com/api/v2 (Jobs, tasks: import/raw, convert,
 * export/url).
 */
import { AppError } from './errors.js';

const CLOUDCONVERT_BASE = 'https://api.cloudconvert.com/v2';

/** Poll cadence + ceiling for job completion (bounded — never spins forever). */
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 60_000;

interface CloudConvertTask {
  name?: string;
  status?: string;
  result?: { files?: Array<{ url?: string; filename?: string }> };
  message?: string;
}

interface CloudConvertJob {
  id: string;
  status: string; // 'waiting' | 'processing' | 'finished' | 'error'
  tasks?: CloudConvertTask[];
}

export interface HtmlToPdfOptions {
  /** Page size passed to CloudConvert's html→pdf engine. Defaults to A4. */
  pageSize?: 'A4' | 'Letter';
  /** Basename (no extension) of the generated file. Defaults to 'report'. */
  filename?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * CloudConvert HTML→PDF renderer. Constructed with the API key (already known to
 * be present — callers gate on config before instantiating). Stateless between
 * calls; safe to reuse a single instance.
 */
export class CloudConvertService {
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Convert a self-contained HTML string to a PDF and return the bytes.
   *
   * Never throws with provider internals — any failure becomes a generic
   * AppError.internal('Failed to render report') after a redacted server log.
   */
  async htmlToPdf(html: string, options: HtmlToPdfOptions = {}): Promise<Buffer> {
    const filename = options.filename ?? 'report';
    try {
      const job = await this.createJob(html, options);
      const finished = await this.waitForJob(job.id);
      const url = this.exportUrl(finished);
      return await this.download(url);
    } catch (err) {
      // Re-surface our own generic AppErrors untouched; wrap everything else.
      if (err instanceof AppError) throw err;
      this.logRedacted(`htmlToPdf(${filename}) failed`, err);
      throw AppError.internal('Failed to render report');
    }
  }

  /** POST /jobs with the import/raw → convert → export/url task chain. */
  private async createJob(html: string, options: HtmlToPdfOptions): Promise<CloudConvertJob> {
    const body = {
      tasks: {
        'import-html': {
          operation: 'import/raw',
          file: html,
          filename: 'report.html',
        },
        'convert-pdf': {
          operation: 'convert',
          input: 'import-html',
          input_format: 'html',
          output_format: 'pdf',
          engine: 'chrome',
          page_size: options.pageSize ?? 'A4',
          print_background: true,
        },
        'export-pdf': {
          operation: 'export/url',
          input: 'convert-pdf',
          inline: false,
          archive_multiple_files: false,
        },
      },
    };
    const res = await fetch(`${CLOUDCONVERT_BASE}/jobs`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      await this.failFromResponse('create job', res);
    }
    const json = (await res.json()) as { data: CloudConvertJob };
    return json.data;
  }

  /** GET /jobs/:id until finished/error or the poll ceiling is hit. */
  private async waitForJob(jobId: string): Promise<CloudConvertJob> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      const res = await fetch(`${CLOUDCONVERT_BASE}/jobs/${jobId}`, {
        headers: this.headers(),
      });
      if (!res.ok) {
        await this.failFromResponse('poll job', res);
      }
      const json = (await res.json()) as { data: CloudConvertJob };
      const job = json.data;
      if (job.status === 'finished') return job;
      if (job.status === 'error') {
        const failed = job.tasks?.find((t) => t.status === 'error');
        this.logRedacted('job entered error state', failed?.message ?? 'unknown task error');
        throw AppError.internal('Failed to render report');
      }
      if (Date.now() > deadline) {
        this.logRedacted('job timed out', `jobId=${jobId} exceeded ${POLL_TIMEOUT_MS}ms`);
        throw AppError.internal('Failed to render report');
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  /** Pull the export/url task's result file URL from a finished job. */
  private exportUrl(job: CloudConvertJob): string {
    const exportTask = job.tasks?.find((t) => t.name === 'export-pdf');
    const url = exportTask?.result?.files?.[0]?.url;
    if (!url) {
      this.logRedacted('no export URL on finished job', `jobId=${job.id}`);
      throw AppError.internal('Failed to render report');
    }
    return url;
  }

  /** Download the produced PDF bytes (export/url URLs are unauthenticated). */
  private async download(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) {
      this.logRedacted('download failed', `status=${res.status}`);
      throw AppError.internal('Failed to render report');
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /** Log a provider HTTP failure (redacted) and throw a generic AppError. */
  private async failFromResponse(stage: string, res: Response): Promise<never> {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      /* ignore body read errors */
    }
    this.logRedacted(`${stage} HTTP ${res.status}`, detail);
    throw AppError.internal('Failed to render report');
  }

  /**
   * Server-side log with the API key scrubbed from any message. The key is never
   * placed in the message argument, but we defensively redact in case a provider
   * echoes an Authorization header back in an error body.
   */
  private logRedacted(context: string, detail: unknown): void {
    const text = typeof detail === 'string' ? detail : String(detail);
    const scrubbed = this.apiKey ? text.split(this.apiKey).join('***') : text;
    console.error(`[cloudconvert] ${context}: ${scrubbed}`);
  }
}
