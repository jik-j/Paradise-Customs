import { parseEvent } from '../../../lib/workshop.mjs';
import { db, digest, equalDigest, setting } from '../../../lib/workshop-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const key = request.headers.get('x-workshop-key');
    if (!key || key.length > 128) return Response.json({ error: 'Invalid workshop key.' }, { status: 401 });
    const stored = await setting('webhook_hash');
    if (!stored || !equalDigest(await digest(key), stored)) return Response.json({ error: 'Invalid workshop key.' }, { status: 401 });
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return Response.json({ error: 'Send application/json.' }, { status: 415 });
    const body = await request.text();
    if (body.length > 8192) return Response.json({ error: 'Event is too large.' }, { status: 413 });
    let parsed;
    try {
      parsed = parseEvent(JSON.parse(body));
    } catch (error) {
      return Response.json({ error: error instanceof SyntaxError ? 'Malformed JSON.' : (error as Error).message }, { status: 400 });
    }
    const { event, timestamp, entityId } = parsed;
    const payload = JSON.stringify(event);
    const database = db();
    const result = await database.prepare('INSERT INTO workshop_events (event_id,type,entity_id,occurred_at,received_at,employee_id,payload) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
      .bind(event.eventId, event.type, entityId, timestamp, Date.now(), event.employeeId, payload).run();
    if (result.meta.changes) return Response.json({ accepted: true, eventId: event.eventId }, { status: 201 });

    const byId = await database.prepare('SELECT payload FROM workshop_events WHERE event_id = ?').bind(event.eventId).first<string>('payload');
    if (byId === payload) return Response.json({ accepted: true, duplicate: true, eventId: event.eventId });
    return Response.json({ error: byId ? 'Event ID already used with different data.' : 'This event type is already recorded for the supplied entity ID.' }, { status: 409 });
  } catch (error) {
    console.error('Workshop webhook write failed', error);
    return Response.json({ error: 'Workshop database temporarily unavailable.' }, { status: 503 });
  }
}
