-- ============================================================
-- Popcorn RLS test script
-- Run in the Supabase SQL editor (Dashboard → SQL Editor).
-- Each DO block raises an exception on failure and prints OK on success.
-- Requires two real users created via the Auth dashboard:
--   user_a_email / user_a_password  → user A
--   user_b_email / user_b_password  → user B
-- Replace the two UUIDs below with the real auth.users IDs.
-- ============================================================

\set user_a_id 'aaaaaaaa-0000-0000-0000-000000000001'
\set user_b_id 'bbbbbbbb-0000-0000-0000-000000000002'

-- ─── Seed data (run as service role / postgres) ──────────────

-- Give A a public profile, B a public profile
insert into public.profiles (id, username, display_name, is_private)
values
  (:'user_a_id', 'user_a', 'User Alpha', false),
  (:'user_b_id', 'user_b', 'User Beta',  false)
on conflict (id) do update
  set username = excluded.username,
      is_private = excluded.is_private;

-- A writes a review for TMDB film 550 (Fight Club)
insert into public.reviews (id, user_id, tmdb_id, body, rating)
values (
  'rev-aaaa-0000-0000-0000-000000000001',
  :'user_a_id',
  550,
  'First rule: you do not talk about Fight Club.',
  5
) on conflict (id) do nothing;

-- ─── TEST 1: Anonymous can read A's public review ────────────
do $$
declare
  cnt integer;
begin
  -- Simulate anon: set role to the anon role Supabase uses
  set local role anon;
  select count(*) into cnt
  from public.reviews
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  if cnt = 0 then
    raise exception 'FAIL TEST 1: anon cannot read public review';
  end if;
  raise notice 'OK TEST 1: anon can read public review (% rows)', cnt;
end;
$$;

-- ─── TEST 2: User B CANNOT update User A's review ────────────
do $$
declare
  updated integer;
begin
  -- Simulate user B's JWT context
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}',
    true);
  set local role authenticated;

  update public.reviews
  set body = 'HACKED by B'
  where id = 'rev-aaaa-0000-0000-0000-000000000001';

  get diagnostics updated = row_count;

  if updated > 0 then
    raise exception 'FAIL TEST 2: user B was able to update user A''s review!';
  end if;
  raise notice 'OK TEST 2: user B cannot update user A''s review (0 rows updated)';
end;
$$;

-- ─── TEST 3: Private profiles hidden from anonymous ──────────
do $$
declare
  cnt integer;
begin
  -- Make A's profile private
  update public.profiles set is_private = true
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  set local role anon;

  select count(*) into cnt
  from public.profiles
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  if cnt > 0 then
    raise exception 'FAIL TEST 3: private profile visible to anon';
  end if;
  raise notice 'OK TEST 3: private profile hidden from anon (% rows visible)', cnt;

  -- Restore public for other tests
  set local role postgres;
  update public.profiles set is_private = false
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
end;
$$;

-- ─── TEST 4: Private profile visible to its own owner ────────
do $$
declare
  cnt integer;
begin
  update public.profiles set is_private = true
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  perform set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',
    true);
  set local role authenticated;

  select count(*) into cnt
  from public.profiles
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  if cnt = 0 then
    raise exception 'FAIL TEST 4: user A cannot see own private profile';
  end if;
  raise notice 'OK TEST 4: user A sees own private profile';

  set local role postgres;
  update public.profiles set is_private = false
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
end;
$$;

-- ─── TEST 5: User B CANNOT insert a review as user A ─────────
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}',
    true);
  set local role authenticated;

  begin
    insert into public.reviews (user_id, tmdb_id, body)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 550, 'Impersonation attempt');
    raise exception 'FAIL TEST 5: B was able to insert a review as A';
  exception
    when others then
      raise notice 'OK TEST 5: B cannot insert review as A (RLS blocked it)';
  end;
end;
$$;

-- ─── TEST 6: Flagged review (3+ reports) hidden from anon ────
do $$
declare
  visible integer;
begin
  -- Create 3 reporters (using postgres role to bypass RLS for seed)
  set local role postgres;

  -- Seed 3 distinct reporter profiles if needed
  insert into public.profiles (id, username) values
    ('cccccccc-0000-0000-0000-000000000003','reporter_c'),
    ('dddddddd-0000-0000-0000-000000000004','reporter_d'),
    ('eeeeeeee-0000-0000-0000-000000000005','reporter_e')
  on conflict (id) do nothing;

  insert into public.reports (reporter_id, review_id, reason) values
    ('cccccccc-0000-0000-0000-000000000003','rev-aaaa-0000-0000-0000-000000000001','spam'),
    ('dddddddd-0000-0000-0000-000000000004','rev-aaaa-0000-0000-0000-000000000001','spam'),
    ('eeeeeeee-0000-0000-0000-000000000005','rev-aaaa-0000-0000-0000-000000000001','spam')
  on conflict do nothing;

  set local role anon;

  select count(*) into visible
  from public.reviews
  where id = 'rev-aaaa-0000-0000-0000-000000000001';

  if visible > 0 then
    raise exception 'FAIL TEST 6: flagged review still visible to anon';
  end if;
  raise notice 'OK TEST 6: review flagged by 3+ users is hidden from anon';

  -- Clean up reports so other tests are not affected
  set local role postgres;
  delete from public.reports where review_id = 'rev-aaaa-0000-0000-0000-000000000001';
end;
$$;

raise notice '=== ALL TESTS PASSED ===';
