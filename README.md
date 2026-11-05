# Compteur de Miams

Compteur de points pour un quiz entre amis, équipes Ketchup et Mayo : manches, Burger de la Mort, récap, sons. Un seul fichier `index.html`, sans dépendance, qui marche hors ligne.

En option, des **buzzers** sur les téléphones des joueurs : un téléphone par joueur (via Supabase), ou un seul téléphone coupé en deux pour les deux équipes (avec ou sans réseau). Sans eux, l'appli marche exactement comme avant.

## Installer l'appli sur un téléphone

### 1. Mettre l'appli en ligne (une seule fois)

1. Sur GitHub, ouvrir le dépôt, puis **Settings → Pages**.
2. Dans **Build and deployment → Source**, choisir **GitHub Actions**.
3. La publication se fait toute seule à chaque modification de la branche par défaut
   (fichier `.github/workflows/pages.yml`). Pour la lancer à la main :
   onglet **Actions → Publier sur GitHub Pages → Run workflow**.
4. Après une à deux minutes, l'adresse s'affiche dans **Settings → Pages** :
   `https://ngauthierj-cell.github.io/Burger-quizz-compteur/`

Sans configuration Supabase, l'appli est publiée sans buzzers connectés ; tout le reste marche.

### 2. L'ajouter à l'écran d'accueil

- **iPhone (Safari)** : ouvrir l'adresse, toucher le bouton **Partager**, puis **Sur l'écran d'accueil**.
- **Android (Chrome)** : ouvrir l'adresse, menu **⋮**, puis **Installer l'application** (ou **Ajouter à l'écran d'accueil**).

L'appli a alors son icône, s'ouvre en plein écran et fonctionne sans connexion.

## Mises à jour

Après une modification publiée, l'appli installée télécharge la nouvelle version en arrière-plan : elle apparaît au lancement suivant.

## Les buzzers

À chaque lancement, l'appli demande **qui tient l'appareil** :

- **Présentateur** : le compteur habituel. Les scores restent sur cet appareil.
- **Rejoindre en tant que buzzer** : pour le téléphone d'un joueur.

### Côté présentateur

Le bouton **buzzer** (en haut à droite, touche **B**) ouvre le panneau :

- **Activer les buzzers** : crée une salle avec un code de 4 lettres et un QR code.
  Les joueurs scannent le QR code (ou tapent le code) et choisissent Ketchup ou Mayo.
  Une équipe peut avoir plusieurs téléphones.
- Au premier buzz, l'équipe qui a la main s'affiche en grand avec le son du buzzer.
  Tous les buzzers sont verrouillés jusqu'à **Débloquer les buzzers** (touche **B**).
- **Mettre en pause** : coupe les buzzers, par exemple pendant les Menus.
- **Désactiver le mode** : ferme la salle. On continue en local, sans rien perdre.

### Côté joueurs

Sur **Rejoindre en tant que buzzer** : taper le code (ou scanner le QR code), puis
- **Ketchup** ou **Mayo** : un gros bouton à la couleur de l'équipe, et l'onglet **Récap** ;
- **Les deux équipes sur ce téléphone** : un seul téléphone posé entre les équipes,
  écran coupé en deux. Le premier qui touche a la main.
  - Avec le code : il buzze dans la salle, et c'est le présentateur qui débloque.
  - Sans code : secours sans réseau, tout se passe sur ce téléphone (bouton **Débloquer**).

C'est le **serveur** qui décide qui a buzzé en premier, jamais l'horloge des téléphones.
Après chaque changement de score, le présentateur publie le récap dans la salle :
les joueurs le consultent dans l'onglet **Récap**, sans pouvoir rien modifier.

Si la connexion tombe, un bandeau le signale. Le compteur continue en local, les
téléphones se reconnectent tout seuls et le récap est republié au retour du réseau.
Une salle expire au bout de 12 h.

### Configurer Supabase (une seule fois)

1. **Créer le projet** : sur [supabase.com](https://supabase.com), créer un compte puis
   **New project** (l'offre gratuite suffit). Choisir une région proche (ex. Paris).
2. **Créer les tables** : dans le projet, menu **SQL Editor → New query**, coller tout
   le contenu de `supabase/migrations/001_buzzers.sql`, puis **Run**.
   Le script crée la table des salles, les fonctions (dont le buzz), la sécurité (RLS)
   et active le temps réel. On peut le relancer sans risque.
3. **Vérifier le temps réel** : menu **Database → Publications → supabase_realtime** :
   la table `rooms` doit être cochée (le script s'en charge normalement).
4. **Récupérer les deux valeurs** : menu **Project Settings → API** (ou **API Keys**) :
   - l'**URL du projet** : `https://xxxx.supabase.co` ;
   - la clé publique **anon** (ou **publishable**, qui commence par `sb_publishable_`).

   ⚠️ Ne jamais utiliser la clé **service_role** ni une clé **secret** : elles donnent
   tous les droits. Le script de configuration les refuse de toute façon.
5. **Facultatif, ménage automatique** : **Database → Extensions → pg_cron**, puis lancer
   la requête indiquée en bas du fichier SQL. Sans ça, les salles expirées sont quand
   même invisibles, et supprimées à chaque nouvelle salle.

### Donner les valeurs à l'hébergeur (GitHub Pages)

GitHub Pages n'a pas de variables d'environnement : au moment de la publication,
`scripts/make-config.sh` écrit un fichier `config.js` à partir de deux secrets du dépôt.

1. Sur GitHub : **Settings → Secrets and variables → Actions → New repository secret**.
2. Créer `SUPABASE_URL` avec l'URL du projet.
3. Créer `SUPABASE_ANON_KEY` avec la clé anon (ou publishable).
4. Relancer la publication : **Actions → Publier sur GitHub Pages → Run workflow**.

Aucune clé n'est écrite dans le dépôt (`config.js` et `.env` sont ignorés par git).
La clé anon finit dans la page publiée : c'est prévu, elle est faite pour ça. Les
protections sont côté base : lecture seule des salles, et toute écriture passe par
les fonctions (les actions du présentateur exigent un jeton secret propre à la salle).

Remarque : avec la clé publique, quelqu'un d'averti pourrait lister les salles actives
(codes et scores, rien de personnel). Aucun compte, aucune donnée personnelle.

### Tester sur son ordinateur

```sh
cp .env.example .env          # puis renseigner les deux valeurs
./scripts/make-config.sh      # crée config.js
python3 -m http.server 8000   # ouvrir http://localhost:8000
```

## Fichiers

- `index.html` : l'appli complète (sons et polices intégrés).
- `manifest.webmanifest`, `icons/` : nom, couleurs et icônes pour l'installation.
- `sw.js` : garde l'appli en mémoire pour qu'elle marche hors ligne.
- `buzzers.js` : le mode buzzers (salle en ligne, écran buzzer, écran partagé des joueurs).
- `qr.js` : petit générateur de QR code, sans dépendance.
- `vendor/supabase.js` : la bibliothèque Supabase (licence MIT), chargée seulement en mode buzzers connectés.
- `supabase/migrations/001_buzzers.sql` : tables, fonctions, sécurité et temps réel.
- `scripts/make-config.sh`, `.env.example`, `config.example.js` : configuration Supabase.
- `.github/workflows/pages.yml` : publication sur GitHub Pages.
