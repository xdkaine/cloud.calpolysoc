import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { providerSessionActive, terminateProviderSession } from '../lib/provider-session.ts';
import { cloudSessionClaims, getCloudApplicationAccess } from '../lib/application-access.ts';
const env = { issuer:'https://auth.example.org', clientId:'cloud-test', clientSecret:'test-secret' };
const identity = { providerSid:'fixture-sid', sub:'fixture-user' };
const json = (body,status=200) => new Response(JSON.stringify(body),{status});
function compile(path, imports, environment={}) {
  const module = {exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
    {module,exports:module.exports,require(name){ if(name in imports)return imports[name];throw new Error(name); },process:{env:environment},URL,Response,console});
  return module.exports;
}
test('status has no positive cache: retained identity denied immediately after termination',async()=>{
 let active=true;let reads=0;
 const fetcher=async(url,options)=>{
  assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
  assert.match(options.headers.Authorization,/^Basic /);
  if(url.endsWith('/status')){reads++;assert.equal(options.body.get('sub'),identity.sub);return json({active});}
  active=false;return json({destroyed:true});
 };
 assert.equal(await providerSessionActive(identity,fetcher,env),true);
 await terminateProviderSession(identity,fetcher,env);
 assert.equal(await providerSessionActive(identity,fetcher,env),false);assert.equal(reads,2);
});
test('unknown identity, malformed response, outage, and error status fail closed',async()=>{
 assert.equal(await providerSessionActive({},()=>{throw Error('must not call');},env),false);
 for(const fetcher of [async()=>json({}),async()=>json({active:'true'}),async()=>json({active:true},503),async()=>{throw Error('offline');}])
  assert.equal(await providerSessionActive(identity,fetcher,env),false);
});
test('termination accepts already absent session and surfaces failure instead of success',async()=>{
 await terminateProviderSession(identity,async()=>json({destroyed:false}),env);
 for(const fetcher of [async()=>json({}),async()=>json({destroyed:true},503),async()=>{throw Error('offline');}])
  await assert.rejects(terminateProviderSession(identity,fetcher,env));
 await assert.rejects(terminateProviderSession({},async()=>json({destroyed:true}),env));
});
test('actual Auth.js callbacks reject replay after provider termination and preserve unrelated session',async()=>{
 let options;const killed=new Set();
 compile('../auth.ts',{
  'next-auth':{default:(configuration)=>{options=configuration;return {}; }},
  './lib/provider-session':{providerSessionActive:async(token)=>typeof token.providerSid==='string'&&!killed.has(token.providerSid)},
  './lib/application-access':{cloudSessionClaims,getCloudApplicationAccess},
 },{AUTH_REQUIRE_APPLICATION_ACCESS:'true',AUTH_OIDC_ISSUER:env.issuer});
 const profile={sub:identity.sub,sid:identity.providerSid,amr:['ad'],application_roles:['cloud:access','cloud:user'],exp:Math.floor(Date.now()/1000)+600};
 const cookie=await options.callbacks.jwt({token:{},account:{access_token:'private-access',id_token:'private-id'},profile});
 assert.ok(await options.callbacks.jwt({token:{...cookie}}));
 killed.add(identity.providerSid);
 assert.equal(await options.callbacks.jwt({token:{...cookie}}),null);
 assert.ok(await options.callbacks.jwt({token:{...cookie,providerSid:'other-session'}}));
 assert.equal(await options.callbacks.jwt({token:{...cookie,providerSid:undefined}}),null);
 assert.equal(await options.callbacks.jwt({token:{},account:{},profile:{...profile,sid:undefined}}),null);
 const session=await options.callbacks.session({session:{user:{}},token:cookie});
 assert.equal(session.accessToken,undefined);assert.equal(session.idToken,undefined);
});
test('actual logout route rejects CSRF, retains cookie on failure, clears only after confirmed termination',async()=>{
 let unavailable=true;let cleared=0;let revoked=0;
 const {POST}=compile('../app/auth/logout/route.ts',{
  'next/server':{NextResponse:class extends Response {static json(body,init){return json(body,init.status);}static redirect(url,status){return new Response(null,{status,headers:{Location:String(url)}});}}},
  'next-auth/jwt':{getToken:async()=>identity},
  '@/auth':{signOut:async()=>{cleared++;}},
  '@/lib/provider-session':{terminateProviderSession:async()=>{revoked++;if(unavailable)throw Error('offline');}},
 },{AUTH_REQUIRE_APPLICATION_ACCESS:'true',AUTH_URL:'https://cloud.example.org',AUTH_SECRET:'test'});
 const request=(origin)=>new Request('https://cloud.example.org/auth/logout',{method:'POST',headers:origin?{Origin:origin}:{}});
 assert.equal((await POST(request('https://evil.example.org'))).status,403);assert.equal(revoked,0);
 assert.equal((await POST(request())).status,403);
 assert.equal((await POST(request('https://cloud.example.org'))).status,503);assert.equal(cleared,0);
 unavailable=false;
 assert.equal((await POST(request('https://cloud.example.org'))).status,303);assert.equal(cleared,1);
});
