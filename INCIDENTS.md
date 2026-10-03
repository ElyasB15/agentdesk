# Journal des incidents

Chaque incident suit le même format : symptôme, cause, correctif, vérification.
L'objectif : que quelqu'un qui rencontre le même problème dans six mois
puisse le régler sans moi.

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
- **Vérification 2** : `bcdedit` affiche `Auto`, Ubuntu


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
  agentdesk-app:local ls -la` ne montre aucun `.env`.
- **Leçon** : relire les premières lignes d'un build (taille du contexte,
  `.dockerignore` chargé). Un contexte anormalement gros est un signal d'alarme.
- **Défense en profondeur** : le build multi-étapes a empêché le secret d'atteindre
  l'image finale, malgré l'erreur de configuration.

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