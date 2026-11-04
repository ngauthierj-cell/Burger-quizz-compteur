# Compteur de Miams

Compteur de points pour un quiz entre amis, équipes Ketchup et Mayo : manches, Burger de la Mort, récap, sons. Un seul fichier `index.html`, sans dépendance, qui marche hors ligne.

## Installer l'appli sur un téléphone

### 1. Mettre l'appli en ligne (une seule fois)

1. Sur GitHub, ouvrir le dépôt, puis **Settings → Pages**.
2. Dans **Build and deployment**, choisir **Deploy from a branch**.
3. Choisir la branche qui contient l'appli et le dossier **/ (root)**, puis **Save**.
4. Après une à deux minutes, l'adresse s'affiche en haut de la page :
   `https://ngauthierj-cell.github.io/Burger-quizz-compteur/`

### 2. L'ajouter à l'écran d'accueil

- **iPhone (Safari)** : ouvrir l'adresse, toucher le bouton **Partager**, puis **Sur l'écran d'accueil**.
- **Android (Chrome)** : ouvrir l'adresse, menu **⋮**, puis **Installer l'application** (ou **Ajouter à l'écran d'accueil**).

L'appli a alors son icône, s'ouvre en plein écran et fonctionne sans connexion.

## Mises à jour

Après une modification publiée, l'appli installée télécharge la nouvelle version en arrière-plan : elle apparaît au lancement suivant.

## Fichiers

- `index.html` : l'appli complète (sons et polices intégrés).
- `manifest.webmanifest`, `icons/` : nom, couleurs et icônes pour l'installation.
- `sw.js` : garde l'appli en mémoire pour qu'elle marche hors ligne.
