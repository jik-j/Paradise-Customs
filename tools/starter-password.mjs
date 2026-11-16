import { createHmac } from 'node:crypto';

const id=process.argv[2];
const secret=process.env.EMPLOYEE_AUTH_SEED;
if (!/^\d{5}$/.test(id??'') || !secret) {
  console.error('Supply a five-digit employee ID and load EMPLOYEE_AUTH_SEED from your private environment file.');
  process.exit(1);
}
console.log(createHmac('sha256',secret).update('employee-initial-password:v1:'+id).digest().subarray(0,18).toString('base64url'));
