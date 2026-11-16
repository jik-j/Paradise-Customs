'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowRight, BarChart3, Boxes, ClipboardList, LockKeyhole, RefreshCw, Settings, Tags, Users, Wallet } from 'lucide-react';
import { grades } from '../../lib/employee-roster';
import Brand from '../brand';

type Employee={id:string;name:string;grade:number;gradeName:string;active:boolean;dutyMs:number|null;estimatedDutyMs:number;profit:number|null;estimatedProfit:number|null;uncosted:number;orders:number;invoices:number;invoiceAmountAllTime:number;parts:number;activeOrders:number;openShifts:number};
type RosterPerson={id:string;name:string;grade:number;active:number;permissions:number;roster_revision:number};
type SocietyEntry={id:string;employeeName:string;kind:'profit'|'expense';amountCents:number;reason:string;createdAt:number};
type Analytics={
  today:{profit:number;confirmedSales:number;estimatedProfit:number;estimatedSales:number;uncosted:number};
  metrics:{paidRevenue:number;profit:number;estimatedProfit:number;orders:number;parts:number;partsSpend:number;confirmedSales:number;estimatedSales:number;uncosted:number};
  orders:{id:string;customerName?:string;employeeName?:string;vehicle?:string;status:string;occurredAt:string;createdAt?:string}[];
  customers:{id:string;name:string;visits:number;completed:number;spend:number;lastOrder:string}[];
  inventory:{id:string;name:string;incoming:number;outgoing:number;onHand:number;unmatched:number;cost:number}[];
  discounts:{id:string;name:string;percent:number;sales:number;minimumMarginPercent:number;profitRetentionPercent:number}[];
};
type Portal={owner:boolean;account:Pick<Employee,'id'|'name'|'grade'|'gradeName'>&{salary:number}|null;employees?:Employee[];requestStatus?:string|null;
  access?:{boss:boolean;analytics:boolean;society:boolean;sync:boolean};analytics?:Analytics;bonuses?:{percent:number;total:number;rows:{id:string;name:string;profit:number;bonus:number}[]};latest?:string;roster?:RosterPerson[];
  history?:{id:string;employeeName:string;actorName:string;action:string;created_at:number}[];
  society?:{balanceCents:number;netCents:number;account:string;asOf:string;entries:SocietyEntry[]};pending?:{id:string;name:string;requestId:string;requestedAt:number}[];error?:string};
type Result={error?:string;received?:number};
type Submit=(body:object,message?:string|((data:Result)=>string),isSync?:boolean)=>Promise<boolean>;
const tabs=[['Overview',BarChart3],['Orders',ClipboardList],['Inventory',Boxes],['Customers',Users],['Discounts',Tags],['Society',Wallet],['Team',Users],['Settings',Settings]] as const;
type Tab=typeof tabs[number][0];
const money=(value:number|null)=>value===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:value%100?2:0}).format(value/100);
const duty=(value:number|null)=>value===null?'—':`${Math.floor(value/3600000)}h ${Math.floor(value/60000)%60}m`;
const asDate=(value:string|number)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(value));
const dataOf=(form:HTMLFormElement)=>Object.fromEntries(new FormData(form));
const permissions=[['Business analytics',1],['Society balance',2],['Discord sync',4]] as const;

function Table({headers,rows,empty='No records in this period.'}:{headers:string[];rows:{id:string;cells:ReactNode[]}[];empty?:string}) {
  return <div className="table-wrap"><table><thead><tr>{headers.map(header=><th key={header} scope="col">{header}</th>)}</tr></thead><tbody>
    {rows.length?rows.map(row=><tr key={row.id}>{row.cells.map((cell,index)=><td key={index}>{cell}</td>)}</tr>):<tr><td colSpan={headers.length} className="muted">{empty}</td></tr>}
  </tbody></table></div>;
}

function Section({title,description,children}:{title:string;description?:string;children:ReactNode}) {
  return <section className="ops-panel"><div className="ops-panel-heading"><h2>{title}</h2>{description&&<p>{description}</p>}</div>{children}</section>;
}

function Stat({label,value,detail}:{label:string;value:ReactNode;detail?:string}) {
  return <article className="ops-stat"><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</article>;
}

function StaffFields({person}:{person?:RosterPerson}) {
  return <><label className="field-label">Grade<select name="grade" defaultValue={person?.grade??0}>{grades.map((grade,index)=><option key={grade.name} value={index}>{grade.name}</option>)}</select></label>
    <fieldset className="ops-permissions"><legend>Additional permissions</legend>{permissions.map(([label,bit])=><label key={bit}><input name={'perm'+bit} type="checkbox" defaultChecked={Boolean((person?.permissions??0)&bit)}/>{label}</label>)}</fieldset></>;
}
const staffData=(form:HTMLFormElement)=>{
  const data=dataOf(form);
  return {...data,grade:Number(data.grade),permissions:permissions.reduce((mask,[,bit])=>data['perm'+bit]?mask|bit:mask,0)};
};

function Team({portal,submit,busy}:{portal:Portal;submit:Submit;busy:boolean}) {
  const [target,setTarget]=useState<string|null>(null);
  const [confirm,setConfirm]=useState(false);
  const selected=portal.roster?.find(person=>person.id===target);
  return <>
    <Section title="Staff roster" description="Bosses manage employment and grants. Managers and bosses have business analytics, society visibility and Discord sync by grade.">
      <Table headers={['Employee','ID','Grade','Status','Action']} rows={(portal.roster??[]).map(person=>({id:person.id,cells:[person.name,person.id,grades[person.grade].name,person.active?'Active':'Former',
        person.active&&person.id!==portal.account?.id?<button className="secondary" onClick={()=>{setTarget(person.id);setConfirm(false);}}>Manage</button>:null]}))}/>
    </Section>
    {selected?.active&&<Section title={'Manage '+selected.name}><div className="ops-body">
      <form key={selected.id+':'+selected.roster_revision} className="stack" onSubmit={async e=>{e.preventDefault();await submit({action:'staff',intent:'update',id:selected.id,revision:selected.roster_revision,...staffData(e.currentTarget)},'Staff access updated.');}}>
        <StaffFields person={selected}/><div className="form-actions"><button className="primary" disabled={busy}>Save grade and access</button>
        <button type="button" className="secondary" onClick={()=>setTarget(null)}>Close</button></div>
      </form>
      {confirm?<div className="ops-confirm"><p>End employment for {selected.name} and revoke their active sessions?</p><div className="form-actions">
        <button type="button" className="danger" disabled={busy} onClick={async()=>{if(await submit({action:'staff',intent:'fire',id:selected.id,revision:selected.roster_revision},'Employment ended.')) {setTarget(null);setConfirm(false);}}}>Confirm dismissal</button>
        <button type="button" className="secondary" onClick={()=>setConfirm(false)}>Cancel</button></div></div>:
        <button type="button" className="danger" onClick={()=>setConfirm(true)}>End employment</button>}
    </div></Section>}
    <Section title="Hire or rehire an employee"><form className="ops-body stack" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;if(await submit({action:'staff',intent:'hire',...staffData(form)},'Employee account activated.')) form.reset();}}>
      <div className="ops-form-grid"><label className="field-label">Employee name<input name="name" required maxLength={100}/></label>
      <label className="field-label">In-game employee ID<input name="id" required pattern="[0-9]{5}" inputMode="numeric" maxLength={5}/></label></div>
      <StaffFields/><label className="field-label">Temporary password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>
      <button className="primary" disabled={busy}>Activate account</button>
    </form></Section>
    <Section title="Staff audit history"><Table headers={['Recorded','Boss','Employee','Action']} rows={(portal.history??[]).map(row=>({id:row.id,cells:[asDate(row.created_at),row.actorName,row.employeeName,({hire:'Hired or rehired',fire:'Employment ended',update:'Grade or access updated'} as Record<string,string>)[row.action]??row.action]}))}/></Section>
  </>;
}

export default function Employees() {
  const [portal,setPortal]=useState<Portal|null>(null);
  const [tab,setTab]=useState<Tab>('Overview');
  const [days,setDays]=useState(30);
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const lastRead=useRef(0);
  const pendingEntry=useRef<{id:string;fields:string}|null>(null);
  const refresh=useCallback(async()=>{
    const read=++lastRead.current;
    const response=await fetch('/api/employees?days='+days,{cache:'no-store'});
    const data=await response.json() as Portal;
    if (!response.ok) throw new Error(data.error||'The dashboard could not be loaded.');
    if (read===lastRead.current) setPortal(data);
  },[days]);
  useEffect(()=>{void refresh().catch(error=>setNotice(error.message));},[refresh]);

  const submit:Submit=async(body,message='',isSync=false)=>{
    setBusy(true);setSyncing(isSync);setNotice('');
    try {
      const response=await fetch('/api/employees',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await response.json() as Result;
      if (!response.ok) {
        if(response.status===401 && portal?.account) await refresh();
        throw new Error(data.error||'The action could not be completed.');
      }
      const success=typeof message==='function'?message(data):message;
      try {await refresh();setNotice(success);} catch(error) {setNotice([success,(error as Error).message].filter(Boolean).join(' '));}
      return true;
    } catch(error) {setNotice((error as Error).message);return false;}
    finally {setBusy(false);setSyncing(false);}
  };
  async function recordEntry(form:HTMLFormElement) {
    const {kind,amount,reason}=dataOf(form);
    const fields=JSON.stringify([kind,amount,reason]);
    if(pendingEntry.current?.fields!==fields) pendingEntry.current={fields,id:crypto.randomUUID()};
    if(await submit({action:'record-society-entry',kind,amount,reason,entryId:pendingEntry.current.id},'Society entry recorded.')) {
      pendingEntry.current=null;form.reset();
    }
  }

  const account=portal?.account;
  const access=portal?.access;
  const data=portal?.analytics;
  const showTabs=tabs.filter(([name])=>name==='Overview'||name==='Settings'||name==='Team'&&access?.boss||name==='Society'&&access?.society||
    ['Orders','Inventory','Customers','Discounts'].includes(name)&&access?.analytics);
  const view=showTabs.some(([name])=>name===tab)?tab:'Overview';
  return <main className="ops-shell">
    <header className="ops-top"><Brand label="Workshop operations"/>
    <a className="secondary" href="/">Service catalogue <ArrowRight size={15}/></a></header>
    {notice&&<div className="ops-notice" role="status">{notice}</div>}
    {!portal&&!notice&&<p className="muted">Loading workshop…</p>}
    {portal&&!account&&<div className="ops-login"><div className="ops-login-photo" role="img" aria-label="Black custom sports car in the Paradise Customs workshop"/><div className="ops-login-form"><Section title="Employee sign-in" description="Use your in-game employee ID and workshop password. This browser remembers your session for 30 days.">
      <form className="ops-body stack" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;if(await submit({action:'login',...dataOf(form)})) {form.reset();setTab('Overview');}}}>
        <label className="field-label">Employee ID<input name="id" autoComplete="username" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required/></label>
        <label className="field-label">Password<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label>
        <button className="primary" disabled={busy}><LockKeyhole size={15}/> {busy?'Signing in…':'Sign in'}</button>
      </form></Section></div></div>}
    {account&&portal&&<div className="ops-layout">
      <aside className="ops-side"><div className="ops-identity"><span className="ops-initials" aria-hidden="true">{account.name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase()}</span><div><strong>{account.name}</strong><small>{account.gradeName} · {account.id}</small></div></div>
      <nav aria-label="Workshop dashboard">{showTabs.map(([name,Icon])=><button key={name} aria-current={view===name?'page':undefined} onClick={()=>setTab(name)}><Icon size={17}/>{name}</button>)}</nav>
      <button className="secondary ops-signout" disabled={busy} onClick={()=>void submit({action:'logout'})}>Sign out</button></aside>
      <div className="ops-content" data-view={view}>
        <div className="ops-title"><div><h1>{view==='Overview'?'Workshop overview':view}</h1>{portal.latest&&<p>Latest imported event · {asDate(portal.latest)}</p>}</div>
          <div className="form-actions">
            {['Overview','Orders','Inventory','Customers','Discounts'].includes(view)&&<select aria-label="Reporting period" disabled={busy} value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={0}>All time</option></select>}
            {access?.sync&&<button className="primary" disabled={busy} onClick={()=>void submit({action:'sync-discord'},result=>result.received?'Imported '+result.received+' new Discord logs.':'Sync complete. No new Discord logs.',true)}><RefreshCw size={15} className={syncing?'spin':''}/>{syncing?'Syncing…':'Sync now'}</button>}
          </div>
        </div>
        {view==='Overview'&&<>
          {data&&<div className="ops-stats">
            <Stat label="Today’s confirmed profit" value={data.today.confirmedSales?money(data.today.profit):'—'}
              detail={data.today.confirmedSales+' confirmed sales · IST'} />
            {(data.today.estimatedSales>0||data.today.uncosted>0)&&<Stat label="Today’s estimated profit"
              value={data.today.estimatedSales?money(data.today.estimatedProfit):'—'} detail={data.today.uncosted+' sales missing a usable cost · IST'}/>}
            {portal.bonuses&&<Stat label="Suggested employee bonuses today" value={money(portal.bonuses.total)}
              detail={'Up to '+portal.bonuses.percent+'% of today’s confirmed profit'}/>}
          </div>}
          {portal.bonuses&&<details className="ops-panel ops-bonuses">
            <summary className="ops-panel-heading">Employee bonus breakdown</summary>
            <p className="ops-body muted">Suggested amounts are split among active employees in proportion to their positive confirmed profit today. The pool is capped by the workshop’s confirmed profit after recorded losses. Recommendations are for review.</p>
            <Table headers={['Employee','Confirmed profit today','Suggested bonus']} empty="No bonuses recommended from today’s confirmed profit."
              rows={portal.bonuses.rows.map(row=>({id:row.id,cells:[row.name,money(row.profit),<strong>{money(row.bonus)}</strong>]}))}/>
          </details>}
          {data&&<div className="ops-stats"><Stat label="Recorded payments" value={money(data.metrics.paidRevenue)}/><Stat label="Confirmed profit" value={money(data.metrics.confirmedSales?data.metrics.profit:null)} detail={data.metrics.confirmedSales+' costed or reported sales'}/><Stat label="Estimated profit" value={money(data.metrics.estimatedSales?data.metrics.estimatedProfit:null)} detail={data.metrics.uncosted+' sales missing a usable cost'}/><Stat label="Fulfilled orders" value={data.metrics.orders}/></div>}
          <Section title={access?.analytics?'Employee performance':'Your workshop activity'} description="Clocked time uses paired duty logs. Order estimates use observed work windows up to four hours and exclude overlaps with clocked shifts. Invoice amounts include unpaid invoices and cover all time.">
            <Table headers={['Employee','Clocked duty','Order estimate','Open work','Fulfilled','Invoices','Parts in','Invoice amount · all time','Confirmed profit','Estimated profit']}
              rows={(portal.employees??[]).filter(row=>row.active).map(row=>({id:row.id,cells:[<><strong>{row.name}</strong><small>{row.gradeName}</small></>,duty(row.dutyMs),duty(row.estimatedDutyMs),row.activeOrders+' orders / '+row.openShifts+' shifts',row.orders,row.invoices,row.parts,money(row.invoiceAmountAllTime),money(row.profit),money(row.estimatedProfit)]}))}/>
          </Section>
        </>}
        {view==='Orders'&&data&&<Section title="Active and fulfilled orders">
          <Table headers={['Order','Customer','Mechanic','Vehicle','Status','Logged']} rows={data.orders.map(row=>({id:row.id,cells:[row.id.split(':').at(-1),row.customerName??'—',row.employeeName??'Unassigned',row.vehicle??'—',<span className={'ops-pill '+(row.status==='Open'?'ops-pill-open':'')}>{row.status}</span>,asDate(row.occurredAt)]}))}/>
        </Section>}
        {view==='Inventory'&&data&&<Section title="Stock movements" description="Outgoing quantities come from itemized paid invoices and item-use logs. On hand is the remaining quantity inferred from recorded movements.">
          <Table headers={['Product','Incoming','Outgoing','Tracked on hand','Unmatched outgoing','Purchase cost']} rows={data.inventory.map(row=>({id:row.id,cells:[row.name,row.incoming,row.outgoing,row.onHand,row.unmatched,money(row.cost)]}))}/>
        </Section>}
        {view==='Customers'&&data&&<Section title="Customer activity" description="Ranked by logged orders and paid invoices in the selected period. Orders linked to an invoice count once.">
          <Table headers={['Customer','Visits','Fulfilled orders','Recorded spend','Latest visit']} rows={data.customers.map(row=>({id:row.id,cells:[row.name,<span className="ops-pill">{row.visits}</span>,row.completed,money(row.spend),asDate(row.lastOrder)]}))}/>
        </Section>}
        {view==='Discounts'&&data&&<Section title="Margin-based discounts" description="Recommendations require at least two comparable, itemized sales with recorded commissions and known costs. They retain at least 80% of recorded profit and a 20% margin under those costs. Cost estimates use the oldest logged stock purchases first.">
          <Table headers={['Product','Up to','Sales observed','Margin floor','Profit retained']} empty="No products meet the evidence requirements in this period." rows={data.discounts.map(row=>({id:row.id,cells:[row.name,<span className="ops-pill">{row.percent}%</span>,row.sales,row.minimumMarginPercent+'%',row.profitRetentionPercent+'% or more']}))}/>
        </Section>}
        {view==='Society'&&portal.society&&<>
          <div className="ops-stats"><Stat label={'Society balance · '+portal.society.account} value={money(portal.society.balanceCents)} detail={'In-game snapshot from '+portal.society.asOf+' plus manual entries'}/><Stat label="Net recorded adjustments" value={money(portal.society.netCents)}/></div>
          {access?.boss&&<Section title="Record a society entry"><form className="ops-body stack" onSubmit={e=>{e.preventDefault();void recordEntry(e.currentTarget);}}>
            <div className="ops-form-grid"><label className="field-label">Entry type<select name="kind"><option value="profit">Profit</option><option value="expense">Expense</option></select></label>
            <label className="field-label">Amount<input name="amount" inputMode="decimal" required pattern={'[0-9]+([.][0-9]{1,2})?'}/></label></div>
            <label className="field-label">Reason<input name="reason" required maxLength={240}/></label><button className="primary" disabled={busy}><ArrowDownLeft size={15}/>Record entry</button>
          </form></Section>}
          <Section title="Society ledger"><Table headers={['Recorded','Boss','Reason','Amount']} rows={portal.society.entries.map(row=>({id:row.id,cells:[asDate(row.createdAt),row.employeeName,row.reason,money(row.kind==='expense'?-row.amountCents:row.amountCents)]}))}/></Section></>}
        {view==='Team'&&access?.boss&&<Team portal={portal} submit={submit} busy={busy}/>}
        {view==='Settings'&&<>
          <Section title="Password change" description="A boss must approve the new password."><form className="ops-body stack" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;if(await submit({action:'request-password',...dataOf(form)},'Password change requested.')) form.reset();}}>
            <label className="field-label">New password<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
            <button className="primary" disabled={busy}>Request password change</button>{portal.requestStatus&&<p className="muted">Latest request · {portal.requestStatus}</p>}
          </form></Section>
          {access?.boss&&<Section title="Password approvals"><Table headers={['Employee','Requested','Decision']} empty="No pending requests." rows={(portal.pending??[]).map(row=>({id:row.requestId,cells:[row.name,asDate(row.requestedAt),
            row.id===account.id?'Requires another boss':<div className="form-actions">{['approve','reject'].map(decision=><button key={decision} className="secondary" disabled={busy} onClick={()=>void submit({action:'review-password',id:row.id,requestId:row.requestId,decision},'Password request reviewed.')}>{decision==='approve'?'Approve':'Reject'}</button>)}</div>]}))}/></Section>}
        </>}
      </div>
    </div>}
    {portal?.owner&&<footer className="access-footer"><a href="/workshop-admin">Workshop settings</a></footer>}
  </main>;
}
