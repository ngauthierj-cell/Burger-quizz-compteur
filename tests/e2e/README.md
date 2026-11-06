# Tests automatiques (navigateur)

Ils lancent l'appli dans Chromium (Playwright) avec un **faux serveur Supabase**
en mémoire (`fake-supabase.js` + la fonction `fake()` de `buzzers.test.js`), qui
reproduit les règles des fonctions SQL de `supabase/migrations/`.

Prérequis : Node 18+ et Playwright avec Chromium
(`npm i -D playwright && npx playwright install chromium`, inutile si déjà installé).

Depuis la racine du dépôt :

```sh
node tests/e2e/buzzers.test.js            # parcours complet : présentateur, buzzers, écran partagé, coupures…
node tests/e2e/buzzers.test.js /chemin    # idem + captures d'écran dans /chemin
NOSEATS=1 node tests/e2e/buzzers.test.js  # comme si le script SQL 003 n'avait pas été lancé
node tests/e2e/vraie-lib.test.js          # vraie lib Supabase face à un serveur injoignable
NOCONF=1 node tests/e2e/vraie-lib.test.js # appli sans config.js
node tests/e2e/sons.test.js               # les sons « Aïe ! » intégrés se décodent
```

Chaque vérification affiche `OK` ou `FAIL`. Attendu : aucun `FAIL`, et
`OK   no page errors` à la fin (`NOSEATS=1` fait échouer exprès les 2 vérifications des pastilles).

Ces fichiers ne sont pas publiés sur GitHub Pages (le workflow ne copie que l'appli).
