import assert from 'node:assert/strict';
import { parseEvent, summarize } from '../lib/workshop.mjs';
import { recommendDailyBonuses } from '../lib/analytics.mjs';
const hour=3600000;
const start=Date.UTC(2026,10,10);
let sequence=0;
const event=(type,h,fields={})=>({eventId:'test:'+ ++sequence,type,occurredAt:new Date(start+h*hour).toISOString(),source:'discord',employeeId:'mechanic',employeeName:'Mechanic',...fields});
const customer={customerId:'customer',customerName:'Customer'};
const events=[
  event('duty.started',0,{shiftId:'shift'}),
  event('parts.obtained',0,{receiptId:'stock',partName:'repair_kit',quantity:10,totalCostCents:2000000}),
  event('order.created',0.5,{orderId:'a',orderPaidCents:300000,...customer}),
  event('order.created',1.5,{orderId:'b',...customer}),
  event('order.created',2,{orderId:'c',...customer}),
  event('duty.ended',2,{shiftId:'shift'}),
  event('order.completed',2.5,{orderId:'a',commissionCents:0}),
  event('order.completed',3,{orderId:'b'}),
  event('invoice.created',3,{invoiceId:'i',orderId:'a',amountCents:300000,breakdown:'1xrepair kit (3000)',...customer}),
  event('invoice.paid',4,{invoiceId:'i',amountCents:300000,commissionCents:0,...customer}),
  event('invoice.created',4,{invoiceId:'ii',amountCents:300000,breakdown:'Repair kit x 1 (3000)',...customer}),
  event('invoice.paid',5,{invoiceId:'ii',amountCents:300000,commissionCents:0,...customer}),
  event('invoice.created',5,{invoiceId:'iii',amountCents:100000,profitCents:-100,...customer}),
  event('invoice.paid',6,{invoiceId:'iii',amountCents:100000,commissionCents:5,...customer}),
  event('invoice.paid',7,{invoiceId:'unknown',amountCents:123,commissionCents:0,...customer}),
  event('order.created',7,{orderId:'d',...customer}),
  event('order.cancelled',7.5,{orderId:'d'}),
  event('order.created',8,{orderId:'e',assigneeName:'Mechanic',...customer}),
];
const parsed=events.map(input=>({...parseEvent(input).event,...(input.orderId==='e'?{assigneeId:'mechanic'}:{})}));
const report=summarize(parsed,0,start+9*hour);
assert.equal(report.metrics.dutyMs,2*hour);
assert.equal(report.metrics.estimatedDutyMs,2*hour);
assert.equal(report.metrics.paidRevenue,700123);
assert.equal(report.metrics.profit,-100);
assert.equal(report.metrics.estimatedProfit,200000);
assert.equal(report.metrics.uncosted,1);
assert.equal(report.employees[0].activeOrders,1);
assert.equal(report.orders.find(order=>order.id==='d').status,'Cancelled');
assert.equal(report.inventory[0].onHand,8);
assert.equal(report.inventory[0].outgoing,2);
assert.equal(report.customers[0].visits,8);
assert.equal(report.discounts[0].percent,6);
assert.equal(report.metrics.orders,2);
assert.equal(report.employees.length,1);
assert.equal(report.employees[0].invoiceAmountAllTime,700000);
const daily = [
  event('invoice.created',18,{invoiceId:'old',amountCents:9000,costCents:1000,...customer}),
  event('invoice.paid',18.49,{invoiceId:'old',amountCents:9000,commissionCents:0,...customer}),
  event('invoice.created',18,{invoiceId:'today',amountCents:10000,costCents:2000,...customer}),
  event('invoice.paid',18.5,{invoiceId:'today',amountCents:10000,commissionCents:1000,...customer}),
  event('invoice.created',18.6,{invoiceId:'loss',employeeId:'loss',amountCents:2000,costCents:4000,...customer}),
  event('invoice.paid',18.7,{invoiceId:'loss',amountCents:2000,commissionCents:0,...customer}),
  event('invoice.created',18.8,{invoiceId:'unpaid',amountCents:4000,...customer}),
  event('invoice.created',19.8,{invoiceId:'future',amountCents:50000,...customer}),
].map(input=>parseEvent(input).event);
const dailyReport = summarize(daily,1/48,start+19*hour);
assert.equal(dailyReport.today.profit,5000);
assert.equal(dailyReport.today.confirmedSales,2);
assert.equal(dailyReport.employees.find(row=>row.id==='mechanic').invoiceAmountAllTime,23000);
assert.equal(dailyReport.employees.find(row=>row.id==='mechanic').invoices,1);
assert.deepEqual(recommendDailyBonuses(dailyReport,new Set(['mechanic','loss'])),{
  percent:10,total:500,rows:[{id:'mechanic',profit:7000,bonus:500}],
});
assert.equal(recommendDailyBonuses(dailyReport,new Set(['loss'])).total,0);
console.log('Workshop analytics fixtures passed');
