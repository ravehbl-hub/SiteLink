/**
 * Native PDF fetch + open/share (FR-WRK-1 export, FR-WRK-2 payslip).
 *
 * The reports routes stream `application/pdf` behind the bearer token, so we can
 * not simply hand a URL to a viewer — we must download with the Authorization
 * header first. We use expo-file-system's authenticated download to write the PDF
 * to the cache dir, then hand it to the OS share/open sheet via expo-sharing.
 *
 * All report routes are self-scoped server-side (no workerId is sent).
 */
// SDK 54's `expo-file-system` root exports the new File/Directory API; the
// authenticated `downloadAsync` + `cacheDirectory` helpers used here live in the
// `/legacy` entry point (same pattern as the Manager app's uploadToSignedUrl).
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ApiError, buildUrl, getAccessToken } from './api';
import type { ReportLang, WorkingHoursGrainParam } from './endpoints';

async function downloadAndShare(url: string, filename: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new ApiError(401, 'NO_SESSION', 'No active session for PDF download.');

  const target = `${FileSystem.cacheDirectory ?? ''}${filename}`;
  const res = await FileSystem.downloadAsync(url, target, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
  });

  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(res.status, 'PDF_FAILED', `PDF export failed (${res.status}).`);
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(res.uri, {
      mimeType: 'application/pdf',
      dialogTitle: filename,
      UTI: 'com.adobe.pdf',
    });
  }
}

/** Working-hours PDF (self-scoped): from,to,grain(day|week|month),lang. */
export async function exportWorkingHoursPdf(params: {
  from: string;
  to: string;
  grain: WorkingHoursGrainParam;
  lang: ReportLang;
}): Promise<void> {
  const url = buildUrl('/reports/working-hours.pdf', params);
  await downloadAndShare(url, 'working-hours.pdf');
}

/** Payslip PDF (self-scoped): from,to,lang. */
export async function exportPayslipPdf(params: {
  from: string;
  to: string;
  lang: ReportLang;
}): Promise<void> {
  const url = buildUrl('/reports/payslip.pdf', params);
  await downloadAndShare(url, 'payslip.pdf');
}
