import { siteOwner } from '../../../lib/employee-access';
import { defaultCatalogue, summarize } from '../../../lib/workshop.mjs';
import { db, digest, equalDigest, saveSetting, setting } from '../../../lib/workshop-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!await siteOwner(request)) return Response.json({ error: 'Sign in to view the workshop.' }, { status: 401 });
  const days = Number(new URL(request.url).searchParams.get('days')) || 0;
  try {
    const [result, catalogue, webhook] = await Promise.all([
      db().prepare('SELECT payload FROM workshop_events ORDER BY occurred_at, received_at, event_id').all<{payload:string}>(),
      setting('catalogue'),
      setting('webhook_hash'),
    ]);
    return Response.json({ ...summarize(result.results.map(row => JSON.parse(row.payload)), [7,30,90].includes(days) ? days : 0),
      catalogue: catalogue ? JSON.parse(catalogue) : defaultCatalogue, starterPrices: !catalogue, webhookConfigured: Boolean(webhook) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Workshop dashboard load failed', error);
    return Response.json({ error: 'The workshop database could not be loaded.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!await siteOwner(request)) return Response.json({ error: 'Sign in to manage the workshop.' }, { status: 401 });
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Open this page to make workshop changes.' }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid request.' }, { status: 400 });
  const { action, catalogue, key } = body as { action: string; catalogue: typeof defaultCatalogue; key: string };
  if (action === 'configuration') {
    const hash = await setting('webhook_hash');
    if (typeof key !== 'string' || key.length > 128 || !hash || !equalDigest(await digest(key), hash)) {
      return Response.json({ error: 'Enter and save your current workshop key before downloading the configuration.' }, { status: 403 });
    }
    const origin = new URL(request.url).origin;
    return Response.json({ configuration: [
      `set paradise_webhook_url "${origin}/api/webhook"`,
      `set paradise_workshop_key "${key}"`,
      'ensure paradise_customs_webhook',
    ].join('\n') }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (action === 'key') {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_\-]{24,128}$/.test(key)) return Response.json({ error: 'Use at least 24 letters, numbers, underscores or hyphens.' }, { status: 400 });
    await saveSetting('webhook_hash', await digest(key));
    return Response.json({ saved: true });
  }
  if (action === 'catalogue') {
    if (!Array.isArray(catalogue) || catalogue.length > 150 || !catalogue.every(item => item
      && [item.id, item.name, item.category, item.description].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160)
      && Number.isSafeInteger(item.price) && item.price >= 0 && item.price <= 100000000000)
      || new Set(catalogue.map(item => item.id)).size !== catalogue.length) return Response.json({ error: 'Check all catalogue names, descriptions, and prices.' }, { status: 400 });
    await saveSetting('catalogue', JSON.stringify(catalogue.map(({id,name,category,description,price}) => ({id,name,category,description,price}))));
    return Response.json({ saved: true });
  }
  return Response.json({ error: 'Unknown action.' }, { status: 400 });
}
