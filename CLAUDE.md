# Compteur de Miams : compte rendu pour reprendre le développement

Appli web (PWA) de comptage de points pour un quiz entre amis façon « Burger Quiz » :
équipes **Ketchup** et **Mayo**, 5 manches, Burger de la Mort, récap, sons. En option,
des **buzzers** sur les téléphones des joueurs (via Supabase). Interface **en français**,
style **diner années 50** (tuiles de lettres, bandes rouges et jaunes, gros boutons, pensé mobile).

## L'utilisateur et sa façon de travailler

- Il pilote souvent **depuis son téléphone** : lui donner des étapes courtes, en français,
  avec des liens directs. Il fusionne lui-même les pull requests.
- Quand il le demande, **proposer un plan (ou des maquettes) et attendre sa validation** avant de coder.
- Livraison : une branche → **pull request vers `claude/burger-quiz-app-s9g618`**, qui est la
  branche par défaut et celle publiée. Une PR fusionnée est terminée : la suite repart
  d'une nouvelle branche créée à partir de la branche par défaut.
- À **chaque publication**, incrémenter `CACHE` dans `sw.js` (actuellement `miams-v15`).
  Sans ça, les appareils gardent l'ancienne version.
- Si une PR ajoute un script SQL, lui dire de **le lancer dans Supabase AVANT de fusionner**
  (SQL Editor → nouvelle requête → coller le contenu du fichier → Run).

## Hébergement et configuration

- **GitHub Pages** (source : GitHub Actions), `.github/workflows/pages.yml`, déclenché par un push
  sur `claude/burger-quiz-app-s9g618`. Ne publie que : `index.html sw.js manifest.webmanifest icons
  qr.js buzzers.js config.js vendor`. Pour ajouter un fichier à l'appli, **l'ajouter aussi dans ce workflow**.
- Adresse : https://ngauthierj-cell.github.io/Burger-quizz-compteur/
- `config.js` (ignoré par git) est créé au déploiement par `scripts/make-config.sh` à partir des
  secrets du dépôt `SUPABASE_URL` et `SUPABASE_ANON_KEY` (le script refuse les clés service_role et
  `sb_secret_`). En local : `.env` (modèle `.env.example`), puis `./scripts/make-config.sh`.
  Sans `config.js`, l'appli marche, sans buzzers connectés.
- Supabase : le projet de l'utilisateur est déjà configuré, scripts 001 à 003 lancés.
  Offre gratuite : **le projet se met en pause après 7 jours sans utilisation**
  (« Restore project » sur supabase.com) ; l'appli l'explique dans son message d'erreur.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | L'appli complète : CSS, HTML et script principal (IIFE). Polices et sons intégrés en base64 (d'où sa taille, ~370 Ko). |
| `buzzers.js` | Tout le mode buzzers (présentateur, téléphone buzzer, écran partagé, temps réel). |
| `qr.js` | Générateur de QR code fait maison (mode octets, correction M, versions 1 à 9) : `window.MiamsQR.svg(texte, couleur, fond)`. |
| `vendor/supabase.js` | `@supabase/supabase-js` **2.117.3**, version UMD, licence MIT, chargée seulement à l'usage des buzzers connectés. |
| `sw.js` | Service worker : sert d'abord la version en cache, puis met à jour en arrière-plan. |
| `supabase/migrations/00X_*.sql` | Schéma, fonctions, RLS, temps réel. À lancer dans l'ordre. |
| `tests/e2e/` | Tests navigateur avec un faux Supabase (voir `tests/e2e/README.md`). |

## Script principal (`index.html`)

- État de la partie dans `localStorage["compteur-miams-v1"]` : scores, objectif (25 par défaut),
  manche (0 à 4 : Nuggets, Sel ou Poivre, Menus, L'Addition, Burger de la Mort), état du Burger
  de la Mort (`bdm`), points par manche (`perRound`), son coupé ou non, écran allumé, partie précédente.
  Les fonctions clés sont `save()`, `render()`, `addPoints()`, `resetGame()` et `newGame()`.
- **Écran de choix à chaque lancement** : « Présentateur » (compteur habituel) ou « Rejoindre en
  tant que buzzer ». La variable `mode` vaut `"choose" | "host" | "buzzer"`.
  - Le clavier ne pilote les scores qu'en mode host.
  - L'écran « Une partie vous attend » apparaît à la réouverture, et après 10 min d'absence,
    s'il y a une partie en cours (au moins 1 Miam).
- Pont vers `buzzers.js` : `window.Miams` = `rounds, teams, bdmIndex, mode(), chooseRole(),
  showRoleScreen(), snapshot(), recapHtml(), scoreTiles(), gameInProgress(), buzzSound(team),
  warmAudio(), blip(), toast(), keyHook`.
  Événements envoyés sur `document` : `miams:save` (après chaque `save`), `miams:role`, `miams:newgame`.
- Sons : clips mp3 en base64 dans l'objet `CLIPS`.
  - Cris des points : `ketchup1-3` et `mayo1-3`, Ketchup grave ~150 Hz, Mayo aigu ~420 Hz.
  - Rire du Burger de la Mort : `bdmIntro`.
  - Buzz « Aïe ! » : `buzzKetchup` (~162 Hz, 0,33 s) et `buzzMayo` (~427 Hz, 0,52 s).
- ⚠️ Le code source contient de **vraies espaces insécables** (U+00A0), par exemple dans `"À vous !"`.
  Une recherche/remplacement avec une espace normale échoue sans prévenir.

## Mode buzzers (`buzzers.js`)

Le présentateur reste la **seule source de vérité des scores** : ils restent en local et sont
seulement recopiés dans la salle (`host_publish`, après chaque `save`, avec un délai de 300 ms).

- **Présentateur**
  - Bouton buzzer (touche **B**) → fenêtre avec : code de 4 lettres en tuiles, QR (lien `?salle=CODE`),
    pastilles « Ketchup / Mayo connecté », un seul bouton selon la situation
    (Mettre en pause / Débloquer / Réactiver), « Désactiver le mode » en lien.
    Le QR se replie quand les deux équipes sont connectées.
  - **Bandeau sous la manche** : code, pastilles, état et le même bouton. Il prend la couleur de
    l'équipe qui a la main, et un liseré rouge s'il est hors ligne.
  - **Écran plein « KETCHUP a la main ! »**, avec un seul bouton « Débloquer les buzzers ».
    Le présentateur **ne joue aucun son** (validé par l'utilisateur).
  - Salle mémorisée dans `compteur-miams-salle` (code, jeton, heure d'expiration, dernière activité).
    Elle est reprise à la réouverture, sauf si l'appli est restée fermée **plus de 10 min alors
    que la partie n'a pas commencé** ; dans ce cas elle est fermée.
  - **Nouvelle partie** ferme la salle ; le mode reste éteint jusqu'à « Activer les buzzers ».
  - Équipes connectées : la fonction `host_seats` est interrogée toutes les 5 s.
- **Téléphone buzzer** : code + équipe → énorme bouton à la couleur de l'équipe.
  - États : prêt, envoi, À vous !, Trop tard, En pause, Hors ligne.
  - Onglet **Récap** en lecture seule.
  - Le son « Aïe ! » sonne **sur le téléphone qui a pris la main**. Pas de vibration (refusée par l'utilisateur).
- **Écran partagé (côté joueurs)**, bouton « Les deux équipes sur ce téléphone » : écran coupé en
  deux, moitié Ketchup en haut à l'envers.
  - Avec un code : il buzze dans la salle et réserve les deux places.
  - Sans code : secours **sans réseau**, avec un bouton « Débloquer » local.
- **Un seul appareil par équipe** : identifiant aléatoire de l'appareil (`compteur-miams-appareil`).
  La place est confirmée toutes les 20 s, se libère après 60 s sans nouvelles, et « Quitter » la libère tout de suite.
- **Robustesse**
  - `RoomLink` gère l'abonnement temps réel (filtre `code=eq.XXXX`) et la reconnexion avec un délai
    croissant. L'état réseau n'est modifié que via `link.lost()` ou le temps réel : ne jamais
    l'écrire depuis l'extérieur, c'était le bug « bloqué Hors ligne ».
  - Une erreur réseau fait passer en « Hors ligne » ; une erreur avec un `code` est un refus du
    serveur et affiche un message.
  - Quand une nouvelle version de l'appli arrive (`controllerchange`), les téléphones buzzers se
    rechargent et rejoignent la même salle (`compteur-miams-rejoindre` dans sessionStorage).
    Le présentateur n'est jamais rechargé.

## Supabase (`supabase/migrations/`)

- **001** : table `rooms`, avec les colonnes `code` (4 lettres sans I ni O), `buzzers_enabled`,
  `buzzed_team`, `buzzed_at`, `question` (+1 à chaque déblocage), `recap` (jsonb, 4 Ko max),
  `closed`, `expires_at` (+12 h).
  - Table `room_secrets` (jeton du présentateur, illisible).
  - RLS : lecture seule des salles non expirées. Tout le reste passe par des fonctions
    `security definer` : `create_room`, `host_unlock`, `host_set_enabled`, `host_publish`,
    `host_close`, `cleanup_expired_rooms`.
  - Realtime activé sur `rooms`.
  - Fermer une salle = la marquer `closed` et la faire expirer 10 min plus tard. Ce n'est pas un
    DELETE, car le temps réel ne filtre pas les suppressions par salle.
- **002** : table `room_seats` (une place par équipe), `claim_seats`, `release_seats`.
  `buzz(code, team, question, device)` est un **UPDATE atomique** `WHERE buzzed_team IS NULL` :
  c'est le serveur qui tranche, et seul l'appareil qui tient la place peut buzzer.
- **003** : `host_seats(code, token)` renvoie les équipes ayant donné des nouvelles depuis moins de 60 s.
  Sans ce script, l'appli marche, sans les pastilles.
- Tester du SQL : un Postgres local suffit. Créer les rôles `anon` et `authenticated` et la
  publication `supabase_realtime`, lancer les scripts, puis appeler les fonctions avec `set role anon`.

## Tests

`node tests/e2e/buzzers.test.js` : 56 vérifications, attendu 0 `FAIL`. Voir `tests/e2e/README.md`.
Pièges : laisser ~400 ms aux fenêtres (transition d'ouverture) ; l'écran plein « a la main »
recouvre le bandeau et le bouton du haut.

## Idées en attente (proposées, pas encore faites)

- Bouton « Libérer les places » pour le présentateur (une place prise par erreur se libère
  aujourd'hui avec « Quitter », ou toute seule après 60 s).
- Onglet Récap sur l'écran partagé.
- Déblocage automatique des buzzers quand le présentateur donne des points (en option).
- Ne plus précharger `vendor/supabase.js` (220 Ko) dans `sw.js` pour tout le monde.
- Non testé automatiquement : l'appli du présentateur laissée plus de 10 min en arrière-plan
  sans être fermée (la salle doit se fermer si la partie n'a pas commencé).
