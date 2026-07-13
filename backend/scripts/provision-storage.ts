/**
 * SiteLink back end — Storage bucket provisioner (Savant / DB, Architecture §7a).
 *
 * Creates the two PRIVATE storage buckets the back end mints signed URLs for:
 *   - worker-images  (private, 10MB, image/*)
 *   - worker-docs    (private, 20MB, image/* + application/pdf)
 *
 * Bucket names are read from env (STORAGE_BUCKET_*) with the SAME defaults the
 * app config uses (backend/src/config.ts), so provisioning can never drift from
 * the names the signed-URL code (backend/src/lib/supabase.ts) references.
 *
 * IDEMPOTENT: a bucket that already exists is treated as success. The service-role
 * key is read from env — NEVER hard-coded, never printed.
 *
 * Run: node --import tsx --env-file=.env backend/scripts/provision-storage.ts
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

// Match the back end's config defaults (backend/src/config.ts).
const BUCKET_IMAGES = process.env.STORAGE_BUCKET_WORKER_IMAGES ?? 'worker-images';
const BUCKET_DOCS = process.env.STORAGE_BUCKET_WORKER_DOCS ?? 'worker-docs';

const MB = 1024 * 1024;

interface BucketSpec {
  id: string;
  fileSizeLimit: number;
  allowedMimeTypes: string[];
}

const SPECS: BucketSpec[] = [
  {
    id: BUCKET_IMAGES,
    fileSizeLimit: 10 * MB,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/heic', 'image/webp'],
  },
  {
    id: BUCKET_DOCS,
    fileSizeLimit: 20 * MB,
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/webp',
      'application/pdf',
    ],
  },
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function isDuplicate(err: { message?: string; name?: string } | null): boolean {
  if (!err) return false;
  const m = (err.message ?? '').toLowerCase();
  return m.includes('already exists') || m.includes('duplicate') || m.includes('resource already exists');
}

async function main() {
  const results: Record<string, string> = {};

  for (const spec of SPECS) {
    const { error } = await admin.storage.createBucket(spec.id, {
      public: false, // PRIVATE — clients only get short-lived signed URLs.
      fileSizeLimit: spec.fileSizeLimit,
      allowedMimeTypes: spec.allowedMimeTypes,
    });
    if (error && !isDuplicate(error)) {
      console.error(`FAILED creating bucket "${spec.id}": ${error.message}`);
      process.exit(2);
    }
    results[spec.id] = error ? 'EXISTED' : 'CREATED';
  }

  // Verify: list buckets and confirm both are private.
  const { data: buckets, error: listErr } = await admin.storage.listBuckets();
  if (listErr) {
    console.error(`FAILED listing buckets: ${listErr.message}`);
    process.exit(3);
  }

  const summary = SPECS.map((spec) => {
    const b = buckets?.find((x) => x.name === spec.id || x.id === spec.id);
    return {
      bucket: spec.id,
      status: results[spec.id],
      exists: Boolean(b),
      public: b ? b.public : null,
    };
  });

  console.log(JSON.stringify({ provision: summary }, null, 2));

  const bad = summary.filter((s) => !s.exists || s.public !== false);
  if (bad.length) {
    console.error('POST-CHECK FAILED (missing or not private):', JSON.stringify(bad));
    process.exit(4);
  }
  console.log('OK: both buckets exist and are PRIVATE (public:false).');
}

main().catch((e) => {
  console.error('FAILED:', e?.message ?? e);
  process.exit(1);
});
