-- ============================================
-- Series Tracker - Esquema Supabase
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================

-- Series que cada usuario sigue
create table public.tracked_shows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  tmdb_id integer not null,
  name text not null,
  poster_path text,
  status text not null default 'plan_to_watch', -- plan_to_watch | watching | completed | dropped
  total_episodes integer default 0,
  added_at timestamptz default now(),
  last_watched_at timestamptz,
  unique (user_id, tmdb_id)
);

-- Episodios marcados como vistos
create table public.watched_episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  tracked_show_id uuid references public.tracked_shows(id) on delete cascade not null,
  season_number integer not null,
  episode_number integer not null,
  watched_at timestamptz default now(),
  unique (tracked_show_id, season_number, episode_number)
);

-- Índices para las consultas de ordenación/listado
create index idx_tracked_shows_user on public.tracked_shows(user_id);
create index idx_watched_episodes_show on public.watched_episodes(tracked_show_id);

-- Row Level Security: cada usuario solo ve/edita lo suyo
alter table public.tracked_shows enable row level security;
alter table public.watched_episodes enable row level security;

create policy "Users manage their own tracked shows"
  on public.tracked_shows for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own watched episodes"
  on public.watched_episodes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
