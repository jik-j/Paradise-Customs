import { db } from '../../../lib/workshop-server';
import { checkPassword, consumeLoginAttempt, createSession, employeeSession, ensureRoster, hashPassword, revokeSession, sessionCookie, type Account } from '../../../lib/employee-access';
import { grades, societySnapshot } from '../../../lib/employee-roster';
import { DiscordSyncError, syncDiscord } from '../../../lib/discord-sync';
import { can, updateStaff } from '../../../lib/staff';
import { summarize, recommendDailyBonuses } from '../../../lib/analytics.mjs';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const json=(value:unknown,status=200,cookie?:string)=>Response.json(value,{status,headers:{...headers,...cookie&&{'Set-Cookie':cookie}}});
type SafeAccount=Pick<Account,'id'|'name'|'grade'|'active'|'permissions'|'roster_revision'>;
type Event={employeeId:string;employeeName:string;source?:string;type:string;occurredAt:string;assigneeName?:string};
const normalized=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

async function portal(account:Account, days:number) {
  const access={boss:account.grade===4,analytics:can(account,'analytics'),society:can(account,'society'),sync:can(account,'sync')};
  const database=db();
  const roster=(await database.prepare('SELECT id,name,grade,active,permissions,roster_revision FROM employee_accounts ORDER BY grade DESC,name COLLATE NOCASE').all<SafeAccount>()).results;
  const byName=new Map<string,string|null>();
  for (const person of roster) {
    const name=normalized(person.name);
    byName.set(name,byName.has(name)?null:person.id);
  }
  const stableIds=new Set(roster.map(person=>person.id));
  const events=(await database.prepare('SELECT payload FROM workshop_events ORDER BY occurred_at,received_at,event_id').all<{payload:string}>()).results.map(row=>{
    const event=JSON.parse(row.payload) as Event;
    const customerActor=event.source==='discord' && ['order.created','invoice.paid'].includes(event.type);
    const employeeId=customerActor?null:stableIds.has(event.employeeId)?event.employeeId:byName.get(normalized(event.employeeName));
    const assigneeId=event.assigneeName?byName.get(normalized(event.assigneeName)):null;
    return {...event,employeeId:employeeId||event.employeeId,assigneeId};
  });
  const data=summarize(events,days);
  const stats=new Map(data.employees.map(person=>[person.id,person]));
  const employees=(access.analytics?roster:roster.filter(person=>person.id===account.id)).map(person=>{
    const item=stats.get(person.id);
    return {id:person.id,name:person.name,grade:person.grade,gradeName:grades[person.grade].name,active:Boolean(person.active),
      dutyMs:item?.hasDuty?item.dutyMs:null,estimatedDutyMs:item?.estimatedDutyMs??0,activeOrders:item?.activeOrders??0,openShifts:item?.active??0,
      profit:item?.confirmedSales?item.profit:null,estimatedProfit:item?.estimatedSales?item.estimatedProfit:null,uncosted:item?.uncosted??0,
      orders:item?.orders??0,invoices:item?.invoices??0,invoiceAmountAllTime:item?.invoiceAmountAllTime??0,parts:item?.parts??0};
  });
  const activeNames=new Map(roster.filter(person=>person.active).map(person=>[person.id,person.name]));
  const recommendations=access.boss?recommendDailyBonuses(data,new Set(activeNames.keys())):undefined;
  const bonuses=recommendations && {...recommendations,rows:recommendations.rows.map(row=>({...row,name:activeNames.get(row.id)}))};
  const ownRequest=await database.prepare('SELECT status FROM employee_password_requests WHERE employee_id=?').bind(account.id).first<string>('status');
  const pending=access.boss?(await database.prepare(`SELECT r.request_id AS requestId,a.id,a.name,r.requested_at AS requestedAt
    FROM employee_password_requests r JOIN employee_accounts a ON a.id=r.employee_id WHERE a.active=1 AND r.status='pending' ORDER BY r.requested_at`).all()).results:undefined;
  const society=access.society?await societyLedger(database):undefined;
  const history=access.boss?(await database.prepare(`SELECT e.*,a.name AS actorName,t.name AS employeeName FROM employee_audit e
    LEFT JOIN employee_accounts a ON a.id=e.actor_id LEFT JOIN employee_accounts t ON t.id=e.employee_id
    ORDER BY e.created_at DESC,e.id DESC LIMIT 30`).all()).results:undefined;
  return {account:{id:account.id,name:account.name,grade:account.grade,gradeName:grades[account.grade].name,salary:grades[account.grade].salary},
    access,employees,requestStatus:ownRequest,society,pending,latest:access.sync||access.analytics?data.latest:undefined,
    ...access.boss&&{roster,history,bonuses},...access.analytics&&{analytics:{today:data.today,metrics:data.metrics,orders:data.orders.slice(0,150),customers:data.customers.slice(0,150),inventory:data.inventory,discounts:data.discounts}}};
}

type SocietyEntry={id:string;employeeId:string;employeeName:string;kind:'profit'|'expense';amountCents:number;reason:string;createdAt:number};

async function societyLedger(database:ReturnType<typeof db>) {
  const [totals,history]=await database.batch<{netCents:number}|SocietyEntry>([
    database.prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'profit' THEN amount_cents ELSE -amount_cents END),0) AS netCents
      FROM society_entries`),
    database.prepare(`SELECT e.id,e.employee_id AS employeeId,a.name AS employeeName,e.kind,e.amount_cents AS amountCents,e.reason,e.created_at AS createdAt
      FROM society_entries e JOIN employee_accounts a ON a.id=e.employee_id ORDER BY e.created_at DESC,e.id DESC LIMIT 25`),
  ]);
  const netCents=Number((totals.results[0] as {netCents:number}|undefined)?.netCents??0);
  return {...societySnapshot,balanceCents:societySnapshot.balance*100+netCents,netCents,entries:history.results as SocietyEntry[]};
}

export async function GET(request:Request) {
  try {
    const account=await employeeSession(request);
    const owner=account?.grade===4;
    const requested=Number(new URL(request.url).searchParams.get('days')??30);
    return json({owner,...account?await portal(account,[0,7,30,90].includes(requested)?requested:30):{account:null}});
  } catch {
    return json({error:'The employee portal is temporarily unavailable.'},503);
  }
}

export async function POST(request:Request) {
  if (request.headers.get('origin')!==new URL(request.url).origin) return json({error:'Open Paradise Customs to manage employee access.'},403);
  let data;
  try {data=await request.json() as {action?:string;id?:string;password?:string;requestId?:string;decision?:string;kind?:unknown;amount?:unknown;reason?:unknown;entryId?:unknown} & Record<string,unknown>;}
  catch {return json({error:'Invalid request.'},400);}
  try {
    if (data?.action==='login') {
      const id=typeof data.id==='string'?data.id.trim():'';
      const password=typeof data.password==='string'?data.password:'';
      if (!/^\d{5}$/.test(id) || !password || password.length>128) return json({error:'Enter a valid employee ID and password.'},400);
      const attempt=await consumeLoginAttempt(request,id);
      if (!attempt.allowed) return json({error:'Too many sign-in attempts. Try again in 15 minutes.'},429);
      await ensureRoster();
      const account=await db().prepare('SELECT * FROM employee_accounts WHERE id=?').bind(id).first<Account>();
      const valid=await checkPassword(account,id,password);
      if (!valid || !account?.active) return json({error:'The employee ID or password is incorrect.'},401);
      return json({ok:true},200,await createSession(account,attempt.accountBucket));
    }
    if (data?.action==='logout') {
      await revokeSession(request);
      return json({ok:true},200,sessionCookie('',0));
    }
    const account=await employeeSession(request);
    if (!account) return json({error:'Sign in with your employee ID.'},401);
    const database=db();
    if (data?.action==='staff') {
      const result=await updateStaff(account,data);
      return json(result.error?{error:result.error}:{ok:true},result.status);
    }
    if (data?.action==='sync-discord') {
      if (!can(account,'sync')) return json({error:'You do not have permission to sync Discord logs.'},403);
      const result=await syncDiscord();
      if (!result.connected) return json({error:'The Discord bot is disconnected. Reconnect it in Workshop settings.'},409);
      return json({ok:true,received:result.received,syncedAt:result.syncedAt});
    }
    if (data?.action==='record-society-entry') {
      if (account.grade!==4) return json({error:'Only a Boss can record society entries.'},403);
      const {kind,entryId}=data;
      const reason=typeof data.reason==='string'?data.reason.trim():'';
      const amount=typeof data.amount==='string'?data.amount.trim().match(/^(\d{1,10})(?:\.(\d{1,2}))?$/):null;
      const cents=amount?Number(amount[1])*100+Number((amount[2]||'').padEnd(2,'0')):0;
      if ((kind!=='profit'&&kind!=='expense') || cents<=0 || cents>100_000_000_000 || !reason || reason.length>240 ||
        typeof entryId!=='string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(entryId)) {
        return json({error:'Choose profit or expense, enter an amount from $0.01 to $1,000,000,000, and give a reason of up to 240 characters.'},400);
      }
      const inserted=await database.prepare(`INSERT INTO society_entries (id,employee_id,kind,amount_cents,reason,created_at)
        SELECT ?,id,?,?,?,? FROM employee_accounts WHERE id=? AND active=1 AND grade=4 AND credential_version=?
        ON CONFLICT(id) DO NOTHING`).bind(entryId,kind,cents,reason,Date.now(),account.id,account.credential_version).run();
      if (!inserted.meta.changes) {
        const existing=await database.prepare('SELECT 1 AS found FROM society_entries WHERE id=? AND employee_id=? AND kind=? AND amount_cents=? AND reason=?')
          .bind(entryId,account.id,kind,cents,reason).first<number>('found');
        if (!existing) return json({error:'The society entry could not be saved. Refresh the portal and try again.'},409);
      }
      return json({ok:true});
    }
    if (data?.action==='request-password') {
      const password=typeof data.password==='string'?data.password:'';
      if (password.length<12 || password.length>128) return json({error:'Choose a password with 12 to 128 characters.'},400);
      const result=await database.prepare(`INSERT INTO employee_password_requests(employee_id,proposed_hash,request_id,status,requested_at,reviewed_by)
        SELECT id,?,?,'pending',?,NULL FROM employee_accounts WHERE id=? AND active=1 AND credential_version=?
        ON CONFLICT(employee_id) DO UPDATE SET proposed_hash=excluded.proposed_hash,request_id=excluded.request_id,status='pending',requested_at=excluded.requested_at,reviewed_by=NULL`)
        .bind(await hashPassword(password),crypto.randomUUID(),Date.now(),account.id,account.credential_version).run();
      return result.meta.changes?json({ok:true}):json({error:'Sign in again before requesting a password change.'},401);
    }
    if (data?.action==='review-password') {
      if (account.grade!==4) return json({error:'Only a Boss can review password changes.'},403);
      if (typeof data.id!=='string'||typeof data.requestId!=='string'||!['approve','reject'].includes(data.decision||'')) return json({error:'Invalid review.'},400);
      if (data.id===account.id) return json({error:'A different Boss must review your password change.'},403);
      const target=data.id,review=data.requestId;
      const approve=data.decision==='approve';
      const operations=[];
      if (approve) operations.push(database.prepare(`UPDATE employee_accounts SET password_hash=(SELECT proposed_hash FROM employee_password_requests WHERE employee_id=? AND request_id=?),credential_version=credential_version+1
        WHERE id=? AND active=1 AND EXISTS(SELECT 1 FROM employee_password_requests WHERE employee_id=? AND request_id=? AND status='pending' AND proposed_hash IS NOT NULL)
        AND EXISTS(SELECT 1 FROM employee_accounts WHERE id=? AND active=1 AND grade=4 AND credential_version=?)`)
        .bind(target,review,target,target,review,account.id,account.credential_version));
      operations.push(database.prepare(`UPDATE employee_password_requests SET status=?,proposed_hash=NULL,reviewed_by=?
        WHERE employee_id=? AND request_id=? AND status='pending'
          AND EXISTS(SELECT 1 FROM employee_accounts WHERE id=? AND active=1 AND grade=4 AND credential_version=?)
          AND EXISTS(SELECT 1 FROM employee_accounts WHERE id=? AND active=1)`).bind(approve?'approved':'rejected',account.id,target,review,account.id,account.credential_version,target));
      const results=await database.batch(operations);
      return results.at(-1)?.meta.changes?json({ok:true}):json({error:'This request has already changed. Refresh the queue.'},409);
    }
    return json({error:'Invalid request.'},400);
  } catch (error) {
    if (error instanceof DiscordSyncError) return json({error:error.message},error.status);
    return json({error:'The employee portal could not complete that request.'},503);
  }
}
