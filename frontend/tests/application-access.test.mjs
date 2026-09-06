import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCloudApplicationAccess, cloudSessionClaims } from '../lib/application-access.ts';
const now = 1_000_000;
const claims = { amr: ['ad'], exp: 2000, application_roles: ['cloud:access', 'cloud:user'] };
test('access plus normal role grants baseline user', () => assert.deepEqual(getCloudApplicationAccess(claims, now)?.roles, ['cloud-user']));
test('access plus administrator grants admin', () => assert.deepEqual(getCloudApplicationAccess({ ...claims, application_roles: ['cloud:access', 'cloud:administrator'] }, now)?.roles, ['cloud-admin']));
test('administrator without access is denied', () => assert.equal(getCloudApplicationAccess({ ...claims, application_roles: ['cloud:administrator'] }, now), null));
test('access alone and other application roles denied', () => { for (const roles of [['cloud:access'], ['tbd:access','tbd:administrator']]) assert.equal(getCloudApplicationAccess({...claims, application_roles:roles},now),null); });
test('raw AD admin groups never elevate', () => assert.deepEqual(getCloudApplicationAccess({...claims, groups:['admin','cloud-admin','svc_cloud_administrator']},now)?.roles,['cloud-user']));
test('non AD and mixed recovery authority denied', () => { for (const amr of [[],['pwd'],['ad','local_break_glass'],['ad','local_recovery'],['ad','portal_local']]) assert.equal(getCloudApplicationAccess({...claims,amr},now),null); });
test('missing expired and malformed expiry denied', () => { for (const exp of [undefined,999,NaN,'2000']) assert.equal(getCloudApplicationAccess({...claims,exp},now),null); });
test('legacy sessions cannot bypass and cached roles cannot elevate', () => {
 assert.equal(cloudSessionClaims({ roles:['cloud-admin'] },now),null);
 const token = { applicationAccessVersion:1, applicationRoles:claims.application_roles, amr:claims.amr, applicationAccessExpiresAt:claims.exp, roles:['cloud-admin'] };
 assert.deepEqual(cloudSessionClaims(token,now)?.roles,['cloud-user']);
 assert.equal(cloudSessionClaims(token,2_000_000),null);
});
