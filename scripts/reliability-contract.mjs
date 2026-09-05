import { createHash } from 'node:crypto';
import { createBackupManifest, assertRestore, assertControlAllows, assertDeterministicReplay } from '../dist/reliability.js';
const digest = createHash('sha256').update('fixture').digest('hex');
const manifest = createBackupManifest('backup-sh12', new Date().toISOString(), true, [{ key: 'ledger', sha256: digest, bytes: 7 }]);
assertRestore(manifest, [{ key: 'ledger', sha256: digest, bytes: 7 }]);
let blocked = false; try { assertControlAllows({ liveTradingKilled: true, liveOutreachKilled: false, settlementKilled: false, identityReleaseKilled: false, reason: 'test', changedAt: new Date().toISOString() }, 'TRADING'); } catch { blocked = true; }
assertDeterministicReplay([{ sequence: 1, eventType: 'X', eventDigest: digest, decision: 'PASS' }], [{ sequence: 1, eventType: 'X', eventDigest: digest, decision: 'PASS' }]);
if (!blocked) throw new Error('safety control did not fail closed');
console.log('RELIABILITY_OK backup_restore=true kill_switch=true deterministic_replay=true');
