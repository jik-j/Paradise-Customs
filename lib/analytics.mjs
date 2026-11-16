const HOUR = 3600000;
const MAX_ORDER_TIME = 4 * HOUR;
const DAY = 24 * HOUR;
const INDIA_OFFSET = 5.5 * HOUR;
const BONUS_PERCENT = 10;
const time = event => Date.parse(event.occurredAt);
const itemKey = name => name.normalize('NFKC').toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g,'');
const quantities = text => (text || '').split(/\n|;(?=\s*\w)/).flatMap(line => {
  const before = line.trim().match(/^(\d+)\s*[x×]\s*(.+?)\s*\([^()]+\)$/i);
  const after = line.trim().match(/^(.+?)\s*[x×]\s*(\d+)\s*\([^()]+\)$/i);
  const quantity = Number(before?.[1] ?? after?.[2]);
  const name = before?.[2] ?? after?.[1];
  return name && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100000 ? [{name,quantity}] : [];
});
function coverage(intervals) {
  let total = 0, end = -Infinity;
  for (const [from,to] of [...intervals].sort((a,b)=>a[0]-b[0])) {
    total += Math.max(0,to-Math.max(from,end));
    end = Math.max(end,to);
  }
  return total;
}

export function summarize(events, days = 0, now = Date.now()) {
  const cutoff = days ? now - days * DAY : -Infinity;
  const midnight = Math.floor((now + INDIA_OFFSET) / DAY) * DAY - INDIA_OFFSET;
  const today = {profit:0,confirmedSales:0,estimatedProfit:0,estimatedSales:0,uncosted:0};
  const inRange = event => event && time(event) >= cutoff && time(event) <= now;
  const ordered = events.filter(event=>time(event)<=now).sort((a,b)=>time(a)-time(b));
  const employees = new Map(), customers = new Map(), stock = new Map();
  const orders = new Map(), invoices = new Map(), payments = new Map(), shifts = new Map();
  const metrics = {dutyMs:0, estimatedDutyMs:0, orders:0, invoices:0, parts:0, profit:0, estimatedProfit:0,
    paidRevenue:0, partsSpend:0, uncosted:0, confirmedSales:0, estimatedSales:0};
  function employee(id, name) {
    if (!id) return null;
    if (!employees.has(id)) employees.set(id,{...Object.fromEntries(Object.keys(metrics).map(key=>[key,0])),
      id,name,invoiceAmountAllTime:0,todayProfit:0,active:0,activeOrders:0,dutyIssues:0,hasDuty:false,clock:[],work:[]});
    return employees.get(id);
  }
  function add(key, amount, person) {
    metrics[key] += amount;
    if (person) person[key] += amount;
  }
  function visit(event, orderId, amount, fulfilled = false) {
    if (!event?.customerId || !event.customerName) return;
    const row = customers.get(event.customerId) || {id:event.customerId,name:event.customerName,visits:0,completed:0,spend:0,orderIds:[],lastOrder:''};
    if (orderId) row.orderIds.push(orderId);
    row.visits++;
    row.completed += Number(fulfilled);
    row.spend += amount ?? 0;
    row.lastOrder = [row.lastOrder,event.occurredAt].sort().at(-1);
    customers.set(row.id,row);
  }
  function product(name) {
    const id = itemKey(name);
    if (!stock.has(id)) stock.set(id,{id,name:name.replaceAll('_',' '),incoming:0,outgoing:0,cost:0,lots:[],unmatched:0,offers:[]});
    return stock.get(id);
  }
  function issue(items, sale) {
    let cost = 0, known = true;
    for (const {name,quantity} of items) {
      const row = product(name);
      let remaining = quantity;
      for (const lot of row.lots) {
        const used = Math.min(lot.quantity,remaining);
        if (!used) continue;
        if (lot.cost == null) known = false;
        else cost += lot.cost * used;
        lot.quantity -= used;
        remaining -= used;
        if (!remaining) break;
      }
      if (remaining) known = false;
      if (inRange(sale)) {
        row.outgoing += quantity;
        row.unmatched += remaining;
      }
    }
    return known && items.length ? Math.round(cost) : undefined;
  }
  function margin(sale, amount, actor, explicit, commission, items = []) {
    const person = actor ? employee(actor.employeeId,actor.employeeName) : null;
    const inferred = items.length ? issue(items,sale) : undefined;
    const reporting = inRange(sale);
    const isToday = time(sale) >= midnight;
    if (!reporting && !isToday) return;
    const reported = explicit.find(event=>event?.profitCents != null)?.profitCents;
    const cost = explicit.find(event=>event?.costCents != null)?.costCents;
    if (amount==null && reported==null) return;
    if (reporting && amount!=null) add('paidRevenue',amount,person);
    if (reported != null || cost != null) {
      const profit=reported ?? amount-cost-commission;
      if (isToday) {
        today.profit += profit;
        today.confirmedSales++;
        if (person) person.todayProfit += profit;
      }
      if (!reporting) return;
      add('profit',profit,person);
      add('confirmedSales',1,person);
      // Only itemized single-product sales with an explicit cost can anchor a discount.
      if ((cost != null || inferred != null) && items.length===1 && amount > 0 && sale.commissionCents != null) {
        const item=items[0];
        product(item.name).offers.push({amount,cost:Math.max((cost??inferred)+commission,reported==null?0:amount-reported),quantity:item.quantity});
      }
    } else if (inferred != null) {
      const profit=amount-inferred-commission;
      if (isToday) {
        today.estimatedProfit += profit;
        today.estimatedSales++;
      }
      if (!reporting) return;
      add('estimatedProfit',profit,person);
      add('estimatedSales',1,person);
      if (items.length===1 && amount>0 && sale.commissionCents!=null) {
        product(items[0].name).offers.push({amount,cost:inferred+commission,quantity:items[0].quantity});
      }
    } else {
      if (isToday) today.uncosted++;
      if (reporting) add('uncosted',1,person);
    }
  }
  for (const event of ordered) {
    const type=event.type;
    if (type.startsWith('order.')) {
      const order=orders.get(event.orderId) || {};
      order[type==='order.created'?'created':type==='order.completed'?'completed':'cancelled']=event;
      orders.set(event.orderId,order);
    } else if (type==='invoice.created') {
      invoices.set(event.invoiceId,event);
      const issuer = employee(event.employeeId,event.employeeName);
      if (issuer) issuer.invoiceAmountAllTime += event.amountCents;
      if (inRange(event)) add('invoices',1,issuer);
    } else if (type==='invoice.paid') payments.set(event.invoiceId,event);
    else if (type.startsWith('duty.')) {
      const id=event.dutyKey ?? event.shiftId ?? event.employeeId;
      const current=shifts.get(id) || {};
      const person=employee(event.employeeId,event.employeeName);
      person.hasDuty=true;
      if (type==='duty.started') {
        if (current.start) person.dutyIssues++;
        else shifts.set(id,{start:event});
      } else if (!current.start || current.start.employeeId!==event.employeeId) person.dutyIssues++;
      else {
        const from=Math.max(cutoff,time(current.start));
        if (time(event)>from) person.clock.push([from,time(event)]);
        shifts.delete(id);
      }
    }
  }
  for (const {start} of shifts.values()) {
    const person=employee(start.employeeId,start.employeeName);
    person.active++;
    // An open shift has no verified end time and stays out of clocked totals.
  }

  const linkedPayments = new Map();
  for (const [id,payment] of payments) {
    const invoice=invoices.get(id);
    if (invoice && time(payment)<time(invoice)) continue;
    const orderId=payment.orderId ?? invoice?.orderId;
    if (orderId) linkedPayments.set(orderId,[...(linkedPayments.get(orderId) || []),payment]);
  }
  for (const event of ordered) {
    if (event.type==='parts.obtained') {
      const row=product(event.partName);
      row.lots.push({quantity:event.quantity,cost:event.totalCostCents!=null?event.totalCostCents/event.quantity:undefined});
      if (inRange(event)) {
        row.incoming+=event.quantity;
        row.cost+=event.totalCostCents??0;
        const person=employee(event.employeeId,event.employeeName);
        add('parts',event.quantity,person);
        add('partsSpend',event.totalCostCents??0,person);
      }
    }
    if (event.type==='parts.used') issue([{name:event.partName,quantity:event.quantity}],event);
    if (event.type==='invoice.paid') {
      const invoice=invoices.get(event.invoiceId);
      if (invoice && time(event)<time(invoice)) continue;
      const orderId=event.orderId ?? invoice?.orderId;
      const amount=event.amountCents??invoice?.amountCents;
      const order=orders.get(orderId);
      margin(event,amount,invoice,[event,invoice],event.commissionCents??order?.completed?.commissionCents??0,quantities(invoice?.breakdown));
      if (inRange(event)) {
        if (!inRange(order?.created)) visit(event.customerId ? event : invoice,null,amount);
      }
    }
    if (event.type==='order.created' && event.orderPaidCents>0 && !linkedPayments.has(event.orderId)) {
      const order=orders.get(event.orderId);
      if (!order.cancelled || order.completed) margin(event,event.orderPaidCents,order.completed,[order.completed,event],order.completed?.commissionCents??0);
    }
    if (event.type==='order.completed' && event.profitCents!=null && !linkedPayments.has(event.orderId) && !orders.get(event.orderId)?.created?.orderPaidCents) {
      margin(event,undefined,event,[event],event.commissionCents??0);
    }
  }

  const orderRows=[];
  for (const [id,{created,completed,cancelled}] of orders) {
    const current=completed || cancelled || created;
    const placement=created || (current.source!=='discord'?current:null);
    const assignedId=created?.assigneeId ?? (created?.source!=='discord'?created?.employeeId:null);
    const worker=completed ? employee(completed.employeeId,completed.employeeName) :
      employee(assignedId,created?.assigneeName ?? created?.employeeName);
    if (completed && inRange(completed)) add('orders',1,worker);
    if (!completed && !cancelled && worker) worker.activeOrders++;
    if (worker && created && (!cancelled || completed)) {
      const start=time(created);
      const stop=completed?time(completed):now;
      if (stop>=start && stop-start<=MAX_ORDER_TIME && (completed || assignedId)) {
        const from=Math.max(cutoff,start);
        if (from<stop) worker.work.push([from,stop]);
      }
    }
    if (inRange(placement)) {
      const linked=(linkedPayments.get(id) || []).filter(payment=>inRange(payment) && payment.occurredAt>=placement.occurredAt);
      const spend=linked.length?linked.reduce((total,payment)=>total+(payment.amountCents??invoices.get(payment.invoiceId)?.amountCents??0),0):created?.orderPaidCents;
      visit(placement,id,cancelled&&!completed&&!linked.length?0:spend,Boolean(completed));
    }
    if (inRange(current) || (!completed && !cancelled)) orderRows.push({...created,...current,id,customerId:placement?.customerId,customerName:placement?.customerName,
      employeeName:worker?.name,status:completed?'Completed':cancelled?'Cancelled':'Open',createdAt:created?.occurredAt});
  }
  for (const person of employees.values()) {
    const clocked=coverage(person.clock);
    add('dutyMs',clocked,person);
    add('estimatedDutyMs',coverage([...person.clock,...person.work])-clocked,person);
  }
  const inventory = [...stock.values()].map(({lots,offers,...row})=>({
    ...row,onHand:lots.reduce((sum,lot)=>sum+lot.quantity,0),confirmedPricedSales:offers.length,
  })).filter(row=>row.incoming || row.outgoing || row.onHand).sort((a,b)=>b.outgoing-a.outgoing || a.name.localeCompare(b.name));
  const discounts = [...stock.values()].flatMap(row=>{
    if (row.offers.length<2 || !row.lots.some(lot=>lot.quantity>0) || row.lots.some(lot=>lot.quantity>0 && lot.cost==null)) return [];
    const highestStockCost=Math.max(...row.lots.filter(lot=>lot.quantity>0).map(lot=>lot.cost));
    const safePercent=Math.floor(Math.min(10,...row.offers.map(({amount,cost,quantity})=>{
      const conservativeCost=Math.max(cost,Math.ceil(highestStockCost*quantity));
      return 100*Math.min((amount-conservativeCost)*0.2,amount-conservativeCost/0.8)/amount;
    })));
    return safePercent>=1 ? [{id:row.id,name:row.name,percent:safePercent,sales:row.offers.length,
      minimumMarginPercent:20,profitRetentionPercent:80}] : [];
  }).sort((a,b)=>b.percent-a.percent);
  const recent = (a,b)=>b.occurredAt.localeCompare(a.occurredAt);
  return {metrics,today,employees:[...employees.values()].map(({clock,work,...row})=>row).sort((a,b)=>a.name.localeCompare(b.name)),
    orders:orderRows.sort(recent),customers:[...customers.values()].sort((a,b)=>b.visits-a.visits || b.spend-a.spend),
    inventory,discounts,events:ordered.filter(inRange).sort(recent),latest:ordered.at(-1)?.occurredAt??null};
}

/**
 * @param {{employees:{id:string,todayProfit:number}[],today:{profit:number}}} report
 * @param {Set<string>} activeEmployeeIds
 */
export function recommendDailyBonuses(report, activeEmployeeIds) {
  const eligible = report.employees.filter(person=>activeEmployeeIds.has(person.id) && person.todayProfit>0);
  const eligibleProfit = eligible.reduce((total,person)=>total+person.todayProfit,0);
  const budget = Math.floor(Math.min(Math.max(0,report.today.profit),eligibleProfit) * BONUS_PERCENT / 100);
  const rows = budget ? eligible.map(person=>({
    id:person.id,
    profit:person.todayProfit,
    bonus:Number(BigInt(budget)*BigInt(person.todayProfit)/BigInt(eligibleProfit)),
  })).filter(row=>row.bonus>0).sort((a,b)=>b.bonus-a.bonus) : [];
  return {percent:BONUS_PERCENT, total:rows.reduce((total,row)=>total+row.bonus,0), rows};
}
