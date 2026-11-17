-- Senin Yapay Zekan - veritabani kurulumu (Supabase)
-- Tablolar: profiles, favorites, reviews, review_reports

-- 1) Profiller (her kullanici icin bir satir)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 60),
  avatar text not null default '' check (char_length(avatar) <= 16),
  bio text not null default '' check (char_length(bio) <= 300),
  job text not null default '' check (char_length(job) <= 60),
  city text not null default '' check (char_length(city) <= 60),
  interests text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profil: kendini gor" on public.profiles;
drop policy if exists "profil: kendini guncelle" on public.profiles;
create policy "profil: kendini gor" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profil: kendini guncelle" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Kayit olunca profil satirini otomatik olustur
create or replace function public.yeni_kullanici() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'name', ''), 60))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.yeni_kullanici();

-- 2) Favoriler
create table if not exists public.favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('tool', 'plugin', 'ebook')),
  item_id text not null check (char_length(item_id) <= 120),
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);
alter table public.favorites enable row level security;
drop policy if exists "favori: sadece kendi" on public.favorites;
create policy "favori: sadece kendi" on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3) Yorumlar (herkes okur, giris yapan yazar, sadece sahibi siler)
create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  tool_id text not null check (char_length(tool_id) <= 120),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author text not null default '',
  body text not null check (char_length(btrim(body)) between 2 and 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists reviews_tool_idx on public.reviews (tool_id, created_at desc);
alter table public.reviews enable row level security;
drop policy if exists "yorum: herkes okur" on public.reviews;
drop policy if exists "yorum: giris yapan yazar" on public.reviews;
drop policy if exists "yorum: sahibi siler" on public.reviews;
create policy "yorum: herkes okur" on public.reviews for select to anon, authenticated using (hidden = false);
create policy "yorum: giris yapan yazar" on public.reviews for insert to authenticated with check (user_id = auth.uid());
create policy "yorum: sahibi siler" on public.reviews for delete to authenticated using (user_id = auth.uid());

-- Yorum yazilirken yazar adini profilden al (baskasinin adiyla yazilamasin), gizli baslamasin
create or replace function public.yorum_hazirla() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.hidden := false;
  new.author := coalesce(nullif((select name from public.profiles where id = auth.uid()), ''), 'Kullan' || chr(305) || 'c' || chr(305));
  return new;
end; $$;
drop trigger if exists yorum_hazirla on public.reviews;
create trigger yorum_hazirla before insert on public.reviews
  for each row execute function public.yorum_hazirla();

-- 4) Sikayetler (kisi basi bir yorum icin bir kez; 3 sikayette yorum gizlenir)
create table if not exists public.review_reports (
  id bigint generated always as identity primary key,
  review_id bigint not null references public.reviews(id) on delete cascade,
  reporter uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  unique (review_id, reporter)
);
alter table public.review_reports enable row level security;
drop policy if exists "sikayet: giris yapan bildirir" on public.review_reports;
create policy "sikayet: giris yapan bildirir" on public.review_reports for insert to authenticated with check (reporter = auth.uid());

create or replace function public.sikayet_say() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.review_reports where review_id = new.review_id) >= 3 then
    update public.reviews set hidden = true where id = new.review_id;
  end if;
  return new;
end; $$;
drop trigger if exists sikayet_say on public.review_reports;
create trigger sikayet_say after insert on public.review_reports
  for each row execute function public.sikayet_say();

-- Tablo izinleri (RLS kurallari yine gecerli)
grant select on public.reviews to anon;
grant select, insert, delete on public.reviews to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant insert on public.review_reports to authenticated;
revoke all on public.review_reports from anon;
