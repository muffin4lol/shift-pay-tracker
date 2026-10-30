-- Run AFTER 202610290001_accounts.sql. Atomic version checks prevent lost updates.
begin;
create table public.workspaces (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null check (jsonb_typeof(payload)='object' and payload->>'version'='1' and jsonb_typeof(payload->'rates')='array' and jsonb_typeof(payload->'shifts')='array' and jsonb_typeof(payload->'payouts')='array' and jsonb_typeof(payload->'rules')='object' and octet_length(payload::text)<=10000000),
 version bigint not null default 1,
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.workspaces enable row level security;
revoke all on public.workspaces from public,anon,authenticated;
grant select on public.workspaces to authenticated;
create policy workspace_owner on public.workspaces for select to authenticated
 using(user_id=auth.uid() and private.is_active_user());
create function private.load_workspace() returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workspaces;
begin perform private.current_access(); select * into r from public.workspaces where user_id=auth.uid();
 if not found then return null; end if; return to_jsonb(r); end $$;
create function private.save_workspace(p_payload jsonb,p_expected_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workspaces;
begin
 perform private.current_access(); perform private.limit_write('workspace',120);
 if p_expected_version=0 then
  insert into public.workspaces(user_id,payload) values(auth.uid(),p_payload) on conflict do nothing returning * into r;
 else
  update public.workspaces set payload=p_payload,version=version+1,updated_at=clock_timestamp()
   where user_id=auth.uid() and version=p_expected_version returning * into r;
 end if;
 if r.user_id is null then raise exception 'A newer cloud version exists. Review before replacing it.' using errcode='PT409'; end if;
 return to_jsonb(r);
end $$;
create function public.load_workspace() returns jsonb language sql security invoker set search_path='' as $$select private.load_workspace()$$;
create function public.save_workspace(p_payload jsonb,p_expected_version bigint) returns jsonb language sql security invoker set search_path='' as $$select private.save_workspace(p_payload,p_expected_version)$$;
revoke all on function private.load_workspace(),private.save_workspace(jsonb,bigint),public.load_workspace(),public.save_workspace(jsonb,bigint) from public,anon;
grant execute on function private.load_workspace(),private.save_workspace(jsonb,bigint),public.load_workspace(),public.save_workspace(jsonb,bigint) to authenticated;
commit;
