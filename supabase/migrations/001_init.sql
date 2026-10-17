-- ============================================================
-- Popcorn – Letterboxd-style social layer
-- Migration 001: initial schema + RLS
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── PROFILES ────────────────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  username      text unique not null,
  display_name  text,
  avatar_url    text,
  bio           text,
  is_private    boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    -- Use the part before @ in email as default username; caller should update
    coalesce(new.raw_user_meta_data->>'username',
             split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── WATCHLIST ───────────────────────────────────────────────
create table public.watchlist (
  user_id   uuid not null references public.profiles on delete cascade,
  tmdb_id   integer not null,
  added_at  timestamptz not null default now(),
  primary key (user_id, tmdb_id)
);

-- ─── DIARY ───────────────────────────────────────────────────
create table public.diary (
  user_id    uuid not null references public.profiles on delete cascade,
  tmdb_id    integer not null,
  watched_on date not null default current_date,
  rating     numeric(2,1) check (rating >= 0.5 and rating <= 5 and
                                  mod(rating * 2, 1) = 0),  -- 0.5 steps
  room_code  text,   -- set when watched in a Popcorn room
  created_at timestamptz not null default now(),
  primary key (user_id, tmdb_id, watched_on)
);

-- ─── REVIEWS ─────────────────────────────────────────────────
create table public.reviews (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles on delete cascade,
  tmdb_id           integer not null,
  body              text not null,
  rating            numeric(2,1) check (rating >= 0.5 and rating <= 5),
  contains_spoilers boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ─── LISTS ───────────────────────────────────────────────────
create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles on delete cascade,
  title       text not null,
  description text,
  is_public   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.list_items (
  list_id  uuid not null references public.lists on delete cascade,
  tmdb_id  integer not null,
  position integer not null default 0,
  primary key (list_id, tmdb_id)
);

-- ─── SOCIAL ──────────────────────────────────────────────────
create table public.follows (
  follower_id uuid not null references public.profiles on delete cascade,
  followee_id uuid not null references public.profiles on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table public.review_likes (
  user_id   uuid not null references public.profiles on delete cascade,
  review_id uuid not null references public.reviews on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, review_id)
);

create table public.reports (
  reporter_id uuid not null references public.profiles on delete cascade,
  review_id   uuid not null references public.reviews on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now(),
  primary key (reporter_id, review_id)
);

-- ─── HELPER: is the owner's profile public? ──────────────────
-- Returns true when the owning profile is NOT private (or viewer is the owner).
create or replace function public.profile_is_visible(owner_id uuid)
returns boolean language sql stable security definer as $$
  select
    case
      when auth.uid() = owner_id then true          -- own data always visible
      else not coalesce((
        select is_private from public.profiles where id = owner_id
      ), false)
    end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles    enable row level security;
alter table public.watchlist   enable row level security;
alter table public.diary       enable row level security;
alter table public.reviews     enable row level security;
alter table public.lists       enable row level security;
alter table public.list_items  enable row level security;
alter table public.follows     enable row level security;
alter table public.review_likes enable row level security;
alter table public.reports     enable row level security;

-- ── profiles ─────────────────────────────────────────────────
create policy "profiles: public read (non-private)"
  on public.profiles for select
  using (public.profile_is_visible(id));

create policy "profiles: owner update"
  on public.profiles for update
  using (auth.uid() = id);

-- ── watchlist ─────────────────────────────────────────────────
create policy "watchlist: visible if profile public or own"
  on public.watchlist for select
  using (public.profile_is_visible(user_id));

create policy "watchlist: owner insert"
  on public.watchlist for insert
  with check (auth.uid() = user_id);

create policy "watchlist: owner delete"
  on public.watchlist for delete
  using (auth.uid() = user_id);

-- ── diary ─────────────────────────────────────────────────────
create policy "diary: visible if profile public or own"
  on public.diary for select
  using (public.profile_is_visible(user_id));

create policy "diary: owner insert"
  on public.diary for insert
  with check (auth.uid() = user_id);

create policy "diary: owner update"
  on public.diary for update
  using (auth.uid() = user_id);

create policy "diary: owner delete"
  on public.diary for delete
  using (auth.uid() = user_id);

-- ── reviews ───────────────────────────────────────────────────
-- Hide reviews flagged by 3+ distinct users (pending moderation)
create policy "reviews: public read (not flagged 3+, profile public or own)"
  on public.reviews for select
  using (
    public.profile_is_visible(user_id)
    and (
      auth.uid() = user_id  -- owner always sees own review
      or (
        select count(distinct reporter_id)
        from public.reports
        where review_id = id
      ) < 3
    )
  );

create policy "reviews: owner insert"
  on public.reviews for insert
  with check (auth.uid() = user_id);

create policy "reviews: owner update"
  on public.reviews for update
  using (auth.uid() = user_id);

create policy "reviews: owner delete"
  on public.reviews for delete
  using (auth.uid() = user_id);

-- ── lists ─────────────────────────────────────────────────────
create policy "lists: public read if is_public and profile public (or own)"
  on public.lists for select
  using (public.profile_is_visible(user_id) and (is_public or auth.uid() = user_id));

create policy "lists: owner insert"
  on public.lists for insert
  with check (auth.uid() = user_id);

create policy "lists: owner update"
  on public.lists for update
  using (auth.uid() = user_id);

create policy "lists: owner delete"
  on public.lists for delete
  using (auth.uid() = user_id);

-- ── list_items ────────────────────────────────────────────────
create policy "list_items: readable if list is readable"
  on public.list_items for select
  using (
    exists (
      select 1 from public.lists l
      where l.id = list_id
        and public.profile_is_visible(l.user_id)
        and (l.is_public or auth.uid() = l.user_id)
    )
  );

create policy "list_items: owner insert"
  on public.list_items for insert
  with check (
    exists (
      select 1 from public.lists l
      where l.id = list_id and l.user_id = auth.uid()
    )
  );

create policy "list_items: owner delete"
  on public.list_items for delete
  using (
    exists (
      select 1 from public.lists l
      where l.id = list_id and l.user_id = auth.uid()
    )
  );

-- ── follows ───────────────────────────────────────────────────
create policy "follows: public read"
  on public.follows for select
  using (true);

create policy "follows: owner insert"
  on public.follows for insert
  with check (auth.uid() = follower_id);

create policy "follows: owner delete"
  on public.follows for delete
  using (auth.uid() = follower_id);

-- ── review_likes ──────────────────────────────────────────────
create policy "review_likes: public read"
  on public.review_likes for select
  using (true);

create policy "review_likes: owner insert"
  on public.review_likes for insert
  with check (auth.uid() = user_id);

create policy "review_likes: owner delete"
  on public.review_likes for delete
  using (auth.uid() = user_id);

-- ── reports ───────────────────────────────────────────────────
-- Insert-only for authenticated users; nobody reads the raw report table via API
create policy "reports: authenticated insert only"
  on public.reports for insert
  with check (auth.uid() = reporter_id and auth.uid() is not null);
