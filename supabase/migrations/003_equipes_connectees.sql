-- =====================================================================
-- Compteur de Miams : le présentateur voit quelles équipes ont un buzzer.
-- À exécuter dans Supabase (SQL Editor → New query → coller → Run),
-- APRÈS 001 et 002. Peut être relancé sans risque.
-- Sans ce script, l'appli marche : seules les pastilles « connecté » manquent.
-- =====================================================================

-- Équipes dont un appareil a donné des nouvelles depuis moins de 60 s.
-- Réservé au présentateur (jeton de la salle). Renvoie par exemple
-- {"ketchup": true, "mayo": false}, ou null si la salle n'existe plus.
create or replace function public.host_seats(p_code text, p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c text := upper(p_code);
begin
  if not public.is_host(c, p_token) then
    return null;
  end if;
  return jsonb_build_object(
    'ketchup', exists (select 1 from public.room_seats s where s.code = c and s.team = 'ketchup' and s.last_seen > now() - interval '60 seconds'),
    'mayo',    exists (select 1 from public.room_seats s where s.code = c and s.team = 'mayo'    and s.last_seen > now() - interval '60 seconds')
  );
end;
$$;

revoke all on function public.host_seats(text, uuid) from public;
grant execute on function public.host_seats(text, uuid) to anon, authenticated;
