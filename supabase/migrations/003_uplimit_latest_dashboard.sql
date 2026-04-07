-- Latest dashboard for anonymous SPA bootstrap + updated_at on fetch-by-token.

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
    'processed_data', processed_data,
    'updated_at', updated_at::text
  )
  into result
  from uplimit_dashboards
  where share_token = p_token
  limit 1;
  return result;
end;
$$;

create or replace function public.get_latest_uplimit_dashboard()
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
    'processed_data', processed_data,
    'updated_at', updated_at::text
  )
  into result
  from uplimit_dashboards
  order by updated_at desc
  limit 1;
  return result;
end;
$$;

revoke all on function public.get_latest_uplimit_dashboard() from public;
grant execute on function public.get_latest_uplimit_dashboard() to anon;
grant execute on function public.get_latest_uplimit_dashboard() to authenticated;

-- Replace body of get_uplimit_dashboard_by_token; re-apply grants (safe if already granted).
grant execute on function public.get_uplimit_dashboard_by_token(text) to anon;
grant execute on function public.get_uplimit_dashboard_by_token(text) to authenticated;
