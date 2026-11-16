import { env } from 'cloudflare:workers';
import { pbkdf2 } from 'node:crypto';
import { db, digest, equalDigest, setting } from './workshop-server';
import { roster } from './employee-roster';

export type Account = {id:string; name:string; grade:number; password_hash:string|null; credential_version:number;active:number;permissions:number;roster_revision:number};
const encoder=new TextEncoder();
const sessionAge=30*86400;
const cookieName='__Host-paradise_employee';

export async function siteOwner(request:Request) {
  return (await employeeSession(request))?.grade===4;
}

export async function ensureRoster() {
  if (await setting('employee_roster_v1')) return;
  const database=db();
  await database.batch([
    ...roster.map(([id,name,grade])=>database.prepare('INSERT INTO employee_accounts (id,name,grade) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,name,grade)),
    database.prepare("INSERT INTO workshop_settings (key,value) VALUES ('employee_roster_v1','1') ON CONFLICT DO NOTHING"),
  ]);
}

function randomHex(size:number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(size)),b=>b.toString(16).padStart(2,'0')).join('');
}

async function hmac(value:string) {
  const seed=env.EMPLOYEE_AUTH_SEED;
  if (!seed) throw new Error('Employee credential configuration is unavailable.');
  const key=await crypto.subtle.importKey('raw',encoder.encode(seed),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
}

export async function starterPassword(id:string) {
  const material=await hmac('employee-initial-password:v1:'+id);
  return btoa(String.fromCharCode(...material.subarray(0,18))).replaceAll('+','-').replaceAll('/','_');
}

async function derivePassword(password:string,salt:string) {
  const peppered=await hmac('employee-chosen-password:v1:'+password);
  return new Promise<string>((resolve,reject)=>{
    pbkdf2(peppered,salt,600000,32,'sha256',(error,key)=>error?reject(error):resolve(key.toString('hex')));
  });
}

export async function hashPassword(password:string) {
  const salt=randomHex(16);
  return salt+':'+await derivePassword(password,salt);
}

export async function checkPassword(account:Account|null,id:string,password:string) {
  const stored=account?.password_hash;
  if (stored) {
    const [salt,value]=stored.split(':');
    return equalDigest(await derivePassword(password,salt),value);
  }
  return equalDigest(await digest(await starterPassword(id)),await digest(password));
}

export async function consumeLoginAttempt(request:Request,id:string) {
  const database=db();
  const now=Date.now();
  const ip=request.headers.get('cf-connecting-ip')||'unknown';
  const buckets=await Promise.all([digest('account:'+id),digest('ip:'+ip)]);
  const attempts=await database.batch<{attempts:number}>(buckets.map(bucket=>database.prepare(`INSERT INTO employee_login_attempts(bucket,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE MIN(attempts+1,1000) END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`).bind(bucket,now+900000,now,now)));
  return {allowed:Number(attempts[0].results[0]?.attempts)<=8 && Number(attempts[1].results[0]?.attempts)<=60,accountBucket:buckets[0]};
}

export function sessionCookie(token:string,maxAge=sessionAge) {
  return `${cookieName}=${token}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function sessionToken(request:Request) {
  const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  return token&&/^[a-f0-9]{64}$/.test(token)?token:null;
}

export async function employeeSession(request:Request) {
  const token=sessionToken(request);
  if (!token) return null;
  return db().prepare(`SELECT a.* FROM employee_sessions s JOIN employee_accounts a ON a.id=s.employee_id
    WHERE s.token_hash=? AND s.expires_at>? AND s.version=a.credential_version AND a.active=1`).bind(await digest(token),Date.now()).first<Account>();
}

export async function createSession(account:Account,accountBucket:string) {
  const token=randomHex(32);
  const database=db();
  await database.batch([
    database.prepare('DELETE FROM employee_sessions WHERE expires_at<=?').bind(Date.now()),
    database.prepare('DELETE FROM employee_login_attempts WHERE bucket=? OR expires_at<=?').bind(accountBucket,Date.now()),
    database.prepare('INSERT INTO employee_sessions(token_hash,employee_id,version,expires_at) VALUES (?,?,?,?)')
      .bind(await digest(token),account.id,account.credential_version,Date.now()+sessionAge*1000),
  ]);
  return sessionCookie(token);
}

export async function revokeSession(request:Request) {
  const token=sessionToken(request);
  if (token) await db().prepare('DELETE FROM employee_sessions WHERE token_hash=?').bind(await digest(token)).run();
}
