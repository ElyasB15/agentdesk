# Journal des incidents

Chaque incident suit le même format : symptôme, cause, correctif, vérification, et quand c'est
utile, la leçon et la prévention. L'objectif : que quelqu'un qui rencontre le même problème dans
six mois puisse le régler sans moi, et surtout ne pas le reproduire.

## Index

| Date | Incident | Thème |
|---|---|---|
| 2026-09-22 | Module introuvable au lancement du serveur | Dossier courant |
| 2026-09-22 | WSL2 : Ubuntu refuse de démarrer (0x80370102) | Poste de travail |
| 2026-09-23 | PostgreSQL : port 5432 indisponible | Réseau, ports |
| 2026-09-25 | `npx` télécharge Prisma 8 RC depuis le mauvais dossier | Dossier courant, dépendances |
| 2026-09-25 | Quasi-incident : migration sur la mauvaise base évitée | Vérification avant écriture |
| 2026-09-26 | `npx tsc` propose un paquet qui n'est pas TypeScript | Chaîne d'approvisionnement |
| 2026-09-27 | L'API sert une ancienne version du code | Processus oublié |
| 2026-09-28 | `.dockerignore` ignoré, secret copié dans le cache de build | Secrets, Docker |
| 2026-09-30 | Workflow CI commité vide | Fichier non sauvegardé |
| 2026-10-03 | Grafana : échec du provisionnement après l'ajout d'un `uid` | Configuration as code |
| 2026-10-03 | Variables Grafana ignorées par Compose | Fichiers `.env` |
| 2026-10-03 | Liste blanche de modèles inactive après reconstruction | Fichier non sauvegardé |

---

## 2026-09-22 — Module introuvable au lancement du serveur

- **Symptôme** : `npx tsx src/server.ts` échoue avec `ERR_MODULE_NOT_FOUND`
  sur `src/server.ts`. npx propose aussi d'installer tsx.
- **Cause** : commande lancée depuis la racine du repo au lieu du dossier `app/`.
  Le chemin `src/server.ts` est relatif au dossier courant, et tsx est installé
  dans `app/node_modules`.
- **Correctif** : `cd app` avant de lancer la commande.
- **Vérification** : `curl http://localhost:3000/health` répond `{"status":"ok"}`.
- **Prévention** : script `npm run dev` défini dans `app/package.json`.

---

## 2026-09-22 — WSL2 : Ubuntu refuse de démarrer (erreur 0x80370102)

- **Symptôme** : à l'installation, Ubuntu échoue avec
  `WslRegisterDistribution failed with error: 0x80370102`.
- **Diagnostic 1** : Gestionnaire des tâches → Performance → Processeur
  affiche « Virtualisation : Désactivé ».
- **Correctif 1** : activation de SVM Mode dans le BIOS
  (MSI B450M-A PRO MAX, processeur AMD Ryzen 5 2600 :
  F7 → OC → Advanced CPU Configuration → SVM Mode → Enabled).
  Activation des fonctionnalités Windows VirtualMachinePlatform et
  Microsoft-Windows-Subsystem-Linux via `dism.exe`.
- **Vérification 1** : « Virtualisation : Activé ». **Mais l'erreur persiste.**
- **Diagnostic 2** : `bcdedit /enum "{current}" | findstr -i hypervisor`
  affiche `hypervisorlaunchtype Off`. L'hyperviseur Windows ne se lance pas
  au démarrage, probablement désactivé lors d'une installation de VirtualBox.
- **Correctif 2** : `bcdedit /set hypervisorlaunchtype auto`, puis redémarrage.
- **Vérification 2** : `bcdedit` affiche `Auto`, Ubuntu démarre et demande
  la création d'un utilisateur.
- **Leçon** : une cause corrigée ne veut pas dire un problème réglé.
  Toujours revérifier le symptôme d'origine après chaque correctif.

---

## 2026-09-23 — PostgreSQL (Docker) : port 5432 indisponible

- **Symptôme** : `docker compose up -d` échoue avec `ports are not available:
  exposing port TCP 127.0.0.1:5432`. Le conteneur reste à l'état `Created`
  (visible seulement avec `docker compose ps -a`).
- **Diagnostic** : `netstat -ano | findstr :5432` (PowerShell) montre un processus
  en écoute sur `0.0.0.0:5432`, PID 6052. `tasklist /FI "PID eq 6052"` l'identifie :
  `postgres.exe`, un PostgreSQL installé sur Windows et lancé comme service.
- **Options** : arrêter le service Windows, ou changer le port côté hôte.
- **Correctif retenu** : port hôte changé en 5433 (`127.0.0.1:5433:5432`).
  Choix le moins risqué : le PostgreSQL Windows peut servir à d'autres projets
  et n'est pas dans le périmètre de l'intervention.
- **Vérification** : `docker compose ps` affiche `healthy` et
  `127.0.0.1:5433->5432/tcp`, `select version();` répond.
- **Conséquence** : depuis la machine hôte, la base est sur `localhost:5433` ;
  depuis un autre conteneur du compose, sur `db:5432`.
- **Observation** : le PostgreSQL Windows écoute sur `0.0.0.0` (exposé au réseau
  local). À restreindre s'il est conservé.

---

## 2026-09-25 — `npx` télécharge Prisma 8 RC depuis le mauvais dossier

- **Symptôme** : `npx prisma migrate dev --name init` propose d'installer
  `prisma@8.0.0-rc.17`, puis échoue avec `No command registered for migrate`.
- **Cause** : commande lancée depuis la racine du repo. Prisma 7 est installé dans
  `app/node_modules` : `npx` ne l'a pas trouvé et a proposé de télécharger la dernière
  version publiée, une *release candidate* de Prisma 8 volontairement écartée, dont les
  commandes ont changé.
- **Impact** : aucun (la commande a échoué avant toute action). Si elle avait été compatible,
  la migration aurait été appliquée avec une autre version de Prisma que celle du projet.
- **Correctif** : `cd app`, vérification avec `npx prisma --version` (7.x, aucune question
  d'installation), puis relance.
- **Prévention** : scripts `db:migrate`, `db:deploy`, `db:generate`, `db:studio` dans
  `app/package.json` : npm utilise toujours le Prisma du projet, et échoue clairement hors
  du bon dossier. Règle : quand `npx` propose d'installer un paquet inattendu, répondre `n`, puis `pwd`.
- **Leçon** : deuxième incident lié au dossier courant ; cette fois, la cause est corrigée
  (scripts npm) plutôt que le symptôme.

---

## 2026-09-25 — Quasi-incident : migration sur la mauvaise base évitée

- **Symptôme** : aucun, l'erreur a été détectée avant d'agir. La vérification
  `grep -c "5433" app/.env` répondait `0`.
- **Cause** : `DATABASE_URL` dans `app/.env` était encore la valeur par défaut créée par
  `prisma init`, et non l'URL de la base Docker (`localhost:5433`).
- **Impact évité** : la première migration aurait été appliquée sur une autre base que prévu
  (par exemple le PostgreSQL Windows sur le port 5432).
- **Correctif** : `DATABASE_URL` corrigée, puis `npx prisma migrate status` pour confirmer la
  cible (`"agentdesk" at "localhost:5433"`) **avant** la migration.
- **Leçon** : une vérification n'a de valeur que si on lit son résultat. Avant toute écriture
  dans une base, confirmer la cible avec une commande en lecture seule.

---

## 2026-09-26 — `npx tsc` propose un paquet qui n'est pas TypeScript

- **Symptôme** : `npx tsc --noEmit` depuis la racine du repo propose d'installer `tsc@2.0.4`.
- **Cause** : TypeScript est installé dans `app/`. Hors de ce dossier, `npx` cherche un paquet
  npm **nommé** `tsc`, qui n'est pas TypeScript (le compilateur est fourni par le paquet
  `typescript`). C'est le mécanisme exploité par certaines attaques de la chaîne
  d'approvisionnement : publier un paquet au nom d'une commande populaire.
- **Correctif** : réponse `n`, `cd app`, relance.
- **Prévention** : script `npm run typecheck` (également utilisé par la CI).

---

## 2026-09-27 — L'API sert une ancienne version du code

- **Symptôme** : `GET /messages` répond 404 et `/health` ne contient pas `"database"`,
  alors que le code source contient ces routes.
- **Hypothèse initiale** : branche créée avant la fusion de la PR précédente.
  **Réfutée** par `git log` (PR bien fusionnée) et par le contenu de `server.ts` : hypothèse abandonnée.
- **Cause réelle** : un serveur lancé la veille tournait encore dans un autre terminal, avec
  l'ancien code, et occupait le port 3000.
- **Correctif** : arrêt du processus, relance du serveur.
- **Vérification** : `/health` répond `{"status":"ok","database":"ok"}`, `GET /messages` répond 200.
- **Leçon** : on n'applique pas un correctif sur une hypothèse contredite par les faits.
  Après un changement de branche ou un `git pull`, redémarrer le serveur et vérifier `/health`.

---

## 2026-09-28 — Docker : `.dockerignore` ignoré, secret copié dans le cache de build

- **Symptôme** : le build envoie 365 Mo de contexte ; la ligne `load .dockerignore`
  indique 2 octets (fichier absent).
- **Cause** : `.dockerignore` placé à la racine du repo, alors que le contexte de build
  est `./app`. Docker ne lit le `.dockerignore` qu'à la racine du contexte.
- **Impact** : `node_modules` et `app/.env` copiés dans l'étape de construction.
  L'image finale n'est pas touchée (l'étape d'exécution ne copie que `dist`, `prisma`
  et la config), mais le mot de passe était présent dans le cache de build local.
- **Correctif** : `.dockerignore` déplacé dans `app/`, image reconstruite,
  cache purgé avec `docker builder prune -f`.
- **Vérification** : contexte de build de quelques Ko ; `docker run --rm
  agentdesk-app:local ls -la` ne montre aucun `.env`. L'empreinte de l'image finale est
  identique avant et après correction : preuve qu'elle n'a jamais contenu le secret.
- **Leçon** : relire les premières lignes d'un build (taille du contexte,
  `.dockerignore` chargé). Un contexte anormalement gros est un signal d'alarme.
- **Défense en profondeur** : le build multi-étapes a empêché le secret d'atteindre
  l'image finale, malgré l'erreur de configuration.

---

## 2026-09-30 — Workflow CI commité vide

- **Symptôme** : le commit du workflow indique `1 file changed, 0 insertions(+)`.
- **Cause** : contenu collé dans l'éditeur mais fichier non sauvegardé avant le `git add`.
  Le commit avait aussi été fait sur `main` par erreur (branche non créée).
- **Impact** : aucun, le commit n'avait pas été poussé.
- **Correctif** : branche créée à l'emplacement du commit (`git checkout -b ci/github-actions`),
  `main` remis sur l'état de GitHub (`git branch -f main origin/main`), fichier rempli et
  sauvegardé, commit corrigé avec `git commit --amend` (autorisé car jamais poussé).
- **Vérification** : `head -5 .github/workflows/ci.yml`, puis `57 insertions(+)` au commit.
- **Leçon** : lire la sortie de `git commit` (nombre de lignes) et la première ligne de
  `git status` (branche courante) avant de pousser.

---

## 2026-10-03 — Grafana : échec du provisionnement après l'ajout d'un `uid`

- **Symptôme** : Grafana redémarre en boucle ; logs :
  `Datasource provisioning error: data source not found`, puis échec en cascade des
  modules qui dépendent du provisionnement.
- **Cause** : au premier démarrage, la source Prometheus a été créée sans `uid` (identifiant
  aléatoire, stocké dans le volume `grafana-data`). L'ajout de `uid: prometheus` dans le
  fichier de provisionnement a changé l'identité attendue : Grafana cherche une source avec
  cet identifiant, ne la trouve pas, et refuse de continuer.
- **Options** : supprimer le volume `grafana-data` (repartir de zéro), ou migrer la source.
- **Correctif retenu** : section `deleteDatasources` temporaire (suppression de l'ancienne
  source par son nom, puis recréation avec le bon `uid`). Solution la moins destructrice :
  le reste de l'état de Grafana est conservé. Section retirée après application.
- **Vérification** : `docker compose logs grafana --since 1m | grep -i -E "error|provision"`
  ne renvoie rien ; Grafana stable ; tableau de bord AgentDesk chargé.
- **Leçon** : changer l'identité d'une ressource déjà créée demande une étape de transition,
  comme une migration de base de données. Donner un `uid` stable dès la création évite le problème.

---

## 2026-10-03 — Variables Grafana ignorées par Compose

- **Symptôme** : `docker compose config --quiet` affiche
  `The "GRAFANA_ADMIN_USER" variable is not set. Defaulting to a blank string.`
- **Cause** : variables ajoutées dans `app/.env` (fichier du mode développement de l'API)
  au lieu du `.env` à la racine, le seul lu par Compose.
- **Correctif** : variables déplacées dans le `.env` racine et le `.env.example` racine ;
  retirées des fichiers de `app/`.
- **Vérification** : `cut -d= -f1 .env` liste les variables sans afficher leurs valeurs ;
  `docker compose config --quiet` ne renvoie plus rien.
- **Leçon** : un fichier de configuration n'a d'effet que si le bon programme le lit.
  Ne jamais partager une capture d'un `.env` : vérifier les noms avec `cut -d= -f1`.

---

## 2026-10-03 — Liste blanche de modèles inactive après reconstruction

- **Symptôme** : après `docker compose up -d --build app`, un modèle inventé reçoit un 502
  au lieu d'un 400, et son nom apparaît dans `/metrics`.
- **Diagnostic** : comportement identique à la version précédente, donc l'image ne contient pas
  le nouveau code. Vérification : `grep -n "Modèle non autorisé" app/src/server.ts`, puis
  `docker compose exec app grep -c "Modèle non autorisé" dist/src/server.js`.
- **Cause** : `server.ts` modifié dans l'éditeur mais non sauvegardé avant la reconstruction.
- **Correctif** : sauvegarde, reconstruction.
- **Vérification** : modèle inventé refusé en 400 ; `grep -c "modele-invente"` sur `/metrics`
  renvoie `0`.
- **Prévention** : deuxième incident causé par un fichier non sauvegardé (voir 2026-09-30) :
  sauvegarde automatique activée dans VS Code (*File → Auto Save*).
- **Observation** : la série créée par la requête d'avant la correction a été relevée par
  Prometheus et reste dans son historique : une seule requête suffit à créer une série durable,
  ce qui illustre le risque de cardinalité que la liste blanche corrige.