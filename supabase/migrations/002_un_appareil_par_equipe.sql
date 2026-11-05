-- =====================================================================
-- Compteur de Miams : un seul appareil buzzer par équipe et par salle.
-- À exécuter dans Supabase (SQL Editor → New query → coller → Run),
-- APRÈS 001_buzzers.sql. Peut être relancé sans risque.
--
-- Chaque appareil buzzer a un identifiant aléatoire (aucune donnée personnelle).
-- Il réserve la place de son équipe (ou les deux, pour l'écran partagé) et la
-- confirme toutes les 20 s. Une place non confirmée depuis 60 s est libre :
-- un téléphone éteint ou parti ne bloque pas son équipe.
-- Seul l'appareil qui tient la place peut buzzer pour cette équipe.
-- =====================================================================

create table if not exists public.room_seats (
  code      text        not null references public.rooms (code) on delete cascade,
  team      text        not null check (team in ('ketchup', 'mayo')),
  device    uuid        not null,
  last_seen timestamptz not null default now(),
  primary key (code, team)
);

-- Illisible et non modifiable depuis le front : tout passe par les fonctions
alter table public.room_seats enable row level security;
revoke all on public.room_seats from anon, authenticated;

-- Réserve (ou confirme) les places demandées pour cet appareil.
-- Renvoie 'ok', 'taken' (une place est tenue par un autre appareil)
-- ou 'no_room' (salle introuvable, fermée ou expirée).
create or replace function public.claim_seats(p_code text, p_teams text[], p_device uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := upper(p_code);
begin
  if p_device is null or p_teams is null or cardinality(p_teams) not between 1 and 2
     or exists (select 1 from unnest(p_teams) t where t not in ('ketchup', 'mayo')) then
    return 'taken';
  end if;
  -- Verrou sur la salle : deux appareils qui arrivent en même temps passent l'un après l'autre
  perform 1 from public.rooms r
   where r.code = c and not r.closed and r.expires_at > now()
   for update;
  if not found then
    return 'no_room';
  end if;
  if exists (
    select 1 from public.room_seats s
     where s.code = c and s.team = any (p_teams)
       and s.device <> p_device
       and s.last_seen > now() - interval '60 seconds'
  ) then
    return 'taken';
  end if;
  insert into public.room_seats (code, team, device, last_seen)
  select c, t, p_device, now() from (select distinct unnest(p_teams) as t) x
  on conflict (code, team) do update set device = excluded.device, last_seen = now();
  return 'ok';
end;
$$;

-- Libère les places de cet appareil (bouton Quitter)
create or replace function public.release_seats(p_code text, p_device uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.room_seats where code = upper(p_code) and device = p_device;
  return true;
end;
$$;

-- Le buzz exige maintenant l'identifiant de l'appareil qui tient la place
drop function if exists public.buzz(text, text, integer);
create or replace function public.buzz(p_code text, p_team text, p_question integer, p_device uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := upper(p_code);
begin
  if p_team not in ('ketchup', 'mayo') or p_device is null then
    return false;
  end if;
  if not exists (
    select 1 from public.room_seats s
     where s.code = c and s.team = p_team and s.device = p_device
  ) then
    return false;
  end if;
  update public.rooms
     set buzzed_team = p_team,
         buzzed_at   = now(),
         updated_at  = now()
   where code = c
     and buzzed_team is null
     and buzzers_enabled
     and not closed
     and expires_at > now()
     and (p_question is null or question = p_question);
  return found;
end;
$$;

revoke all on function public.claim_seats(text, text[], uuid) from public;
revoke all on function public.release_seats(text, uuid) from public;
revoke all on function public.buzz(text, text, integer, uuid) from public;
grant execute on function public.claim_seats(text, text[], uuid) to anon, authenticated;
grant execute on function public.release_seats(text, uuid) to anon, authenticated;
grant execute on function public.buzz(text, text, integer, uuid) to anon, authenticated;
