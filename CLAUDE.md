# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

AgentDesk : API Fastify (TypeScript, ESM) qui enregistre des messages clients dans PostgreSQL et
les fait classer (catégorie, priorité, résumé) par un modèle local servi par Ollama, via un
**appel d'outil**. Toute la documentation, les commentaires, les logs, les messages d'erreur de
l'API et les messages de commit sont **en français** : garder cette langue.

Documentation opérationnelle de référence : `RUNBOOK.md` (procédures), `INCIDENTS.md` (journal),
`SECURITY.md` (vulnérabilités acceptées et décisions), `eval/RULES.md` (politique métier).

## Commandes

Toutes les commandes npm se lancent **depuis `app/`** (sinon `npx` propose d'installer un paquet
homonyme : répondre `n`).

```bash
npm run db:generate      # génère le client Prisma dans app/generated/prisma (requis avant typecheck/build)
npm run typecheck        # tsc --noEmit — seule vérification des types (tsx ne vérifie rien)
npm run build            # compile vers dist/ ; point d'entrée dist/src/server.js
npm run dev              # tsx watch, lit app/.env (db sur localhost:5433, Ollama sur localhost:11434)
npm run db:migrate -- --name description_courte   # nouvelle migration (dev)
```

Il n'y a **pas de tests unitaires** (`npm test` est un placeholder). La CI (`.github/workflows/ci.yml`)
exécute : `npm ci` → `db:generate` → `typecheck` → `build`, puis `docker compose config --quiet`
et `docker build ./app`. Reproduire ces étapes en local quand la CI est rouge.

Pile complète (depuis la racine) :

```bash
docker compose up -d                 # db, ollama, migrate, app, prometheus, grafana
docker compose up -d --build app     # obligatoire après une modif de app/src pour la voir dans le conteneur
docker compose stop app              # libère le port 3000 avant npm run dev
```

Évaluation des modèles (nécessite l'app en marche sur :3000, l'image reconstruite si le prompt a changé) :

```bash
python3 eval/evaluate.py --label "description de la configuration"
python3 eval/evaluate.py --models granite4.1:3b --label "..."    # un seul modèle
```

Les rapports horodatés (`eval/results/*.md|json`) sont commités avec la configuration qui les a produits.

## Architecture

- `app/src/server.ts` : routes Fastify (`/health`, `/messages`, `/messages/:id/classify`, `/metrics`),
  validation des entrées par schémas JSON Fastify, hook `onResponse` qui alimente l'histogramme HTTP
  (étiquette `route` = modèle de route, jamais l'URL brute).
- `app/src/ollama.ts` : `SYSTEM_PROMPT`, définition de l'outil `classify_message` et validation Zod
  de la réponse. Un appel d'outil absent ou invalide n'est **pas** une erreur : il donne
  `classification: null`, stocké avec `toolCallValid = false` (donnée d'évaluation). Seul un échec
  HTTP/réseau d'Ollama lève une exception → 502.
- `app/src/metrics.ts` : registre Prometheus. `initModelSeries` initialise à zéro les séries de
  chaque modèle de `KNOWN_MODELS` au démarrage, pour que `rate()` compte la première rafale.
- `app/src/db.ts` : Prisma 7 avec l'adaptateur `@prisma/adapter-pg` ; client importé depuis
  `../generated/prisma/client.js` (généré, non versionné). Config Prisma : `app/prisma7.config.ts`.
- Schéma : `Message` 1-n `ClassificationRun` (colonnes en snake_case via `@map`).

Couplages non évidents à respecter :

- **Liste blanche des modèles** : `KNOWN_MODELS` (variable du service `app` dans
  `docker-compose.yml`, et `app/.env` en dev). Un modèle hors liste est refusé en 400 *avant* toute
  création de série de métriques (maîtrise de la cardinalité). `DEFAULT_MODELS` dans
  `eval/evaluate.py` doit rester cohérent.
- **Prompt ↔ règles métier** : les règles de `eval/RULES.md` sont recopiées dans `SYSTEM_PROMPT`.
  Modifier l'un impose de vérifier l'autre et de relancer l'évaluation, en comparant cas par cas.
  Les exemples donnés au modèle ne doivent jamais provenir de `eval/dataset.json`.
- **Migrations séparées** : le service `migrate` (même image) lance `prisma migrate deploy` ; `app`
  ne démarre que s'il a réussi et qu'Ollama est sain. Ne jamais appliquer de migration si
  `npx prisma migrate status` ne cible pas `localhost:5433`.
- **Observabilité en tant que code** : `ops/prometheus/*.yml` et `ops/grafana/**` sont montés en
  lecture seule. Le tableau de bord se modifie dans `ops/grafana/dashboards/agentdesk.json`
  (valider avec `python3 -m json.tool`), jamais dans l'interface. Ne jamais changer l'`uid` d'une
  source de données existante (cf. incident du 2026-10-03). Étiquettes de métriques : valeurs
  connues et peu nombreuses uniquement.

## Contraintes

- TypeScript strict avec `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` et
  `verbatimModuleSyntax` : imports de types via `import { type X }`, imports relatifs suffixés `.js`.
- Ports publiés uniquement sur `127.0.0.1` ; `OLLAMA_NO_CLOUD=true` ; images Docker en version fixée
  (jamais `latest`).
- Ne pas lire `.env` ni afficher `docker compose config` (valeurs secrètes en clair) ; utiliser
  `cut -d= -f1 .env`. Toute nouvelle variable va aussi dans le `.env.example` correspondant.
- `main` est protégée : branche `<type>/<description>`, commit `<type>: <description>`, PR avec CI
  verte. Pas de `--amend`/`reset` sur un commit poussé (utiliser `git revert`). Conflit sur
  `package-lock.json` : relancer `npm install` plutôt que résoudre à la main.
- Jamais `npm audit fix --force` ; trier les vulnérabilités et consigner les décisions dans `SECURITY.md`.
- Tout incident réel se consigne dans `INCIDENTS.md` (symptôme, cause, correctif, vérification).
- La base se consulte par l'outil MCP `agentdesk-db` (lecture seule). Ne jamais tenter de
  contourner la lecture seule.

## Règles critiques (non négociables)

- **Ne jamais modifier une migration déjà commitée** dans `app/prisma/migrations/` : corriger
  par une nouvelle migration. (Protégé par un hook.)
- Toute nouvelle colonne sur une table existante est **optionnelle** ou a une **valeur par défaut**.
- Relire le SQL de chaque migration générée. Une migration qui touche des données existantes se
  génère avec `--create-only`, se complète à la main, et ne s'applique qu'après une sauvegarde.
- Ajouter un modèle : `ollama pull` d'abord, puis `KNOWN_MODELS` (compose et `app/.env`).
- Toute nouvelle route ou variable d'environnement se documente dans `RUNBOOK.md` et `README.md`.

## Méthode de travail

1. Lire les fichiers concernés, puis **présenter un plan** (fichiers modifiés, vérifications prévues)
   et attendre la validation avant de modifier quoi que ce soit.
2. Rester **strictement dans le périmètre** demandé : signaler ce qui semble à améliorer ailleurs,
   sans le modifier.
3. En cas d'ambiguïté ou de contradiction dans la demande : **s'arrêter et poser la question**.
4. Ne jamais désactiver, affaiblir ou supprimer une vérification (typecheck, CI, validation) pour
   faire passer un changement.
5. Après deux tentatives infructueuses sur le même problème : s'arrêter et exposer la situation.

## Définition de « terminé »

- `npm run typecheck` et `npm run build` sans erreur (depuis `app/`).
- Chaque critère d'acceptation prouvé par une **commande réelle** (`curl`, requête SQL, logs), avec
  sa sortie dans le compte rendu.
- Documentation mise à jour si nécessaire.
- Compte rendu final : ce qui a été fait, ce qui a été vérifié et comment, ce qui reste ou ce qui
  a été supposé.

## Usine de développement

Pour toute tâche de développement, enchaîner les sous-agents de `.claude/agents/` :
1. **analyste** → présenter la spécification à l'humain et **attendre sa validation**.
2. **developpeur** avec la spécification validée.
3. **reviseur** sur le diff obtenu. Verdict « À CORRIGER » : renvoyer au développeur
   (au plus deux allers-retours, puis s'arrêter et exposer la situation à l'humain).
4. **testeur** avec les critères d'acceptation.
5. Présenter à l'humain les rapports de revue et de tests, puis **attendre sa validation**
   avant tout commit.