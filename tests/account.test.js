import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProfile,validatePreferences,accessError} from '../src/account/model.js';
import {repositoryFor,initial} from '../src/storage.js';

test('profile validation trims names and allows only credential-free HTTPS avatars',()=>{
  assert.deepEqual(validateProfile({display_name:'  Mae  ',avatar_url:'',bio:'Hello'}),{display_name:'Mae',avatar_url:'',bio:'Hello'});
  for(const avatar of ['javascript:alert(1)','http://images.example/a.png','https://user:secret@example.com/a.png','not-a-url'])assert.throws(()=>validateProfile({display_name:'Mae',avatar_url:avatar,bio:''}));
  assert.throws(()=>validateProfile({display_name:' ',avatar_url:'',bio:''}));
  assert.throws(()=>validateProfile({display_name:'Mae',avatar_url:'',bio:'x'.repeat(1001)}));
});
test('preference validation permits extension keys and rejects unsafe reserved values',()=>{
  assert.deepEqual(validatePreferences({theme:'dark',future:{locale:'en-IE'}}),{theme:'dark',future:{locale:'en-IE'}});
  for(const value of [null,[],{theme:'unknown'},{notifications:'yes'},{currency:'XXX'},{density:null},{large:'x'.repeat(17000)}])assert.throws(()=>validatePreferences(value));
});
test('local shifts are isolated per account and the original local workspace is preserved',()=>{
  const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const legacy=repositoryFor(null,storage),alice=repositoryFor('alice',storage),bob=repositoryFor('bob',storage);
  assert.equal(alice.exists(),false);assert.equal(legacy.exists(),false);
  const a=initial();a.rates[0].name='Alice only';alice.save(a);assert.equal(alice.exists(),true);assert.equal(bob.exists(),false);
  assert.equal(alice.load().rates[0].name,'Alice only');assert.equal(bob.load().rates[0].name,'My part-time job');
  const old=initial();old.rates[0].name='Original browser data';legacy.save(old);
  assert.equal(legacy.load().rates[0].name,'Original browser data');assert.equal(alice.load().rates[0].name,'Alice only');
});
test('restricted authentication failures get an actionable message',()=>{
  assert.match(accessError({message:'Error running hook: hook_error'}),/approved by an administrator/);
  assert.match(accessError({message:'Invalid login credentials'}),/incorrect/);
});

test('configuration fails closed and rejects server secrets before bundling',async()=>{
  const {configurationProblem}=await import('../src/account/model.js');
  const url='https://example.supabase.co',key='sb_publishable_example_public_key_123456';
  assert.equal(configurationProblem(null,null),null);
  assert.match(configurationProblem(null,null,true),/requires account/);
  assert.match(configurationProblem(url,null),/both/);
  assert.match(configurationProblem('https://user:pass@example.supabase.co',key),/without credentials/);
  assert.match(configurationProblem('http://example.com',key),/HTTPS/);
  assert.match(configurationProblem(url,'sb_secret_dont_publish'),/Secret/);
  const token=role=>'header.'+btoa(JSON.stringify({role}))+'.signature';
  assert.match(configurationProblem(url,token('service_role')),/service-role/);
  assert.equal(configurationProblem(url,token('anon')),null);
  assert.equal(configurationProblem(url,key),null);
  assert.equal(configurationProblem('http://localhost:54321',key,false,true),null);
});
