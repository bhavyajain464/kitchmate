#!/usr/bin/env node
/**
 * Upload dish WebP variants to Cloudflare R2 (S3-compatible API).
 *
 * Local layout (assets/dishes/) mirrors R2 object keys:
 *   dal-tadka.webp
 *   card/dal-tadka.webp
 *   thumb/dal-tadka.webp
 *
 * Setup: copy r2.env.example → r2.env, fill credentials, enable public access on the bucket.
 *
 * Usage:
 *   npm run sync:dishes:r2
 *   npm run sync:dishes:r2 -- --dry-run
 *   npm run sync:dishes:r2 -- --id dal-tadka
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DISHES = path.join(ROOT, 'assets/dishes');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const idFlag = args.indexOf('--id');
const onlyId = idFlag >= 0 ? args[idFlag + 1] : null;

function loadEnvSync() {
  const envPath = path.join(ROOT, 'r2.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Copy r2.env.example → r2.env and fill Cloudflare R2 credentials.`);
    process.exit(1);
  }
  return v;
}

function collectUploads() {
  const uploads = [];

  const addFile = (absPath, key) => {
    if (onlyId && !key.includes(`/${onlyId}.webp`) && !key.startsWith(`${onlyId}.webp`)) return;
    uploads.push({ absPath, key });
  };

  for (const name of fs.readdirSync(DISHES)) {
    if (name === 'masters' || name === 'card' || name === 'thumb') continue;
    if (!name.endsWith('.webp')) continue;
    addFile(path.join(DISHES, name), name);
  }

  for (const sub of ['card', 'thumb']) {
    const dir = path.join(DISHES, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.webp')) continue;
      addFile(path.join(dir, name), `${sub}/${name}`);
    }
  }

  return uploads;
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadOne(client, bucket, { absPath, key }, skipExisting) {
  if (skipExisting && (await objectExists(client, bucket, key))) {
    return 'skipped';
  }
  const body = fs.readFileSync(absPath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return 'uploaded';
}

async function main() {
  loadEnvSync();

  const accountId = requireEnv('R2_ACCOUNT_ID');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
  const bucket = requireEnv('R2_BUCKET');
  const publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, '') || '';

  const uploads = collectUploads();
  if (uploads.length === 0) {
    console.error('No .webp files under assets/dishes. Run: npm run optimize:dishes');
    process.exit(1);
  }

  console.log(`R2 bucket: ${bucket} (${uploads.length} objects${onlyId ? `, filter id=${onlyId}` : ''})`);
  if (dryRun) {
    uploads.slice(0, 5).forEach((u) => console.log(`  would upload: ${u.key}`));
    if (uploads.length > 5) console.log(`  ... and ${uploads.length - 5} more`);
    if (publicUrl) {
      console.log(`\nSet backend DISH_IMAGES_CDN_URL=${publicUrl}`);
    }
    return;
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const skipExisting = !args.includes('--force');
  let uploaded = 0;
  let skipped = 0;
  const concurrency = 12;
  for (let i = 0; i < uploads.length; i += concurrency) {
    const batch = uploads.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((item) => uploadOne(client, bucket, item, skipExisting)),
    );
    for (const r of results) {
      if (r === 'uploaded') uploaded += 1;
      else skipped += 1;
    }
    process.stdout.write(`\r  ${Math.min(i + concurrency, uploads.length)}/${uploads.length}`);
  }
  console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped (already present)`);

  if (publicUrl) {
    console.log(`\nAdd to backend/.env:`);
    console.log(`  DISH_IMAGES_CDN_URL=${publicUrl}`);
    console.log(`\nOptional frontend build-time fallback:`);
    console.log(`  EXPO_PUBLIC_DISH_IMAGES_CDN_URL=${publicUrl}`);
    console.log(`\nExample URL: ${publicUrl}/card/paneer-tikka.webp`);
  } else {
    console.log('\nSet R2_PUBLIC_URL in r2.env to print DISH_IMAGES_CDN_URL after upload.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
