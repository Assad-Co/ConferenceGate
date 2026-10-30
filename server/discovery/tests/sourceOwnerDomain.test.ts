import test from 'node:test';
import assert from 'node:assert/strict';
import { getSourceOwnerDomain, type DomainRow } from '../sourceRegistry';
import { classifySource, isEligibleOfficialSource } from '../sourceClassification';

const row=(domain:string,source_type:DomainRow['source_type'],enabled=1)=>({domain,source_type,enabled} as DomainRow);
const registry=new Map<string,DomainRow>([
  ['asme.org',row('asme.org','professional_society')],
  ['event.asme.org',row('event.asme.org','unknown')],
  ['blocked.asme.org',row('blocked.asme.org','unknown',0)],
  ['directory.asme.org',row('directory.asme.org','conference_directory')],
  ['wordpress.com',row('wordpress.com','conference_organizer')],
]);
const lookup=async(domain:string)=>registry.get(domain);

test('official society subdomains inherit the nearest registered owner classification',async()=>{
  for(const host of ['event.asme.org','2027.event.asme.org']) {
    const owner=await getSourceOwnerDomain(host,lookup);
    assert.equal(owner?.domain,'asme.org');
    const input={pageUrl:`https://${host}/imece`,title:'International Mechanical Engineering Congress 2027',registryType:owner?.source_type};
    assert.equal(isEligibleOfficialSource({...input,...classifySource(input)}),true);
    assert.equal(isEligibleOfficialSource({...input,pageUrl:`https://${host}/events`,...classifySource({...input,pageUrl:`https://${host}/events`})}),false);
  }
});

test('exact denials and directory classifications cannot inherit higher trust',async()=>{
  assert.equal(await getSourceOwnerDomain('blocked.asme.org',lookup),undefined);
  assert.equal((await getSourceOwnerDomain('directory.asme.org',lookup))?.source_type,'conference_directory');
  assert.equal(await getSourceOwnerDomain('unknown.example',lookup),undefined);
  assert.equal(await getSourceOwnerDomain('asme.org.attacker.com',lookup),undefined);
  assert.equal(await getSourceOwnerDomain('notasme.org',lookup),undefined);
  assert.equal(await getSourceOwnerDomain('tenant.wordpress.com',lookup),undefined);
});

test('unknown and disabled owners do not confer authority',async()=>{
  assert.equal(await getSourceOwnerDomain('event.unlisted.org',async d=>d==='unlisted.org'?row(d,'unknown'):undefined),undefined);
  assert.equal(await getSourceOwnerDomain('event.disabled.org',async d=>d==='disabled.org'?row(d,'professional_society',0):undefined),undefined);
});
