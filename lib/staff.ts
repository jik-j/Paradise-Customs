import { hashPassword, type Account } from './employee-access';
import { db } from './workshop-server';

export const staffPermissions = { analytics:1, society:2, sync:4 } as const;
export const can = (account:Account, permission:keyof typeof staffPermissions) =>
  account.grade>=3 || Boolean(account.permissions & staffPermissions[permission]);

const bossGuard = 'EXISTS (SELECT 1 FROM employee_accounts AS boss WHERE boss.id=? AND boss.active=1 AND boss.grade=4 AND boss.credential_version=?)';

export async function updateStaff(actor:Account, data:Record<string,unknown>) {
  const id=typeof data.id==='string'?data.id.trim():'';
  const grade=data.grade;
  const permissions=data.permissions;
  const intent=data.intent;
  const guarded=[actor.id,actor.credential_version];
  if (actor.grade!==4) return {status:403,error:'Only a Boss can manage staffing and access.'};
  if (!/^\d{5}$/.test(id) || !['hire','update','fire'].includes(String(intent))) return {status:400,error:'Choose a valid employee ID and action.'};
  if (intent!=='fire' && (typeof grade!=='number' || !Number.isInteger(grade) || grade<0 || grade>4 ||
    typeof permissions!=='number' || !Number.isInteger(permissions) || permissions<0 || permissions>7)) {
    return {status:400,error:'Choose a valid grade and permissions.'};
  }
  if (id===actor.id) return {status:403,error:'Ask another Boss to change your grade, permissions, or employment.'};
  const database=db();
  let write:D1PreparedStatement;
  let details:object={};
  if (intent==='hire') {
    const name=typeof data.name==='string'?data.name.trim():'';
    const password=typeof data.password==='string'?data.password:'';
    if (!name || name.length>100 || /[\x00-\x1f\x7f]/.test(name) || password.length<12 || password.length>128) {
      return {status:400,error:'Enter a name and a temporary password with 12 to 128 characters.'};
    }
    write=database.prepare(`INSERT INTO employee_accounts (id,name,grade,password_hash,credential_version,active,permissions,roster_revision)
      SELECT ?,?,?,?,1,1,?,1 WHERE ${bossGuard}
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,grade=excluded.grade,password_hash=excluded.password_hash,
      credential_version=employee_accounts.credential_version+1,active=1,permissions=excluded.permissions,
      roster_revision=employee_accounts.roster_revision+1 WHERE employee_accounts.active=0`)
      .bind(id,name,grade,await hashPassword(password),permissions,...guarded);
    details={name,grade,permissions};
  } else {
    const revision=data.revision;
    if (typeof revision!=='number' || !Number.isSafeInteger(revision) || revision<0) return {status:400,error:'Refresh the roster and try again.'};
    write=intent==='fire' ? database.prepare(`UPDATE employee_accounts SET active=0,permissions=0,credential_version=credential_version+1,roster_revision=roster_revision+1
      WHERE id=? AND active=1 AND roster_revision=? AND ${bossGuard}`).bind(id,revision,...guarded)
      : database.prepare(`UPDATE employee_accounts SET grade=?,permissions=?,roster_revision=roster_revision+1
      WHERE id=? AND active=1 AND roster_revision=? AND ${bossGuard}`).bind(grade,permissions,id,revision,...guarded);
    if (intent==='update') details={grade,permissions};
  }
  const operations=[write,database.prepare(`INSERT INTO employee_audit(id,actor_id,employee_id,action,details,created_at)
    SELECT ?,?,?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(),actor.id,id,intent,JSON.stringify(details),Date.now())];
  if (intent==='fire') operations.push(database.prepare(
    "UPDATE employee_password_requests SET status='rejected',proposed_hash=NULL,reviewed_by=? WHERE employee_id=? AND status='pending' AND changes()=1"
  ).bind(actor.id,id));
  const results=await database.batch(operations);
  return results[0].meta.changes ? {status:200} : {status:409,error:'The roster changed or that employee ID is already active. Refresh and try again.'};
}
