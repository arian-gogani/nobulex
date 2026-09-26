/** Synthetic study models. No production adapter, vulnerability scanner, or financial execution. */
import {createHash, createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const PASS='PASS', FAIL='FAIL', UNKNOWN='UNKNOWN';
// Fixed seeds are deliberately PUBLIC test material. Never use these keys outside tests.
function key(label) {
  const seed=createHash('sha256').update(`nobulex-public-study-fixture:${label}`).digest();
  const der=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]);
  const privateKey=createPrivateKey({key:der,format:'der',type:'pkcs8'});
  return {privateKey,publicKey:createPublicKey(privateKey)};
}
const keys=Object.fromEntries(['trusted','attacker','bystander'].map(n=>[n,key(n)]));
function signedReceipt(index, signer='trusted') {
  const message=Buffer.from(JSON.stringify({fixture:'receipt',index,event:'allowed'}));
  return {message, signature:sign(null,message,keys[signer].privateKey),embeddedKey:keys[signer].publicKey};
}
function signatureHolds(receipt, publicKey) {return verify(null,receipt.message,publicKey,receipt.signature);}

export function coverage(input, hardened) {
  const receipts=input.empty?[]:Array.from({length:4},(_,i)=>signedReceipt(i));
  for(const i of input.tamper??[]) {
    if(!receipts[i]) throw new Error('invalid fixture index');
    receipts[i].message=Buffer.from(`changed:${i}`);
  }
  if(hardened && !receipts.length) return {verdict:UNKNOWN,checked:0};
  const checked=hardened?receipts:receipts.slice(-1);
  let count=0;
  const valid=checked.every(r=>{count++;return signatureHolds(r,keys.trusted.publicKey);});
  return {verdict:valid?PASS:FAIL,checked:count};
}
export function keyOrigin(input,hardened) {
  const receipt=signedReceipt(0,input.signer);
  if(hardened && !input.anchor) return {verdict:UNKNOWN,signatureChecked:false};
  const anchor=hardened?keys[input.anchor].publicKey:receipt.embeddedKey;
  return {verdict:signatureHolds(receipt,anchor)?PASS:FAIL,signatureChecked:true};
}
export function policy(input,hardened) {
  const {policy:p,request:r}=input;
  // This intentionally tiny JSON policy is NOT Cedar and does not implement principal/unless.
  if(hardened && (!p || !r || typeof p!=='object' || typeof r!=='object' || Array.isArray(p) || Array.isArray(r) || !['permit','deny'].includes(p.effect) || typeof p.action!=='string' || !p.action.trim() || typeof r.action!=='string' || !r.action.trim() || Object.keys(p).some(k=>!['effect','action'].includes(k)))) return {verdict:UNKNOWN};
  return {verdict:p.effect==='permit' && p.action===r.action?PASS:FAIL};
}
function hash(event,previous) {return createHash('sha256').update(JSON.stringify({event,previous})).digest('hex');}
function chain(events) {
  let previous=null;
  return events.map(event=>{const h=hash(event,previous);const r={event,previous,hash:h};previous=h;return r;});
}
function consistent(records) {
  let previous=null;
  for(const r of records) {if(r.previous!==previous || r.hash!==hash(r.event,previous))return false;previous=r.hash;}
  return true;
}
export function log(input,hardened) {
  const original=chain(['request','authorize','execute']);
  let records=structuredClone(original), checkpoint=original.at(-1).hash;
  switch(input.variant) {
    case 'original':break;
    case 'edit':records[1].event='changed';break;
    case 'interior':records.splice(1,1);break;
    case 'tail':records.pop();break;
    case 'rewrite':records=chain(['request','different execution']);break;
    case 'empty':records=[];break;
    case 'no-checkpoint':checkpoint=null;break;
    case 'omitted-before-recording':records=chain(['request','execute']);checkpoint=records.at(-1).hash;break;
    default:throw new Error('unrecognized log fixture');
  }
  if(!hardened)return {verdict:consistent(records)?PASS:FAIL};
  if(!records.length || checkpoint===null)return {verdict:UNKNOWN};
  return {verdict:consistent(records) && records.at(-1).hash===checkpoint?PASS:FAIL};
}
export function preservation(input,hardened) {
  if(![null,'policy','signer','second-record'].includes(input.failure))throw new Error('unrecognized failure fixture');
  const original=['old-1','old-2'];
  let stored=[...original], candidate=[];
  // Storage is an in-memory model of the prepare/replace boundary, NOT a crash-atomic filesystem.
  if(!hardened)stored=[];
  let error=null;
  try {
    if(input.failure==='policy')throw new Error('policy unavailable');
    if(input.failure==='signer')throw new Error('signer unavailable');
    for(let i=0;i<2;i++) {
      if(input.failure==='second-record' && i===1)throw new Error('second record invalid');
      (hardened?candidate:stored).push(`new-${i+1}`);
    }
    if(hardened)stored=candidate;
  } catch(e) {error=e.message;}
  const expected=error?original:['new-1','new-2'];
  return {verdict:JSON.stringify(stored)===JSON.stringify(expected)?PASS:FAIL,operation:error?'REFUSED':'COMPLETED',stored};
}
export const models={coverage,'key-origin':keyOrigin,policy,log,preservation};
export function loadCases(path=new URL('./cases.json',import.meta.url)) {
  return validateCases(JSON.parse(readFileSync(path,'utf8')));
}
function validateCases(cases) {
  if(!Array.isArray(cases)||!cases.length)throw new Error('no cases supplied; analysis did not happen');
  const ids=new Set();
  for(const c of cases) {
    if(!c.id||ids.has(c.id)||!Object.hasOwn(models,c.family)||![PASS,FAIL,UNKNOWN].includes(c.expected)||!c.input)throw new Error('invalid case manifest');
    ids.add(c.id);
  }
  return cases;
}
export function study(cases=loadCases(),mutation=null) {
  validateCases(cases);
  if(mutation && !Object.hasOwn(models,mutation))throw new Error('unknown mutation');
  const rows=cases.map(c=>({...c,weak:models[c.family](c.input,false),reference:models[c.family](c.input,c.family!==mutation)}));
  const summary=Object.fromEntries(Object.keys(models).map(f=>{
    const x=rows.filter(c=>c.family===f);
    return [f,{cases:x.length,weak_matches:x.filter(c=>c.weak.verdict===c.expected).length,reference_matches:x.filter(c=>c.reference.verdict===c.expected).length}];
  }));
  return {schema:'nobulex-verification-boundaries-v1',scope:'synthetic fixtures, not sampled production systems',summary,rows};
}
function main() {
  const args=process.argv.slice(2);let output=null,mutation=null;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--output' && args[i+1])output=args[++i];
    else if(args[i]==='--mutation' && args[i+1])mutation=args[++i];
    else throw new Error('usage: node benchmark.mjs [--output path] [--mutation family]');
  }
  const result=study(undefined,mutation);
  const failed=result.rows.filter(c=>c.reference.verdict!==c.expected);
  for(const [family,r] of Object.entries(result.summary))console.log(`${family}: reference ${r.reference_matches}/${r.cases}; weak ${r.weak_matches}/${r.cases}`);
  console.log(`Reference mismatches: ${failed.length}. Known blind spot: omitted-before-recording passes both models.`);
  if(output)writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  process.exitCode=failed.length?1:0;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{main();}catch(e){console.error(`REFUSED: ${e.message}`);process.exitCode=2;}
}
