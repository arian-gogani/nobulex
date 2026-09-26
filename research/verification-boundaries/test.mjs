import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {study,loadCases,coverage,keyOrigin,policy,preservation,models,PASS,FAIL,UNKNOWN} from './benchmark.mjs';
const program=fileURLToPath(new URL('./benchmark.mjs',import.meta.url));

test('all hand-labeled fixture expectations hold and every family has a clean control',()=>{
 const cases=loadCases(),r=study(cases);
 assert.equal(cases.length,27);
 for(const family of Object.keys(models))assert(cases.some(c=>c.family===family && c.role==='clean'));
 for(const c of r.rows)assert.equal(c.reference.verdict,c.expected,c.id);
});
test('coverage reference rejects every nonempty subset of corrupted receipt positions',()=>{
 for(let mask=1;mask<16;mask++){
  const tamper=[0,1,2,3].filter(i=>mask&(1<<i));
  assert.equal(coverage({tamper},true).verdict,FAIL,`mask=${mask}`);
  assert.equal(coverage({tamper},false).verdict,(mask&8)?FAIL:PASS);
 }
 assert.deepEqual(coverage({},true),{verdict:PASS,checked:4});
 assert.deepEqual(coverage({empty:true},true),{verdict:UNKNOWN,checked:0});
});
test('signature acceptance requires both successful math and supplied trust anchor',()=>{
 assert.equal(keyOrigin({signer:'attacker',anchor:null},true).verdict,UNKNOWN);
 assert.equal(keyOrigin({signer:'attacker',anchor:'trusted'},true).verdict,FAIL);
 assert.equal(keyOrigin({signer:'trusted',anchor:'trusted'},true).verdict,PASS);
 // An embedded key is not intrinsically bad: if separately authorized, it may be used.
 assert.equal(keyOrigin({signer:'attacker',anchor:'attacker'},true).verdict,PASS);
});
test('known completeness blind spot is preserved, not hidden in a success rate',()=>{
 const c=study().rows.find(c=>c.id==='L08');
 assert.equal(c.role,'known-blind-spot');assert.equal(c.reference.verdict,PASS);assert.equal(c.weak.verdict,PASS);
});
test('missing input and malformed manifest refuse analysis',()=>{
 const dir=mkdtempSync(join(tmpdir(),'nobulex-manifest-'));
 try{for(const [i,value] of [[],{},[{id:'x',family:'invented',expected:PASS,input:{}}], [...loadCases(),loadCases()[0]]].entries()){
  const p=join(dir,`${i}.json`);writeFileSync(p,JSON.stringify(value));assert.throws(()=>loadCases(p));
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
for(const family of Object.keys(models))test(`regression to weak ${family} model makes CLI exit 1`,()=>{
 const r=spawnSync(process.execPath,[program,'--mutation',family],{encoding:'utf8'});
 assert.equal(r.status,1,r.stdout+r.stderr);
 assert.match(r.stdout,/Reference mismatches: [1-9]/);
});
test('unrecognized command cannot silently succeed',()=>{
 const r=spawnSync(process.execPath,[program,'--mutaton','coverage'],{encoding:'utf8'});
 assert.equal(r.status,2);assert.match(r.stderr,/REFUSED/);
});
test('published results match a fresh deterministic run',()=>{
 assert.deepEqual(study(),JSON.parse(readFileSync(new URL('./results.json',import.meta.url),'utf8')));
});

test('inherited model names and empty direct studies refuse analysis',()=>{
 for(const family of ['constructor','toString','__proto__'])assert.throws(()=>study([{id:'forged',family,expected:PASS,input:{verdict:PASS}}]));
 assert.throws(()=>study([]));
});
test('coverage reports actual executed signature checks',()=>{
 for(let i=0;i<4;i++)assert.equal(coverage({tamper:[i]},true).checked,i+1);
});
test('missing or null policy actions never permit',()=>{
 for(const action of [undefined,null,''])assert.equal(policy({policy:{effect:'permit',action},request:{action}},true).verdict,UNKNOWN);
});
test('unknown failure selectors refuse and storage outcomes are independently asserted',()=>{
 assert.throws(()=>preservation({failure:'second-reccord'},true));
 for(const failure of ['policy','signer','second-record'])assert.deepEqual(preservation({failure},true),{verdict:PASS,operation:'REFUSED',stored:['old-1','old-2']});
});
