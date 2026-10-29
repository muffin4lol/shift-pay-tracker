-- Run as the project owner in SQL Editor, after applying the migration.
-- Replace this value with the exact email you will verify at signup.
do $$
declare administrator_email text := 'REPLACE_WITH_YOUR_EMAIL'; prior jsonb; result jsonb;
begin
  administrator_email := lower(btrim(administrator_email));
  if administrator_email not like '%@%.%' then raise exception 'Replace REPLACE_WITH_YOUR_EMAIL before running this script.'; end if;
  select to_jsonb(a) into prior from private.access_list a where email=administrator_email;
  insert into private.access_list as a(email,role,active) values(administrator_email,'admin',true)
    on conflict(email) do update set role='admin',active=true,updated_at=clock_timestamp()
    returning to_jsonb(a) into result;
  insert into private.access_audit(actor_id,target_email,old_value,new_value) values(null,administrator_email,prior,result);
end $$;
