// Real PostgreSQL execution via WASM. Auth service identity is stubbed here;
// hosted email/JWT/redirect behavior still requires the acceptance checklist.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const ids={admin:'00000000-0000-4000-8000-000000000001',alice:'00000000-0000-4000-8000-000000000002',bob:'00000000-0000-4000-8000-000000000003',outsider:'00000000-0000-4000-8000-000000000004',unverified:'00000000-0000-4000-8000-000000000005'};

test('PostgreSQL account authorization and persistence',async t=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role supabase_auth_admin;
      create schema auth;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      grant usage on schema auth to authenticated,anon,supabase_auth_admin;
      grant execute on function auth.uid() to authenticated,anon;
      grant select on auth.users to supabase_auth_admin;`);
    await db.exec(await readFile(new URL('../supabase/migrations/202610290001_accounts.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610300001_workspace.sql',import.meta.url),'utf8'));
    for(const [name,id] of Object.entries(ids))await db.query('insert into auth.users values($1,$2,$3)',[id,`${name}@example.com`,name==='unverified'?null:new Date().toISOString()]);
    const bootstrap=await readFile(new URL('../supabase/bootstrap-admin.sql',import.meta.url),'utf8');
    await assert.rejects(()=>db.exec(bootstrap),/Replace REPLACE_WITH_YOUR_EMAIL/);
    await db.exec(bootstrap.replaceAll('REPLACE_WITH_YOUR_EMAIL','admin@example.com'));
    await db.exec(`insert into private.access_list(email,role) values('alice@example.com','user'),('bob@example.com','user'),('unverified@example.com','user');`);
    const as=async(role,id='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);};
    const call=async(sql,args=[])=>{const r=await db.query(sql,args);return r.rows[0]?.value;};
    const account=()=>call('select public.account_bootstrap() as value');
    const reject=async(sql,args,pattern)=>assert.rejects(()=>db.query(sql,args),pattern);

    await t.test('anonymous clients cannot bootstrap or read profiles',async()=>{
      await as('anon');await reject('select public.account_bootstrap()',[],/permission denied/);await reject('select * from public.profiles',[],/permission denied/);
    });
    await t.test('verified whitelisted identity bootstraps persistent rows',async()=>{
      await as('authenticated',ids.alice);const a=await account();assert.equal(a.access.role,'user');assert.equal(a.profile.user_id,ids.alice);assert.equal(a.settings.preferences.theme,'light');assert.equal((await account()).profile.version,1);
    });
    await t.test('non-whitelisted and unverified identities cannot bootstrap',async()=>{
      for(const name of ['outsider','unverified']){await as('authenticated',ids[name]);await reject('select public.account_bootstrap()',[],/Access restricted/);}
    });
    await t.test('regular users cannot list, add or revoke members',async()=>{
      await as('authenticated',ids.alice);
      await reject('select public.admin_list_access()',[],/Administrator access required/);
      await reject("select public.admin_set_access('outsider@example.com','admin',true)",[],/Administrator access required/);
      await reject('select public.admin_audit()',[],/Administrator access required/);
    });
    await t.test('direct writes and role metadata tampering cannot grant privileges',async()=>{
      await reject("update private.access_list set role='admin'",[],/permission denied/);
      await reject("update public.profiles set display_name='Hacked'",[],/permission denied/);
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({app_role:'admin',user_metadata:{role:'admin'}})]);
      await reject('select public.admin_list_access()',[],/Administrator access required/);
    });
    await t.test('profile changes persist and reject stale versions or invalid data',async()=>{
      const result=await call("select public.update_profile('Alice','https://example.com/avatar.png','Café shifts',1) as value");assert.equal(result.display_name,'Alice');assert.equal(result.version,2);
      assert.equal((await account()).profile.bio,'Café shifts');
      await assert.rejects(()=>db.query("select public.update_profile('Overwrite','','',1)"),{code:'PT409'});
      await reject("select public.update_profile('Alice','javascript:alert(1)','',2)",[],/check constraint/);
      await reject("select public.update_profile('Alice','https://user:pass@example.com/a','',2)",[],/check constraint/);
      await reject("select public.update_profile('','','',2)",[],/check constraint/);
    });
    await t.test('RLS prevents cross-user reads, including guessed UUID filters',async()=>{
      await as('authenticated',ids.bob);await account();const rows=await db.query('select * from public.profiles');assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].user_id,ids.bob);
      assert.equal((await db.query('select * from public.profiles where user_id=$1',[ids.alice])).rows.length,0);
      assert.equal((await db.query('select * from public.user_settings where user_id=$1',[ids.alice])).rows.length,0);
    });
    await t.test('PATCH merges arbitrary settings and PUT replaces with optimistic locking',async()=>{
      await as('authenticated',ids.alice);
      let r=await call('select public.patch_settings($1::jsonb,1) as value',[JSON.stringify({theme:'dark',custom:{locale:'en-IE'}})]);assert.equal(r.preferences.currency,'EUR');assert.equal(r.preferences.theme,'dark');
      await assert.rejects(()=>db.query("select public.patch_settings('{\"theme\":\"light\"}',1)"),{code:'PT409'});
      r=await call('select public.put_settings($1::jsonb,2) as value',[JSON.stringify({density:'compact'})]);assert.deepEqual(r.preferences,{density:'compact'});
      await reject("select public.patch_settings('{\"notifications\":\"true\"}',3)",[],/Invalid/);
      await reject("select public.patch_settings('[]',3)",[],/JSON object/);
      await reject("select public.patch_settings('{\"theme\":null}',3)",[],/Invalid/);
      await reject('select public.patch_settings($1::jsonb,3)',[JSON.stringify({big:'x'.repeat(17000)})],/16 KB/);
      assert.equal((await account()).settings.version,3);
    });
    await t.test('workspace cloud writes survive another client, CAS rejects conflicts, RLS isolates and revocation blocks',async()=>{
      const payload={version:1,rates:[],shifts:[],payouts:[],rules:{},tax:{test:1}};
      await as('authenticated',ids.bob);await account();
      const saved=await call('select public.save_workspace($1::jsonb,0) as value',[JSON.stringify(payload)]);assert.equal(saved.version,1);
      await as('authenticated',ids.alice);assert.equal(await call('select public.load_workspace() as value'),null);
      assert.equal((await db.query('select * from public.workspaces')).rows.length,0);
      await reject('update public.workspaces set version=999',[],/permission denied/);
      await as('authenticated',ids.bob);const loaded=await call('select public.load_workspace() as value');assert.deepEqual(loaded.payload,payload);
      await assert.rejects(()=>db.query('select public.save_workspace($1::jsonb,0)',[JSON.stringify(payload)]),{code:'PT409'});
      const next=await call('select public.save_workspace($1::jsonb,1) as value',[JSON.stringify(payload)]);assert.equal(next.version,2);
      await as('authenticated',ids.admin);await account();await call("select public.admin_set_access('bob@example.com','user',false) as value");
      await as('authenticated',ids.bob);await reject('select public.load_workspace()',[],/Access restricted/);await reject('select public.save_workspace($1::jsonb,2)',[JSON.stringify(payload)],/Access restricted/);
      assert.equal((await db.query('select * from public.workspaces')).rows.length,0);
      await as('authenticated',ids.admin);await call("select public.admin_set_access('bob@example.com','user',true) as value");await as('authenticated',ids.alice);
    });
    await t.test('database mutation rate limits return an HTTP 429 SQLSTATE',async()=>{
      let a=await account();let hit=false;
      for(let i=0;i<62;i++){
        try{const r=await call('select public.patch_settings($1::jsonb,$2) as value',[JSON.stringify({counter:i}),a.settings.version]);a.settings=r;}
        catch(e){assert.equal(e.code,'PT429');hit=true;break;}
      }
      assert.equal(hit,true);
    });
    await t.test('admin adds normalized email access, binds IDs and creates audit events',async()=>{
      await as('authenticated',ids.admin);await account();
      const r=await call("select public.admin_set_access(' OUTSIDER@EXAMPLE.COM ','user',true) as value");assert.equal(r.email,'outsider@example.com');assert.equal(r.user_id,ids.outsider);
      const audit=await call('select public.admin_audit() as value');assert.ok(audit.length>=2);assert.equal(audit[0].actor_id,ids.admin);
      const list=await call('select public.admin_list_access(0,100) as value');assert.equal(list.length,5);
      await reject('select public.admin_list_access(0,1000)',[],/Invalid pagination/);
    });
    await t.test('admin cannot remove or demote own access',async()=>{
      await reject("select public.admin_set_access('admin@example.com','user',false)",[],/own access/);
    });
    await t.test('revocation blocks existing-token requests and hides rows immediately',async()=>{
      await call("select public.admin_set_access('alice@example.com','user',false) as value");
      await as('authenticated',ids.alice);
      await reject('select public.account_bootstrap()',[],/Access restricted/);
      assert.equal((await db.query('select * from public.profiles')).rows.length,0);
      await reject("select public.patch_settings('{}',3)",[],/Access restricted/);
    });
    await t.test('signup and login hooks deny unauthorized identities at auth issuance',async()=>{
      await as('supabase_auth_admin');
      let r=await call('select public.before_user_created($1::jsonb) as value',[JSON.stringify({user:{email:'unlisted@example.com'}})]);assert.equal(r.error.http_code,403);
      r=await call('select public.before_user_created($1::jsonb) as value',[JSON.stringify({user:{email:'unverified@example.com'}})]);assert.deepEqual(r,{});
      r=await call('select public.custom_access_token($1::jsonb) as value',[JSON.stringify({user_id:ids.alice,claims:{sub:ids.alice}})]);assert.equal(r.error.http_code,403);
      r=await call('select public.custom_access_token($1::jsonb) as value',[JSON.stringify({user_id:ids.bob,claims:{sub:ids.bob}})]);assert.equal(r.claims.app_role,'user');
    });
    await t.test('authenticated clients cannot invoke auth hooks directly',async()=>{
      await as('authenticated',ids.bob);await reject("select public.before_user_created('{}')",[],/permission denied/);await reject("select public.custom_access_token('{}')",[],/permission denied/);
    });
    await t.test('admin permissions are re-evaluated after demotion with same identity',async()=>{
      await as('authenticated',ids.admin);await call("select public.admin_set_access('bob@example.com','admin',true) as value");
      await as('authenticated',ids.bob);await call("select public.admin_set_access('admin@example.com','user',true) as value");
      await as('authenticated',ids.admin);await reject('select public.admin_list_access()',[],/Administrator access required/);
    });
  } finally{await db.close();}
});
