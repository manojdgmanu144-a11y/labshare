-- ============================================================
-- LabShare — Supabase Schema
-- Run this in the Supabase SQL editor (Project > SQL Editor)
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- profiles
-- One row per authenticated user (linked to auth.users).
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text        not null,
  role        text        not null check (role in ('student', 'faculty', 'admin')),
  department  text        not null,
  created_at  timestamptz not null default now()
);

-- Automatically create a profile stub on sign-up (populated by the app)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, role, department)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    coalesce(new.raw_user_meta_data->>'department', 'General')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- equipment
-- ------------------------------------------------------------
create table if not exists public.equipment (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  category    text        not null,
  department  text        not null,
  location    text        not null,
  description text        not null,
  specs       jsonb       not null default '{}',
  status      text        not null default 'available'
                check (status in ('available', 'in_use', 'maintenance', 'retired')),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- access_requests
-- Students submit a project context request; faculty approves.
-- start_time / end_time are the desired booking window.
-- ------------------------------------------------------------
create table if not exists public.access_requests (
  id            uuid        primary key default gen_random_uuid(),
  student_id    uuid        not null references public.profiles (id) on delete cascade,
  equipment_id  uuid        not null references public.equipment  (id) on delete cascade,
  project_title text        not null,
  purpose       text        not null,
  deadline      date        not null,
  start_time    timestamptz not null,
  end_time      timestamptz not null,
  status        text        not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  faculty_note  text,
  created_at    timestamptz not null default now(),
  constraint access_requests_window_check check (end_time > start_time)
);

-- ------------------------------------------------------------
-- bookings
-- Created when an access_request is approved (or for direct booking).
-- ------------------------------------------------------------
create table if not exists public.bookings (
  id            uuid        primary key default gen_random_uuid(),
  equipment_id  uuid        not null references public.equipment      (id) on delete cascade,
  user_id       uuid        not null references public.profiles        (id) on delete cascade,
  request_id    uuid        references public.access_requests (id) on delete set null,
  start_time    timestamptz not null,
  end_time      timestamptz not null,
  status        text        not null default 'confirmed'
                check (status in ('confirmed', 'cancelled', 'completed')),
  created_at    timestamptz not null default now(),
  constraint bookings_window_check check (end_time > start_time)
);

-- Prevent double-booking: no two confirmed bookings for the same equipment
-- may overlap in time.
create or replace function public.check_booking_overlap()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.bookings
    where equipment_id = new.equipment_id
      and status = 'confirmed'
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(start_time, end_time, '[)') && tstzrange(new.start_time, new.end_time, '[)')
  ) then
    raise exception 'Booking overlaps with an existing confirmed booking';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_no_overlap on public.bookings;
create trigger bookings_no_overlap
  before insert or update on public.bookings
  for each row execute procedure public.check_booking_overlap();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.equipment       enable row level security;
alter table public.access_requests enable row level security;
alter table public.bookings        enable row level security;

-- profiles: users see their own row; faculty/admin see all via service role
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- equipment: readable by everyone logged in
create policy "Authenticated users can view equipment"
  on public.equipment for select
  using (auth.role() = 'authenticated');

-- access_requests: students see their own; faculty see all (service role used server-side)
create policy "Students see own requests"
  on public.access_requests for select
  using (auth.uid() = student_id);

create policy "Students create own requests"
  on public.access_requests for insert
  with check (auth.uid() = student_id);

-- bookings: users see their own bookings
create policy "Users see own bookings"
  on public.bookings for select
  using (auth.uid() = user_id);

-- Service role (used by the backend) bypasses RLS automatically.

-- ------------------------------------------------------------
-- Indexes for common query patterns
-- ------------------------------------------------------------
create index if not exists idx_equipment_status      on public.equipment (status);
create index if not exists idx_equipment_department  on public.equipment (department);
create index if not exists idx_bookings_equipment    on public.bookings  (equipment_id, start_time, end_time);
create index if not exists idx_bookings_user         on public.bookings  (user_id);
create index if not exists idx_requests_student      on public.access_requests (student_id);
create index if not exists idx_requests_equipment    on public.access_requests (equipment_id);
create index if not exists idx_requests_status       on public.access_requests (status);
