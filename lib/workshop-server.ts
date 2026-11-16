import { env } from 'cloudflare:workers';

export function db() {
  if (!env.DB) throw new Error('Workshop database is unavailable.');
  return env.DB;
}

export async function setting(key: string) {
  return db().prepare('SELECT value FROM workshop_settings WHERE key = ?').bind(key).first<string>('value');
}

export async function saveSetting(key: string, value: string) {
  await db().prepare('INSERT INTO workshop_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value).run();
}

export async function digest(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function equalDigest(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
