-- Client-side (anon key) access for static hosting (e.g. GitHub Pages).
-- Run after 001. Exposes SECURITY DEFINER RPCs so RLS does not allow broad SELECT.

create or replace function public.get_uplimit_dashboard_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'share_token', share_token,
    'program_name', program_name,
    'processed_data', processed_data
  )
  into result
  from uplimit_dashboards
  where share_token = p_token
  limit 1;
  return result;
end;
$$;

create or replace function public.create_uplimit_dashboard(
  p_program_name text,
  p_processed_data jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_token text;
begin
  insert into uplimit_dashboards (program_name, processed_data)
  values (
    coalesce(nullif(trim(p_program_name), ''), 'Training Dashboard'),
    p_processed_data
  )
  returning share_token into new_token;
  return new_token;
end;
$$;

create or replace function public.patch_uplimit_dashboard_by_token(
  p_token text,
  p_program_name text,
  p_processed_data jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  update uplimit_dashboards
  set
    program_name = coalesce(nullif(trim(p_program_name), ''), program_name),
    processed_data = p_processed_data
  where share_token = p_token
  returning share_token into t;
  if t is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return t;
end;
$$;

revoke all on function public.get_uplimit_dashboard_by_token(text) from public;
revoke all on function public.create_uplimit_dashboard(text, jsonb) from public;
revoke all on function public.patch_uplimit_dashboard_by_token(text, text, jsonb) from public;

grant execute on function public.get_uplimit_dashboard_by_token(text) to anon;
grant execute on function public.create_uplimit_dashboard(text, jsonb) to anon;
grant execute on function public.patch_uplimit_dashboard_by_token(text, text, jsonb) to anon;

grant execute on function public.get_uplimit_dashboard_by_token(text) to authenticated;
grant execute on function public.create_uplimit_dashboard(text, jsonb) to authenticated;
grant execute on function public.patch_uplimit_dashboard_by_token(text, text, jsonb) to authenticated;
