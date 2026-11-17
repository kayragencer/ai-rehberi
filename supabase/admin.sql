-- Senin Yapay Zekan - yonetici paneli ve hesap silme

-- Yonetici listesi
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "admin: kendini gor" on public.admins;
create policy "admin: kendini gor" on public.admins for select to authenticated using (user_id = auth.uid());
grant select on public.admins to authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- Yorumlar: yonetici hepsini gorur, gizler/acar, siler
drop policy if exists "yorum: admin gorur" on public.reviews;
drop policy if exists "yorum: admin gunceller" on public.reviews;
drop policy if exists "yorum: admin siler" on public.reviews;
create policy "yorum: admin gorur" on public.reviews for select to authenticated using (public.is_admin());
create policy "yorum: admin gunceller" on public.reviews for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "yorum: admin siler" on public.reviews for delete to authenticated using (public.is_admin());
grant update (hidden) on public.reviews to authenticated;

-- Sikayetler: yonetici gorur ve temizler
drop policy if exists "sikayet: admin gorur" on public.review_reports;
drop policy if exists "sikayet: admin siler" on public.review_reports;
create policy "sikayet: admin gorur" on public.review_reports for select to authenticated using (public.is_admin());
create policy "sikayet: admin siler" on public.review_reports for delete to authenticated using (public.is_admin());
grant select, delete on public.review_reports to authenticated;

-- Panel istatistikleri (sadece yonetici)
create or replace function public.admin_stats() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'yetki yok'; end if;
  return json_build_object(
    'users', (select count(*) from auth.users),
    'reviews', (select count(*) from public.reviews),
    'hidden', (select count(*) from public.reviews where hidden),
    'reports', (select count(*) from public.review_reports),
    'favorites', (select count(*) from public.favorites));
end; $$;
revoke execute on function public.admin_stats() from anon;
grant execute on function public.admin_stats() to authenticated;

-- Kullanici kendi hesabini tamamen silebilsin (tum verisi de silinir)
create or replace function public.delete_me() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end; $$;
revoke execute on function public.delete_me() from anon;
grant execute on function public.delete_me() to authenticated;
