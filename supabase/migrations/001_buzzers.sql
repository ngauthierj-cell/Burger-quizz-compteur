-- =====================================================================
-- Compteur de Miams : mode « Buzzers connectés »
-- À exécuter une fois dans Supabase : SQL Editor → New query → coller → Run.
-- Le script peut être relancé sans risque (il remplace ce qu'il a créé).
--
-- Principe :
--   * une salle = une ligne de « rooms », identifiée par un code de 4 lettres ;
--   * le front ne peut que LIRE les salles non expirées (RLS) ;
--   * toute écriture passe par les fonctions ci-dessous (security definer) ;
--   * les actions du présentateur exigent le jeton secret reçu à la création
--     de la salle, rangé dans « room_secrets », table illisible depuis le front ;
--   * c'est le serveur qui décide du premier buzz : un seul UPDATE atomique
--     « ... WHERE buzzed_team IS NULL ».
-- Aucune donnée personnelle, aucun compte.
-- =====================================================================

-- ---------- Tables ----------
create table if not exists public.rooms (
  code            text primary key check (code ~ '^[A-Z]{4}$'),
  buzzers_enabled boolean     not null default true,
  buzzed_team     text        check (buzzed_team in ('ketchup', 'mayo')),
  buzzed_at       timestamptz,
  -- Numéro de question : +1 à chaque déblocage. Un buzz parti pendant la
  -- question précédente (réseau lent) ne compte pas pour la suivante.
  question        integer     not null default 0,
  -- Récap publié par le présentateur (scores, objectif, manche, Burger de la Mort)
  recap           jsonb       not null default '{}'::jsonb,
  -- Salle fermée par le présentateur : la ligne reste visible quelques minutes
  -- pour que les buzzers l'apprennent en temps réel, puis le ménage la supprime.
  closed          boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '12 hours'
);

create table if not exists public.room_secrets (
  code       text primary key references public.rooms (code) on delete cascade,
  host_token uuid not null default gen_random_uuid()
);

create index if not exists rooms_expires_at_idx on public.rooms (expires_at);

-- ---------- Sécurité : RLS ----------
alter table public.rooms enable row level security;
alter table public.room_secrets enable row level security;

-- Le front n'a aucun droit d'écriture direct, et ne voit jamais les jetons
revoke all on public.rooms from anon, authenticated;
revoke all on public.room_secrets from anon, authenticated;
grant select on public.rooms to anon, authenticated;

-- Lecture d'une salle tant qu'elle n'a pas expiré (le front la demande par son code).
-- Aucune politique sur room_secrets : illisible pour anon / authenticated.
drop policy if exists "lecture des salles actives" on public.rooms;
create policy "lecture des salles actives" on public.rooms
  for select to anon, authenticated
  using (expires_at > now());

-- ---------- Fonctions ----------

-- Supprime les salles expirées (appelée à chaque création de salle,
-- et éventuellement par pg_cron : voir tout en bas).
create or replace function public.cleanup_expired_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.rooms where expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Crée une salle et renvoie son code + le jeton du présentateur
create or replace function public.create_room()
returns table (code text, host_token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Sans I ni O : pas de confusion avec 1 et 0 quand on recopie le code
  letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  c text;
  i integer;
  tries integer := 0;
begin
  perform public.cleanup_expired_rooms();
  loop
    tries := tries + 1;
    c := '';
    for i in 1..4 loop
      c := c || substr(letters, 1 + floor(random() * length(letters))::integer, 1);
    end loop;
    begin
      insert into public.rooms (code) values (c);
      exit;
    exception when unique_violation then
      if tries >= 50 then
        raise exception 'Aucun code de salle disponible';
      end if;
    end;
  end loop;
  insert into public.room_secrets (code) values (c);
  return query
    select r.code, s.host_token, r.expires_at
    from public.rooms r join public.room_secrets s on s.code = r.code
    where r.code = c;
end;
$$;

-- Le buzz : un seul UPDATE atomique, c'est le serveur qui tranche.
-- Renvoie true si ce buzz a pris la main, false sinon (trop tard, buzzers en
-- pause, salle expirée, ou buzz parti pendant une question précédente).
create or replace function public.buzz(p_code text, p_team text, p_question integer default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_team not in ('ketchup', 'mayo') then
    return false;
  end if;
  update public.rooms
     set buzzed_team = p_team,
         buzzed_at   = now(),
         updated_at  = now()
   where code = upper(p_code)
     and buzzed_team is null
     and buzzers_enabled
     and not closed
     and expires_at > now()
     and (p_question is null or question = p_question);
  return found;
end;
$$;

-- Vérifie le jeton du présentateur (usage interne)
create or replace function public.is_host(p_code text, p_token uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_secrets s
    join public.rooms r on r.code = s.code
    where s.code = upper(p_code)
      and s.host_token = p_token
      and not r.closed
      and r.expires_at > now()
  );
$$;

-- Débloque les buzzers pour la question suivante
create or replace function public.host_unlock(p_code text, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_host(p_code, p_token) then
    return false;
  end if;
  update public.rooms
     set buzzed_team = null,
         buzzed_at   = null,
         question    = question + 1,
         updated_at  = now()
   where code = upper(p_code);
  return true;
end;
$$;

-- Active / met en pause les buzzers (ex. en pause pendant les Menus).
-- Repart toujours d'une question vierge.
create or replace function public.host_set_enabled(p_code text, p_token uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_host(p_code, p_token) then
    return false;
  end if;
  update public.rooms
     set buzzers_enabled = coalesce(p_enabled, true),
         buzzed_team     = null,
         buzzed_at       = null,
         question        = question + 1,
         updated_at      = now()
   where code = upper(p_code);
  return true;
end;
$$;

-- Publie le récap (le présentateur reste la source de vérité des scores)
create or replace function public.host_publish(p_code text, p_token uuid, p_recap jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_host(p_code, p_token) then
    return false;
  end if;
  if p_recap is null or jsonb_typeof(p_recap) <> 'object' or octet_length(p_recap::text) > 4000 then
    return false;
  end if;
  update public.rooms
     set recap      = p_recap,
         updated_at = now()
   where code = upper(p_code);
  return true;
end;
$$;

-- Ferme la salle (le présentateur repasse en local). Pas de DELETE direct :
-- le temps réel ne sait pas filtrer les suppressions par salle, alors on
-- marque la salle fermée (les buzzers le voient) et elle expire 10 min après.
create or replace function public.host_close(p_code text, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_host(p_code, p_token) then
    return false;
  end if;
  update public.rooms
     set closed          = true,
         buzzers_enabled = false,
         buzzed_team     = null,
         buzzed_at       = null,
         updated_at      = now(),
         expires_at      = least(expires_at, now() + interval '10 minutes')
   where code = upper(p_code);
  return true;
end;
$$;

-- Droits d'exécution : seulement les fonctions utiles au front
revoke all on function public.cleanup_expired_rooms() from public, anon, authenticated;
revoke all on function public.is_host(text, uuid) from public, anon, authenticated;
revoke all on function public.create_room() from public;
revoke all on function public.buzz(text, text, integer) from public;
revoke all on function public.host_unlock(text, uuid) from public;
revoke all on function public.host_set_enabled(text, uuid, boolean) from public;
revoke all on function public.host_publish(text, uuid, jsonb) from public;
revoke all on function public.host_close(text, uuid) from public;
grant execute on function public.create_room() to anon, authenticated;
grant execute on function public.buzz(text, text, integer) to anon, authenticated;
grant execute on function public.host_unlock(text, uuid) to anon, authenticated;
grant execute on function public.host_set_enabled(text, uuid, boolean) to anon, authenticated;
grant execute on function public.host_publish(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.host_close(text, uuid) to anon, authenticated;

-- ---------- Temps réel ----------
-- Les appareils s'abonnent aux changements de leur salle (filtre code=eq.XXXX).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end;
$$;

-- ---------- Nettoyage automatique (facultatif) ----------
-- Les salles expirées sont déjà illisibles et supprimées à chaque nouvelle salle.
-- Pour un ménage horaire en plus : Database → Extensions → activer « pg_cron »,
-- puis exécuter :
--
--   select cron.schedule('miams-salles-expirees', '17 * * * *',
--                        'select public.cleanup_expired_rooms()');
