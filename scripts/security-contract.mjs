import { assertAuthorized } from '../dist/security.js';
const base = { principalId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', role: 'BUYER', sessionExpiresAt: new Date(Date.now()+60000).toISOString(), disabled: false };
assertAuthorized(base, { organizationId: base.organizationId, allowedRoles: ['BUYER'] }, new Date().toISOString());
let rejected = false; try { assertAuthorized({ ...base, disabled: true }, { organizationId: base.organizationId, allowedRoles: ['BUYER'] }, new Date().toISOString()); } catch { rejected = true; }
if (!rejected) throw new Error('disabled principal accepted');
console.log('SECURITY_OK tenant_scope=true disabled_principal=rejected');
