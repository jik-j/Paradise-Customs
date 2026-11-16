export const eventFields = {
  'duty.started': { shiftId: 'id', dutyKey: 'id?' },
  'duty.ended': { shiftId: 'id', dutyKey: 'id?' },
  'order.created': { orderId: 'id', assigneeName: 'optional', customerId: 'id', customerName: 'text', service: 'optional', vehicle: 'optional', orderPaidCents: 'money?', costCents: 'money?', profitCents: 'signed?', paymentMethod: 'optional' },
  'order.cancelled': { orderId: 'id' },
  'order.completed': { orderId: 'id', costCents: 'money?', profitCents: 'signed?', customerId: 'id?', customerName: 'optional', service: 'optional', vehicle: 'optional', commissionCents: 'money?' },
  'invoice.created': { invoiceId: 'id', orderId: 'id?', customerId: 'id', customerName: 'text', amountCents: 'money', costCents: 'money?', profitCents: 'signed?', breakdown: 'long?' },
  'invoice.paid': { invoiceId: 'id', orderId: 'id?', costCents: 'money?', profitCents: 'signed?', customerId: 'id?', customerName: 'optional', amountCents: 'money?', commissionCents: 'money?', paymentMethod: 'optional' },
  'parts.used': { receiptId: 'id', partName: 'text', quantity: 'quantity' },
  'parts.obtained': { receiptId: 'id', partName: 'text', quantity: 'quantity', totalCostCents: 'money?', fundSource: 'optional' },
};

export function parseEvent(input) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(eventFields, input.type)) throw new Error('Unsupported event type.');
  const types = { eventId: 'id', employeeId: 'id', employeeName: 'text', ...eventFields[input.type], source: 'optional', shop: 'optional' };
  /** @type {Record<string, any>} */
  const event = { type: input.type, occurredAt: input.occurredAt };
  const timestamp = typeof event.occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(event.occurredAt) ? Date.parse(event.occurredAt) : NaN;
  if (!Number.isFinite(timestamp)) throw new Error('occurredAt must be an ISO 8601 timestamp with a timezone.');
  event.occurredAt = new Date(timestamp).toISOString();
  for (const [key, field] of Object.entries(types)) {
    const value = input[key];
    if ((field === 'optional' || field.endsWith('?')) && value == null) continue;
    const type = field.replace(/\?$/, '');
    const valid = type === 'id' ? typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value)
      : ['money','quantity','signed'].includes(type) ? Number.isSafeInteger(value) && value >= (type === 'quantity' ? 1 : type === 'signed' ? -100000000000 : 0) && value <= 100000000000
      : typeof value === 'string' && value.trim().length > 0 && value.length <= (type === 'long' ? 1024 : 160);
    if (!valid) throw new Error(`Invalid or missing ${key}.`);
    event[key] = typeof value === 'string' ? value.trim() : value;
  }
  if (event.source !== 'discord') {
    const required = { 'order.created': ['service'], 'order.completed': ['customerId','customerName','service'], 'invoice.created': ['orderId','costCents'] };
    for (const field of required[event.type] || []) if (event[field] == null) throw new Error(`Invalid or missing ${field}.`);
  }
  return { event, timestamp, entityId: event[Object.keys(eventFields[input.type])[0]] };
}

export const defaultCatalogue = [
  { id: 'repair', category: 'Repairs', name: 'Full Vehicle Repair', description: 'Mechanical and bodywork restoration', price: 250000 },
  { id: 'engine', category: 'Performance', name: 'Engine Upgrade', description: 'Performance engine tuning and fitting', price: 1800000 },
  { id: 'turbo', category: 'Performance', name: 'Turbo Installation', description: 'Turbo fitting and boost calibration', price: 2200000 },
  { id: 'brakes', category: 'Performance', name: 'Brake Upgrade', description: 'High-performance brake package', price: 750000 },
  { id: 'paint', category: 'Cosmetics', name: 'Custom Respray', description: 'Exterior paint and colour matching', price: 550000 },
  { id: 'wheels', category: 'Cosmetics', name: 'Custom Wheels', description: 'Wheel fitting and styling', price: 650000 },
];

export { summarize } from './analytics.mjs';
