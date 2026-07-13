/**
 * One-off: link an app User row to its real Supabase Auth identity by email.
 * Fixes the seed placeholder authUserId so real logins resolve (auth.ts findUnique by sub).
 * Usage: tsx scripts/link-auth-user.ts <email>
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../src/db/client.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: tsx scripts/link-auth-user.ts <email>');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserIdByEmail(target: string): Promise<string | null> {
  // listUsers is paginated; scan up to a few pages.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  const authUserId = await findAuthUserIdByEmail(email);
  if (!authUserId) {
    console.error(`No Supabase Auth user found for ${email}. Create it in the dashboard first.`);
    process.exit(2);
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    console.error(`No app User row for ${email}. (Seed creates admin@/manager@sitelink.example.)`);
    process.exit(3);
  }
  const updated = await prisma.user.update({
    where: { email },
    data: { authUserId, isLockedOut: false },
    select: { email: true, role: true, authUserId: true, isLockedOut: true },
  });
  console.log('Linked:', JSON.stringify(updated));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('FAILED:', e?.message ?? e);
    await prisma.$disconnect();
    process.exit(1);
  });
