-- Apply once in Supabase SQL Editor or with `supabase db push`.
-- Nothing is granted until an owner explicitly bootstraps an allowlisted admin.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, supabase_auth_admin;

create table private.access_list (
  email text primary key check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  user_id uuid unique references auth.users(id) on delete set null,
  role text not null default 'user' check (role in ('user','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table private.access_list enable row level security;
grant select on private.access_list to supabase_auth_admin;
create policy auth_hook_read on private.access_list for select to supabase_auth_admin using (true);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'My workspace' check (length(btrim(display_name)) between 1 and 80),
  avatar_url text not null default '' check (avatar_url = '' or (length(avatar_url) <= 2048 and avatar_url ~ '^https://[a-zA-Z0-9][^[:space:]@]*$')),
  bio text not null default '' check (length(bio) <= 1000),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{"theme":"light","notifications":false,"density":"comfortable","currency":"EUR"}'::jsonb,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint preferences_object check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 16384)
);
create table private.access_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  target_email text not null,
  old_value jsonb,
  new_value jsonb not null,
  created_at timestamptz not null default now()
);
create index access_audit_created_idx on private.access_audit (id desc);
create table private.write_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  requests integer not null,
  primary key(user_id, action)
);
alter table private.access_audit enable row level security;
alter table private.write_limits enable row level security;
revoke all on private.access_list, private.access_audit, private.write_limits from public, anon, authenticated;

-- Roles are read from live membership, never editable user_metadata or stale JWT roles.
create function private.current_access() returns private.access_list
language plpgsql stable security definer set search_path = '' as $$
declare member private.access_list;
begin
  select a.* into member from private.access_list a join auth.users u on u.id = auth.uid()
  where a.email = lower(btrim(u.email)) and a.active and u.email_confirmed_at is not null
    and (a.user_id is null or a.user_id = u.id);
  if not found then raise exception 'Access restricted. Contact an administrator.' using errcode = '42501'; end if;
  return member;
end $$;
create function private.is_active_user() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin perform private.current_access(); return true;
exception when insufficient_privilege then return false;
end $$;
create function private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (private.current_access()).role <> 'admin' then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
end $$;
create function private.limit_write(p_action text, p_limit integer) returns void
language plpgsql security definer set search_path = '' as $$
declare hits integer;
begin
  insert into private.write_limits as bucket(user_id,action,window_start,requests)
  values(auth.uid(),p_action,date_trunc('minute',clock_timestamp()),1)
  on conflict(user_id,action) do update set
    window_start = excluded.window_start,
    requests = case when bucket.window_start = excluded.window_start then bucket.requests + 1 else 1 end
  returning requests into hits;
  if hits > p_limit then raise exception 'Too many changes. Please wait a minute.' using errcode = 'PT429'; end if;
end $$;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
revoke all on public.profiles, public.user_settings from public, anon, authenticated;
grant select on public.profiles, public.user_settings to authenticated;
create policy own_profile on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()));
create policy own_settings on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()));

create function private.account_bootstrap() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.access_list;
begin
  member := private.current_access();
  -- Bind an email invitation to the first verified identity. Recheck after a concurrent bind.
  update private.access_list set user_id = auth.uid() where email = member.email and user_id is null;
  member := private.current_access();
  insert into public.profiles(user_id) values(auth.uid()) on conflict do nothing;
  insert into public.user_settings(user_id) values(auth.uid()) on conflict do nothing;
  return jsonb_build_object('access',jsonb_build_object('email',member.email,'role',member.role),
    'profile',(select to_jsonb(p) from public.profiles p where p.user_id = auth.uid()),
    'settings',(select to_jsonb(s) from public.user_settings s where s.user_id = auth.uid()));
end $$;
create function public.account_bootstrap() returns jsonb language sql security invoker set search_path = ''
  as $$ select private.account_bootstrap(); $$;

create function private.update_profile(p_display_name text, p_avatar_url text, p_bio text, p_expected_version bigint) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare result public.profiles;
begin
  perform private.current_access(); perform private.limit_write('profile',60);
  update public.profiles set display_name = btrim(p_display_name), avatar_url = btrim(p_avatar_url), bio = p_bio,
    version = version + 1, updated_at = clock_timestamp()
  where user_id = auth.uid() and version = p_expected_version returning * into result;
  if not found then raise exception 'Profile changed in another session. Reload account and retry.' using errcode = 'PT409'; end if;
  return result;
end $$;
create function public.update_profile(p_display_name text, p_avatar_url text, p_bio text, p_expected_version bigint) returns jsonb
language sql security invoker set search_path = '' as $$ select to_jsonb(private.update_profile(p_display_name,p_avatar_url,p_bio,p_expected_version)); $$;

create function private.validate_preferences(p jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 16384 then
    raise exception 'Preferences must be a JSON object under 16 KB.' using errcode = '22023';
  end if;
  if (p ? 'theme' and (jsonb_typeof(p->'theme') <> 'string' or p->>'theme' not in ('light','dark')))
    or (p ? 'density' and (jsonb_typeof(p->'density') <> 'string' or p->>'density' not in ('comfortable','compact')))
    or (p ? 'currency' and (jsonb_typeof(p->'currency') <> 'string' or p->>'currency' not in ('EUR','GBP','USD','CAD','AUD')))
    or (p ? 'notifications' and jsonb_typeof(p->'notifications') <> 'boolean') then
    raise exception 'Invalid theme, density, currency or notifications preference.' using errcode = '22023';
  end if;
end $$;
create function private.save_settings(p_preferences jsonb, p_expected_version bigint, p_merge boolean) returns public.user_settings
language plpgsql security definer set search_path = '' as $$
declare result public.user_settings; next_preferences jsonb;
begin
  perform private.current_access(); perform private.limit_write('settings',60);
  perform private.validate_preferences(p_preferences);
  select * into result from public.user_settings where user_id = auth.uid() for update;
  if not found or result.version <> p_expected_version or p_expected_version is null then
    raise exception 'Settings changed in another session. Reload account and retry.' using errcode = 'PT409';
  end if;
  -- PATCH is a shallow top-level merge. Nested values replace as a whole; null is a stored value.
  next_preferences := case when p_merge then result.preferences || p_preferences else p_preferences end;
  perform private.validate_preferences(next_preferences);
  update public.user_settings set preferences = next_preferences, version = version + 1, updated_at = clock_timestamp()
  where user_id = auth.uid() returning * into result;
  return result;
end $$;
create function public.put_settings(p_preferences jsonb, p_expected_version bigint) returns jsonb
language sql security invoker set search_path = '' as $$ select to_jsonb(private.save_settings(p_preferences,p_expected_version,false)); $$;
create function public.patch_settings(p_preferences jsonb, p_expected_version bigint) returns jsonb
language sql security invoker set search_path = '' as $$ select to_jsonb(private.save_settings(p_preferences,p_expected_version,true)); $$;

create function private.admin_list_access(p_offset integer, p_limit integer) returns setof private.access_list
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_offset < 0 or p_offset is null or p_limit not between 1 and 100 or p_limit is null then raise exception 'Invalid pagination.' using errcode = '22023'; end if;
  return query select a.* from private.access_list a order by a.email offset p_offset limit p_limit;
end $$;
-- Return JSON so no private composite type is exposed in the REST schema.
create function public.admin_list_access(p_offset integer default 0, p_limit integer default 50) returns jsonb
language sql security invoker set search_path = '' as $$ select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from private.admin_list_access(p_offset,p_limit) a; $$;

create function private.admin_set_access(p_email text, p_role text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare normalized text := lower(btrim(p_email)); before_value jsonb; result private.access_list;
begin
  -- Serialize changes so concurrent demotions cannot remove every administrator.
  perform pg_advisory_xact_lock(7429132);
  perform private.require_admin(); perform private.limit_write('access',30);
  if p_role is null or p_role not in ('user','admin') or p_active is null or normalized is null then
    raise exception 'Invalid role, active flag or email.' using errcode = '22023'; end if;
  if normalized = (private.current_access()).email then
    raise exception 'You cannot change your own access. Ask another administrator.' using errcode = '22023'; end if;
  select to_jsonb(a) into before_value from private.access_list a where a.email = normalized;
  insert into private.access_list as a(email,user_id,role,active,updated_by)
    values(normalized,(select u.id from auth.users u where lower(btrim(u.email)) = normalized),p_role,p_active,auth.uid())
    on conflict(email) do update set role=excluded.role,active=excluded.active,updated_at=clock_timestamp(),updated_by=auth.uid()
    returning * into result;
  if not exists(select 1 from private.access_list where active and role='admin') then
    raise exception 'At least one active administrator is required.' using errcode='22023'; end if;
  insert into private.access_audit(actor_id,target_email,old_value,new_value) values(auth.uid(),normalized,before_value,to_jsonb(result));
  return to_jsonb(result);
end $$;
create function public.admin_set_access(p_email text, p_role text default 'user', p_active boolean default true) returns jsonb
language sql security invoker set search_path = '' as $$ select private.admin_set_access(p_email,p_role,p_active); $$;
create function private.admin_audit(p_before bigint, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid page size.' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from
    (select * from private.access_audit where p_before is null or id < p_before order by id desc limit p_limit) a);
end $$;
create function public.admin_audit(p_before bigint default null, p_limit integer default 50) returns jsonb
language sql security invoker set search_path = '' as $$ select private.admin_audit(p_before,p_limit); $$;

-- Auth hooks run as supabase_auth_admin (invoker); only narrowly scoped reads are granted.
create function public.before_user_created(event jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from private.access_list a where a.email = lower(btrim(event->'user'->>'email')) and a.active and a.user_id is null) then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Access restricted. Contact an administrator.'));
  end if;
  return '{}'::jsonb;
end $$;
create function public.custom_access_token(event jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare member private.access_list;
begin
  select a.* into member from private.access_list a join auth.users u on u.id = (event->>'user_id')::uuid
  where a.email = lower(btrim(u.email)) and a.active and u.email_confirmed_at is not null
    and (a.user_id is null or a.user_id = u.id);
  if not found then return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Access restricted. Contact an administrator.')); end if;
  return jsonb_build_object('claims',jsonb_set(event->'claims','{app_role}',to_jsonb(member.role)));
end $$;

-- Supabase projects may have permissive default grants. Revoke every function explicitly.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.current_access(), private.is_active_user(), private.account_bootstrap(),
  private.update_profile(text,text,text,bigint), private.save_settings(jsonb,bigint,boolean),
  private.admin_list_access(integer,integer), private.admin_set_access(text,text,boolean), private.admin_audit(bigint,integer) to authenticated;
revoke all on function public.account_bootstrap(), public.update_profile(text,text,text,bigint),
  public.put_settings(jsonb,bigint), public.patch_settings(jsonb,bigint), public.admin_list_access(integer,integer),
  public.admin_set_access(text,text,boolean), public.admin_audit(bigint,integer) from public, anon, authenticated;
grant execute on function public.account_bootstrap(), public.update_profile(text,text,text,bigint),
  public.put_settings(jsonb,bigint), public.patch_settings(jsonb,bigint), public.admin_list_access(integer,integer),
  public.admin_set_access(text,text,boolean), public.admin_audit(bigint,integer) to authenticated;
revoke all on function public.before_user_created(jsonb), public.custom_access_token(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created(jsonb), public.custom_access_token(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
commit;
