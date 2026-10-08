# Runbook — AgentDesk

> Procédures d'exploitation de la pile AgentDesk.
> Public : toute personne qui doit démarrer, vérifier, déployer, surveiller ou dépanner le projet.
> Dernière mise à jour : 2026-10-07
>
> Chaque procédure suit le même format : **objectif**, **commandes**, **résultat attendu**, **si ça ne va pas**.
> Les procédures marquées ⚠️ *à tester* n'ont pas encore été exécutées de bout en bout sur ce projet.

---

## 1. Vue d'ensemble

AgentDesk reçoit des messages clients, les enregistre dans PostgreSQL, et les fait classer
(catégorie, priorité, résumé) par un modèle de langage local exécuté par Ollama, au moyen d'un
appel d'outil (*tool calling*). Chaque classification est enregistrée avec ses métriques
(modèle utilisé, latence, validité de l'appel d'outil). Prometheus et Grafana surveillent la pile.

La pile est décrite dans `docker-compose.yml` : **six conteneurs séparés**, reliés par un réseau
privé (`agentdesk_default`) où ils se joignent **par leur nom de service**.

| Service | Rôle | Image | Port sur l'hôte | Volume |
|---|---|---|---|---|
| `db` | Base de données | `postgres:17-alpine` | `127.0.0.1:5433` → 5432 | `agentdesk_db-data` |
| `ollama` | Serveur d'inférence (GPU) | `ollama/ollama:0.34.4` | `127.0.0.1:11434` → 11434 | `agentdesk_ollama-data` |
| `migrate` | Applique les migrations, puis s'arrête | `agentdesk-app:local` (Dockerfile) | aucun | aucun |
| `app` | API Fastify | `agentdesk-app:local` (Dockerfile) | `127.0.0.1:3000` → 3000 | aucun |
| `prometheus` | Métriques et alertes | `prom/prometheus:v3.15.0` | `127.0.0.1:9090` → 9090 | `agentdesk_prometheus-data` |
| `grafana` | Tableaux de bord | `grafana/grafana:13.2.3` | `127.0.0.1:3001` → 3000 | `agentdesk_grafana-data` |

**Ordre de démarrage** (géré par les `depends_on` et les healthchecks du compose, pas par l'ordre
d'écriture dans le fichier) :

1. `db` et `ollama` démarrent en parallèle.
2. `migrate` attend que `db` soit `healthy`, applique les migrations, puis s'arrête avec le code 0.
3. `app` ne démarre que si `migrate` a réussi **et** qu'`ollama` est `healthy`.
4. `prometheus` démarre sans dépendre de l'app (la surveillance doit tourner même si l'app est en
   panne) ; `grafana` démarre après `prometheus`.

> `depends_on` ne joue qu'au démarrage. Une panne ultérieure (ex. la base tombe) est gérée par
> `restart: unless-stopped` et par l'application elle-même, qui se reconnecte sans redémarrage.

**Endpoints de l'API** :

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/health` | Santé de l'API **et** de la base (200 ou 503) |
| `POST` | `/messages` | Enregistre un message (`{"content": "..."}`) |
| `GET` | `/messages` | 50 derniers messages avec leurs classifications |
| `POST` | `/messages/:id/classify` | Classe un message existant (`{}` ou `{"model": "..."}`) |
| `DELETE` | `/messages/:id` | Supprime un message et ses classifications (204). **Irréversible** : les classifications, donc les données d'évaluation, sont supprimées avec lui |
| `GET` | `/metrics` | Métriques au format Prometheus |

**Autres documents** : `INCIDENTS.md` (historique des incidents), `SECURITY.md` (risques et
décisions), `eval/RULES.md` (règles d'annotation du banc d'évaluation).

---

## 2. Prérequis

Pour une machine Windows neuve :

1. **WSL2 avec Ubuntu** : `wsl --install -d Ubuntu` (PowerShell administrateur).
   - Erreur `0x80370102` : voir la section 8.
2. **Docker Desktop** :
   - *Settings → General* : **Use the WSL 2 based engine** coché.
   - *Settings → General* : **Start Docker Desktop when you sign in** coché (sinon la commande
     `docker` est introuvable dans Ubuntu après un redémarrage).
   - *Settings → Resources → WSL integration* : **Ubuntu** activé.
   - *Expose daemon on tcp://localhost:2375 without TLS* : **décoché** (jamais activer).
3. **Pilote NVIDIA** installé côté Windows. Vérification dans Ubuntu : `nvidia-smi`.
4. **Le code dans le système de fichiers Linux** (`~/agentdesk`), pas dans `/mnt/c/...`.
5. **VS Code** : sauvegarde automatique activée (*File → Auto Save*). Deux incidents ont été causés
   par un fichier modifié mais non sauvegardé.
6. **Les fichiers de configuration** :

```bash
cd ~/agentdesk
cp .env.example .env            # variables de la pile, lues par Compose (POSTGRES_*, GRAFANA_*)
cp app/.env.example app/.env    # variables du mode développement de l'API (voir section 3.5)
```

Puis remplacer les mots de passe d'exemple, avec des mots de passe **différents** pour la base et
Grafana. **Les fichiers `.env` ne sont jamais commités.**

> Compose lit **uniquement** le `.env` situé à côté de `docker-compose.yml` (à la racine).
> `app/.env` ne sert qu'au mode développement de l'API.
>
> Pour vérifier un `.env` sans afficher les secrets : `cut -d= -f1 .env` (noms seulement).
> Ne jamais partager une capture d'écran d'un `.env`.
>
> Si le mot de passe de la base contient `@`, `:` ou `/`, il casse l'URL de connexion : choisir un
> mot de passe sans ces caractères, ou l'encoder.

---

## 3. Opérations courantes

### 3.1 Démarrer la pile

**Objectif** : lancer tous les services.

```bash
cd ~/agentdesk
docker compose config --quiet
docker compose up -d
```

**Résultat attendu** :

- `config --quiet` n'affiche **rien** (configuration valide).
- `up` affiche `db` et `ollama` en `Healthy`, `migrate` en `Exited`, `app`, `prometheus` et
  `grafana` en `Started`.
- Poursuivre avec la vérification de santé (3.2).

**Si ça ne va pas** :

- `config` signale une erreur (ex. `mapping key already defined`) : erreur de syntaxe ou
  d'**indentation** YAML. Les services doivent tous être alignés à 2 espaces.
- `config` affiche `variable is not set` : la variable manque dans le `.env` **racine**.
- `ports are not available` : un autre programme occupe le port. Voir la section 8.

### 3.2 Vérifier la santé

**Objectif** : confirmer que toute la pile fonctionne, après un démarrage, un déploiement ou une alerte.

```bash
docker compose ps -a
curl -s localhost:3000/health; echo
```

**Résultat attendu** :

- `db`, `ollama` et `app` en `Up ... (healthy)` ; `prometheus` et `grafana` en `Up`
  (sans healthcheck).
- `migrate` en `Exited (0)` : c'est normal, il s'arrête après avoir appliqué les migrations.
- `/health` répond `{"status":"ok","database":"ok"}`.
- Côté surveillance : voir la section 7.1.

**Si ça ne va pas** :

- Un service en `unhealthy` ou qui redémarre en boucle : `docker compose logs <service>`.
- `migrate` en `Exited (1)` : la migration a échoué, et `app` n'a volontairement pas démarré.
  Voir la section 5.3.
- `/health` répond 503 avec `"database":"unreachable"` : l'app tourne mais ne joint pas la base.
  Vérifier `docker compose ps -a db`, puis `docker compose logs db`.
- `ps` sans `-a` masque les conteneurs arrêtés : **toujours utiliser `-a` pour un diagnostic**.

### 3.3 Arrêter et redémarrer

**Objectif** : arrêter ou relancer la pile ou un seul service.

| Commande | Effet | Données |
|---|---|---|
| `docker compose stop <service>` | Arrête un service, conserve le conteneur | Conservées |
| `docker compose start <service>` | Relance un service arrêté | Conservées |
| `docker compose restart <service>` | Arrêt puis relance | Conservées |
| `docker compose down` | Arrête **et supprime** conteneurs et réseau | **Conservées** (volumes intacts) |
| `docker compose down -v` | Supprime aussi les **volumes** | ⚠️ **Base, modèles, historique des métriques et état de Grafana effacés, irréversible** |

**Résultat attendu** : après une relance, refaire la vérification de santé (3.2).

**Si ça ne va pas** : l'arrêt est propre si les logs de `app` montrent `arrêt en cours`
(signal `SIGTERM` ou `SIGINT` reçu). Sinon, Docker force l'arrêt après 10 secondes.

> **`down -v` ne s'utilise jamais sur un environnement contenant des données réelles.**
> Pour ne réinitialiser que la base : `docker compose down`, puis `docker volume ls`
> (relire le nom exact), puis `docker volume rm agentdesk_db-data`.

### 3.4 Consulter les journaux

**Objectif** : comprendre ce que fait un service ou pourquoi il échoue.

```bash
docker compose logs <service>                  # tout l'historique
docker compose logs --tail=100 -f app          # 100 dernières lignes, puis suivi en direct (Ctrl+C pour quitter)
docker compose logs grafana --since 5m         # seulement les 5 dernières minutes
docker compose logs ollama | grep -i -E "gpu|cuda|compute"   # filtrer
```

**À savoir** :

- Les logs de `app` sont en JSON. `level` : 30 = info, 40 = avertissement, 50 = erreur.
- Chaque requête produit deux lignes (`incoming request`, `request completed`) avec le code
  HTTP et la durée (`responseTime`, en ms).
- Un échec d'appel à Ollama est journalisé : `échec de l'appel à Ollama`, avec le modèle demandé.
- Après une correction, utiliser `--since` pour ne pas relire les anciennes erreurs.
- `grep` renvoie le code 1 (rond rouge dans le terminal) quand il ne trouve **rien** : en
  recherche d'erreurs, c'est une bonne nouvelle.

### 3.5 Travailler en mode développement (hors Docker)

**Objectif** : modifier le code de l'API avec rechargement automatique.

```bash
docker compose stop app          # libère le port 3000
cd ~/agentdesk/app
npm run dev
```

En mode développement, l'API lit `app/.env` (`DATABASE_URL`, `OLLAMA_URL`, `DEFAULT_MODEL`,
`KNOWN_MODELS`) et joint la base et Ollama **depuis l'hôte** : `localhost:5433` et `localhost:11434`.
Dans les conteneurs, ce sont `db:5432` et `ollama:11434`.

Avant de commiter :

```bash
npm run typecheck                # aucune sortie = aucune erreur de types
```

> `tsx` (utilisé par `npm run dev`) ne vérifie **pas** les types. Seul `npm run typecheck` le fait.

Pour revenir au conteneur : arrêter `npm run dev` (Ctrl+C), puis `docker compose up -d --build app`.

**Si ça ne va pas** :

- `EADDRINUSE` sur le port 3000 : le conteneur `app` tourne encore (`docker compose stop app`).
- `npx` propose d'installer un paquet (`Need to install the following packages`) : répondre
  **`n`**, puis `pwd`. Presque toujours, on n'est pas dans `app/`.
- Après un changement de branche ou un `git pull`, **redémarrer** le serveur et vérifier
  `/health`. Un serveur oublié dans un autre terminal sert l'ancien code.

### 3.6 Proposer une modification (branche, PR et CI)

**Objectif** : faire arriver un changement sur `main`. La branche `main` est protégée :
aucun push direct, fusion uniquement par PR, CI verte exigée.

```bash
git checkout main
git pull
git checkout -b <type>/<description>     # ex. feat/..., fix/..., docs/..., ci/...
# modifier, puis vérifier en local :
cd app && npm run typecheck && cd ..
git status                               # vérifier la branche et les fichiers
git add <fichiers>
git commit -m "<type>: <description>"
git push -u origin <type>/<description>
```

Puis ouvrir une PR vers `main` sur GitHub, avec une description qui indique **ce qui change**
et **comment c'est vérifié**.

**Résultat attendu** : les deux vérifications `App (types et compilation)` et
`Docker (compose et image)` passent au vert ; le bouton de fusion se débloque.

**Si la CI est rouge** :

1. Sur la PR : **Details** du job en échec, puis ouvrir l'étape marquée en rouge.
2. Reproduire en local la même commande (`npm run typecheck`, `npm run build`,
   `docker compose config --quiet`, `docker build -t agentdesk-app:local ./app`).
3. Corriger, commiter, pousser : la CI se relance automatiquement.

**Annuler un commit déjà poussé** : `git revert --no-edit <commit>` (crée un commit inverse,
sans réécrire l'historique). Ne jamais utiliser `--amend` ni `reset` sur un commit déjà poussé.

**En cas de conflit avec `main`** : dans sa branche, `git merge main`, résoudre, vérifier en local,
pousser. Pour `package-lock.json`, ne pas résoudre à la main : relancer `npm install`.
Si deux branches ont chacune créé une migration, relancer `npm run db:migrate` après la fusion
pour vérifier que la suite de migrations s'applique proprement.

> Une branche locale « à jour » (`up to date with origin/...`) l'est par rapport à **sa propre**
> branche sur GitHub : le travail d'une autre branche n'arrive sur `main` que par une PR fusionnée.

---

## 4. Déployer une nouvelle version

**Objectif** : mettre en service le code le plus récent de `main`.

```bash
cd ~/agentdesk
git checkout main
git pull
docker compose config --quiet
docker compose up -d --build
docker compose ps -a
docker compose logs migrate
curl -s localhost:3000/health; echo
```

**Résultat attendu** :

- L'image `agentdesk-app:local` est reconstruite (`Built`).
- `migrate` : `No pending migrations to apply`, ou `All migrations have been successfully applied`
  si la version en apporte de nouvelles.
- Vérification de santé (3.2) conforme, et cible `agentdesk-app` en **UP** dans Prometheus (7.1).

**Si ça ne va pas** :

- Échec du build : lire la première erreur de la sortie. Vérifier aussi, au début du build,
  la taille du contexte (`transferring context`) : quelques Ko sont normaux. Des centaines de Mo
  signalent un `.dockerignore` absent ou mal placé (il doit être dans `app/`).
- Échec de migration : section 5.3.
- Le comportement n'a pas changé après le déploiement : vérifier que le nouveau code est bien
  dans l'image, par exemple `docker compose exec app grep -c "<texte du nouveau code>" dist/src/server.js`.

**Revenir à la version précédente** ⚠️ *à tester* :

```bash
git log --oneline -5                  # repérer le commit précédent
git checkout <commit>
docker compose up -d --build
```

> Les migrations **ne sont pas annulées** par un retour en arrière du code. Si la version déployée
> a appliqué une migration, revenir en arrière demande une analyse : **escalader** (section 10).
> Amélioration prévue : étiqueter les images par version pour revenir en arrière sans reconstruire.

---

## 5. Migrations de base de données

Le schéma est décrit dans `app/prisma/schema.prisma`. Chaque changement produit une migration SQL
versionnée dans `app/prisma/migrations/`. La table `_prisma_migrations` enregistre celles déjà
appliquées : une migration n'est jamais appliquée deux fois.

| Commande | Usage |
|---|---|
| `migrate dev` | **Développement uniquement.** Compare le schéma à la base, génère et applique une migration ; peut proposer de réinitialiser la base |
| `migrate deploy` | **Production.** Applique uniquement les migrations absentes du registre, ne génère et ne réinitialise rien |

### 5.1 Créer une migration (développement)

```bash
docker compose ps -a db                        # la base doit être healthy
cd ~/agentdesk/app
npx prisma migrate status                      # depuis app/ : aucune question d'installation ; cible "agentdesk" at "localhost:5433"
# modifier prisma/schema.prisma
npm run db:migrate -- --name description_courte
npm run db:generate
npm run typecheck
```

**Résultat attendu** : un nouveau dossier `prisma/migrations/<date>_description_courte/` contenant
`migration.sql`. **Relire ce SQL** avant de commiter, puis commiter le dossier avec le schéma.

**Si ça ne va pas** :

- `migrate dev` propose de **réinitialiser** la base : répondre **non** et analyser.
  Une réinitialisation efface toutes les données.
- `migrate status` affiche une autre adresse que `localhost:5433` : **ne rien appliquer**,
  corriger `DATABASE_URL` dans `app/.env`. Vérification sans afficher le mot de passe :
  `grep -c "5433" .env` doit répondre `1`.
- Une nouvelle colonne **obligatoire** sur une table qui contient déjà des lignes échouera en
  production : la rendre optionnelle (`?`), lui donner une valeur par défaut, ou procéder en
  plusieurs étapes.

### 5.2 Appliquer les migrations

Les migrations sont appliquées **automatiquement** par le service `migrate` à chaque
`docker compose up`. Pour les appliquer sans redémarrer toute la pile ⚠️ *à tester* :

```bash
docker compose run --rm migrate
```

**Résultat attendu** : `All migrations have been successfully applied` ou
`No pending migrations to apply`. L'opération est **idempotente** : la relancer ne change rien.

### 5.3 Si une migration échoue

**Symptôme** : `migrate` en `Exited (1)`. `app` ne démarre pas : **c'est voulu**, l'application
refuse de tourner sur un schéma incomplet (`condition: service_completed_successfully`).
La base, elle, continue de fonctionner.

**Procédure** :

1. Lire l'erreur : `docker compose logs migrate`.
2. Identifier la cause :
   - **Base injoignable** : vérifier `docker compose ps -a db` et le `DATABASE_URL` du compose.
   - **Erreur SQL** : par exemple, ajouter une colonne obligatoire sans valeur par défaut à une
     table qui contient déjà des lignes.
   - **Migration modifiée après application** : Prisma détecte que le fichier ne correspond plus
     à ce qui a été appliqué.
3. Corriger :
   - **Ne jamais modifier une migration déjà appliquée** sur un environnement partagé.
     On corrige avec une **nouvelle** migration.
   - En **développement uniquement**, on peut repartir de zéro avec `npx prisma migrate reset`
     depuis `app/` (⚠️ efface toutes les données locales).
4. Relancer : `docker compose up -d`, puis vérification de santé (3.2).

> Sur une base de **production** : toute réparation manuelle (SQL à la main,
> `prisma migrate resolve`) passe par une **escalade**. Faire une sauvegarde (section 5.4) avant
> toute intervention.

### 5.4 Sauvegarder et restaurer la base ⚠️ *à tester*

**Sauvegarde** :

```bash
cd ~/agentdesk
docker compose exec -T db pg_dump -U agentdesk agentdesk > backup-$(date +%F).sql
ls -lh backup-*.sql
```

- `-T` désactive le terminal interactif, qui corromprait le fichier de sortie.
- Remplacer `agentdesk` si `POSTGRES_USER` ou `POSTGRES_DB` diffèrent dans `.env`.
- Les fichiers `backup-*.sql` contiennent des données : **ne pas les commiter**, et les ranger
  **ailleurs** que sur la même machine pour une vraie sauvegarde.

**Restauration** (sur une base vide) :

```bash
docker compose exec -T db psql -U agentdesk -d agentdesk < backup-AAAA-MM-JJ.sql
```

---

## 6. Modèles de langage

### 6.1 Gérer les modèles

Les modèles sont stockés dans le volume `agentdesk_ollama-data`, pas dans l'image ni dans Git.
Dans le service `app` du compose, `DEFAULT_MODEL` définit le modèle par défaut et `KNOWN_MODELS`
la **liste blanche** des modèles autorisés.

```bash
docker compose exec ollama ollama pull <modèle>     # télécharger (empreinte sha256 vérifiée)
docker compose exec ollama ollama list              # modèles disponibles sur le disque
docker compose exec ollama ollama ps                # modèles chargés en VRAM (PROCESSOR : 100% GPU attendu)
```

**Modèles autorisés** : `granite4.1:3b` (défaut), `qwen3:4b`, `llama3.2:3b`.

**Ajouter un modèle ou changer le modèle par défaut** :

1. Télécharger le modèle **d'abord** : `docker compose exec ollama ollama pull <modèle>`
   (sinon la classification répond 502).
2. L'ajouter à `KNOWN_MODELS` dans `docker-compose.yml`, et dans `app/.env` pour le mode
   développement. **Sans cette étape, la classification répond 400 « Modèle non autorisé ».**
3. Si besoin, modifier `DEFAULT_MODEL`.
4. `docker compose up -d` (Compose recrée uniquement `app`).
5. Vérifier : `curl -s localhost:3000/metrics | grep "<modèle>"` montre les séries du nouveau
   modèle à zéro.

**Comportement à connaître** (GTX 1660 Super, 6 Go de VRAM, ~5 Go disponibles) :

- **Un seul modèle chargé à la fois.** Alterner entre modèles force un rechargement à chaque appel.
- Latence **à froid** (chargement en VRAM) : 5 à 8 s, jusqu'à ~25 s après une longue inactivité
  (cache disque refroidi). **À chaud** : environ 0,7 s.
- Un modèle inutilisé est déchargé après **5 minutes** (`OLLAMA_KEEP_ALIVE`).
- `qwen3:4b` raisonne avant de répondre : 10 à 20 s par classification.

**Vérifier qu'Ollama utilise le GPU** :

```bash
docker compose logs ollama | grep -i "inference compute"
```

Attendu : `library=CUDA` et `NVIDIA GeForce GTX 1660 SUPER`. Si `cpu` apparaît, le modèle
tourne environ 10 fois plus lentement sans rien signaler d'autre : voir la section 8.

> `OLLAMA_NO_CLOUD=true` empêche tout recours aux modèles hébergés : les données ne quittent pas
> l'infrastructure. Vérification : `docker compose logs ollama | grep -i "cloud disabled"` → `true`.

### 6.2 Évaluer les modèles

**Objectif** : comparer des modèles ou des configurations (prompt, modèle) sur le jeu de tests
annoté, **avant** tout changement en production.

```bash
cd ~/agentdesk
docker compose ps -a                             # app healthy
python3 eval/evaluate.py --label "description de la configuration"
python3 eval/evaluate.py --models granite4.1:3b --label "..."   # un seul modèle
```

**Résultat attendu** : progression cas par cas, puis un rapport dans `eval/results/<date>.md`
(et `.json`) : taux d'appels d'outils valides, justesse de la catégorie et de la priorité,
latence médiane et p95, détail par cas.

**Règles** :

- **Relancer l'évaluation avant tout changement de prompt ou de modèle** et comparer **cas par
  cas** avec la mesure précédente : une moyenne en hausse peut cacher des régressions.
- Après une modification de `app/src/ollama.ts`, **reconstruire l'image** avant d'évaluer
  (`docker compose up -d --build app`), sinon on mesure l'ancien prompt.
- Les règles d'annotation (`eval/RULES.md`) et le prompt système doivent rester cohérents ; les
  exemples donnés au modèle ne doivent jamais être des cas du jeu de tests.
- Commiter chaque rapport avec la configuration qui l'a produit.
- Avec 12 cas, un cas pèse 8 points : seuls les grands écarts sont significatifs.

**Si ça ne va pas** :

- `API injoignable` : l'app ne tourne pas (section 3.2). Le script vérifie `/health` avant de commencer.
- Un cas en `HTTP 502` : le modèle a échoué sur ce cas ; le script l'enregistre et continue.
- Un cas en `HTTP 400` : modèle absent de `KNOWN_MODELS` (section 6.1).

---

## 7. Observabilité

| Outil | Adresse | Rôle |
|---|---|---|
| `/metrics` | `http://localhost:3000/metrics` | Photo instantanée des métriques de l'API |
| Prometheus | `http://localhost:9090` | Relève `/metrics` toutes les 15 s, garde 15 jours d'historique, évalue les alertes |
| Grafana | `http://localhost:3001` | Tableau de bord **AgentDesk** (dossier AgentDesk) |

**Fichiers** :

| Fichier | Rôle |
|---|---|
| `app/src/metrics.ts` | Déclaration des métriques |
| `ops/prometheus/prometheus.yml` | Cibles et fréquence de relevé |
| `ops/prometheus/alerts.yml` | Règles d'alerte |
| `ops/grafana/provisioning/datasources/prometheus.yml` | Source de données (`uid: prometheus`) |
| `ops/grafana/provisioning/dashboards/agentdesk.yml` | Emplacement des tableaux de bord |
| `ops/grafana/dashboards/agentdesk.json` | Le tableau de bord |

Ces fichiers sont montés **en lecture seule** dans les conteneurs ; les données vivent dans les
volumes `agentdesk_prometheus-data` et `agentdesk_grafana-data`.

### 7.1 Vérifier que la surveillance fonctionne

```bash
curl -s localhost:3000/metrics | grep agentdesk_ | head
```

Puis dans le navigateur :

- `http://localhost:9090/targets` : `agentdesk-app` et `prometheus` en **UP** ;
- `http://localhost:9090/alerts` : règles en **Inactive** en temps normal ;
- `http://localhost:3001` : tableau **AgentDesk**, panneau **API** à « En ligne ».

### 7.2 Réagir à une alerte

| Alerte | Première vérification | Ensuite |
|---|---|---|
| `AgentDeskApiDown` (critique) | `docker compose ps -a app`, puis `docker compose logs --tail=100 app` | Section 3.2 ; escalader si l'API ne revient pas (section 10) |
| `AgentDeskInvalidToolCallsHigh` (avertissement) | Quel modèle (étiquette de l'alerte)? Un modèle ou le prompt a-t-il changé récemment? | Relancer l'évaluation (section 6.2) ; revenir à la configuration précédente si la régression est confirmée |

États d'une alerte : **Inactive** (condition fausse) → **Pending** (condition vraie, délai `for:`
pas encore écoulé) → **Firing** (déclenchée). Le délai évite d'alerter pour un simple redémarrage.

### 7.3 Modifier le tableau de bord ou les alertes

- **Tableau de bord** : modifier `ops/grafana/dashboards/agentdesk.json`, valider le JSON
  (`python3 -m json.tool <fichier> > /dev/null`), puis passer par une PR. Grafana relit le fichier
  automatiquement ; les modifications faites dans l'interface sont refusées.
- **Alertes ou cibles** : modifier les fichiers de `ops/prometheus/`, puis
  `docker compose restart prometheus`, et vérifier les pages *Targets* et *Alerts*.

### 7.4 Bonnes pratiques

- **Ne jamais changer l'`uid` d'une source de données déjà créée** sans transition
  (voir l'incident du 2026-10-03). Toute nouvelle ressource reçoit un `uid` stable dès sa création.
- **Étiquettes** : uniquement des valeurs connues et peu nombreuses. Jamais d'identifiant, de
  courriel ou de texte libre.
- **Une série n'existe qu'à partir de son premier événement** : initialiser à zéro les
  combinaisons connues au démarrage (fait pour chaque modèle de `KNOWN_MODELS`), sinon la première
  rafale n'est pas comptée par `rate()`.
- **Un chiffre affiché doit avoir un sens précis** : pour un chiffre unique, requête instantanée,
  et texte explicite quand il n'y a pas de données.
- Les compteurs repartent de zéro au redémarrage de l'app : c'est normal, `rate()` le gère.

---

### 7.5 Accès des agents à la base (serveur MCP)

Les agents de Claude Code lisent la base par le serveur MCP `agentdesk-db` (DBHub), défini dans
`.mcp.json` et configuré dans `ops/mcp/dbhub.toml`. Trois couches de lecture seule :

1. **DBHub** (`readonly = true`) : refuse les requêtes d'écriture d'après leur texte. Contournable
   par une écriture déguisée : ce n'est pas la protection principale.
2. **L'utilisateur PostgreSQL `agentdesk_lecture`** (`ops/db/lecture-seule.sql`) : droit `SELECT`
   sur `messages` et `classification_runs` uniquement, transactions en lecture seule, requêtes
   limitées à 5 s. **C'est la vraie barrière** : la base refuse toute écriture.
3. **L'approbation humaine** de chaque appel à l'outil (mode manuel).

Mise en place : appliquer `ops/db/lecture-seule.sql`, définir le mot de passe avec
`\password agentdesk_lecture` dans `psql`, et l'exporter dans `AGENTDESK_LECTURE_PASSWORD`.
Toute nouvelle table lisible par les agents doit être accordée explicitement (`GRANT SELECT`).
Le rôle est perdu si le volume de la base est supprimé.

Seuls les agents **reviseur** et **testeur** ont accès à cet outil.

---

## 8. Dépannage

| Symptôme | Cause probable | Vérification | Action |
|---|---|---|---|
| `ports are not available` au démarrage | Un autre programme occupe le port | PowerShell : `netstat -ano \| findstr :<port>` puis `tasklist /FI "PID eq <pid>"`. Ubuntu : `ss -ltnp \| grep <port>` | Changer le port **côté hôte** (`127.0.0.1:<autre>:<port conteneur>`) plutôt que d'arrêter un programme hors périmètre |
| `variable is not set` dans `docker compose config` | Variable absente du `.env` **racine** | `cut -d= -f1 .env` | L'ajouter au `.env` racine (et au `.env.example`) |
| `docker: command not found` dans Ubuntu | Docker Desktop n'est pas lancé | Icône Docker côté Windows | Lancer Docker Desktop, attendre *Engine running* |
| WSL : erreur `0x80370102` | Virtualisation désactivée (BIOS) **ou** hyperviseur Windows désactivé | Gestionnaire des tâches → Processeur → Virtualisation ; puis `bcdedit /enum "{current}" \| findstr -i hypervisor` | Activer SVM/VT-x dans le BIOS ; `bcdedit /set hypervisorlaunchtype auto` puis redémarrer |
| Classification très lente, sans erreur | Ollama sur CPU au lieu du GPU, ou chargement à froid | `docker compose logs ollama \| grep -i "inference compute"` ; `ollama ps` | Si CPU : vérifier `nvidia-smi` et le bloc `deploy.resources` du compose. Sinon, relancer : la seconde classification doit être rapide |
| `/messages/:id/classify` répond **502** | Ollama injoignable ou modèle non téléchargé | `docker compose logs app` (ligne `échec de l'appel à Ollama`) ; `ollama list` | Télécharger le modèle ou relancer `ollama` |
| `/messages/:id/classify` répond **400** « Modèle non autorisé » | Modèle absent de `KNOWN_MODELS` | Variable `KNOWN_MODELS` du service `app` | Section 6.1 |
| `DELETE /messages/:id` répond **400** alors que l'id est valide | Requête envoyée avec `Content-Type: application/json` et un corps vide : Fastify la rejette (`FST_ERR_CTP_EMPTY_JSON_BODY`) avant la validation de l'id | `docker compose logs app` ; relancer `curl -v` pour voir les en-têtes envoyés | Ne pas envoyer l'en-tête `Content-Type` sur un DELETE : `curl -X DELETE localhost:3000/messages/$ID` |
| `/health` répond **503** | La base ne répond pas | `docker compose ps -a db` ; `docker compose logs db` | Relancer `db`. L'app se reconnecte seule |
| Routes en 404 alors que le code les contient | Ancienne version du serveur encore en marche | `/health` : format de réponse attendu? `ss -ltnp \| grep 3000` | Arrêter le processus en trop, relancer |
| Le code modifié n'a aucun effet dans le conteneur | Fichier non sauvegardé, ou image non reconstruite | `grep` dans le fichier source, puis `docker compose exec app grep -c "<texte>" dist/src/<fichier>.js` | Sauvegarder, puis `docker compose up -d --build app` |
| `npx` propose d'installer un paquet | Mauvais dossier courant | `pwd` | Répondre `n`, se placer dans `app/`, utiliser les scripts `npm run ...` |
| Le build Docker envoie des centaines de Mo | `.dockerignore` absent ou mal placé | Début du build : `load .dockerignore` (quelques octets = absent) | Placer `.dockerignore` dans `app/`, reconstruire, `docker builder prune -f` |
| `migrate` en `Exited (1)`, `app` absent | Échec de migration | `docker compose logs migrate` | Section 5.3 |
| Cible `agentdesk-app` en **DOWN**, `lookup app on 127.0.0.11:53: no such host` | Le conteneur `app` est arrêté : son nom a disparu de l'annuaire DNS de Docker | `docker compose ps -a app` | Relancer `app` ; section 3.2 |
| Grafana redémarre en boucle, `Datasource provisioning error` | Provisionnement incohérent avec l'état existant (ex. `uid` modifié) | `docker compose logs grafana --since 5m` | Voir l'incident du 2026-10-03 (`deleteDatasources` temporaire) |
| Un panneau Grafana affiche « No data » | Aucun événement sur la période, ou série jamais créée | Requête dans *Explore* ; `curl -s localhost:3000/metrics \| grep <métrique>` | Élargir la période ; vérifier l'initialisation des séries |
| La PR ne peut pas être fusionnée | CI rouge, ou branche en retard sur `main` | Section *Checks* de la PR | Section 3.6 ; si la branche est en retard : bouton *Update branch* ou `git merge main` |

Chaque incident réel est consigné dans `INCIDENTS.md` (symptôme, cause, correctif, vérification).

---

## 9. Règles de sécurité

1. **Les secrets ne vont jamais dans Git.** `.env` et `app/.env` sont ignorés ; seuls les
   `.env.example` sont commités. Vérifier avec `git status` avant chaque commit, et
   `git check-ignore -v <fichier>` en cas de doute.
2. **Les secrets ne vont jamais dans une image.** `app/.dockerignore` exclut `.env` et
   `node_modules` ; le build multi-étapes n'embarque que `dist`, `prisma` et la configuration.
   Vérification : `docker run --rm agentdesk-app:local ls -la` ne montre aucun `.env`.
3. **Les secrets ne s'affichent pas.** Ni capture d'écran d'un `.env`, ni sortie de
   `docker compose config` (qui affiche les valeurs en clair). Vérifier avec `cut -d= -f1 .env`
   ou `grep -c`. Un mot de passe différent par service.
4. **Les ports sont publiés sur `127.0.0.1` uniquement.** L'API d'Ollama n'a aucune
   authentification ; la base, Prometheus et Grafana ne doivent pas être joignables depuis le réseau.
5. **Aucune donnée ne sort sans décision explicite** : `OLLAMA_NO_CLOUD=true`, télémétrie de
   Grafana désactivée. Un service hébergé (ex. Jev) ne reçoit que des données non sensibles.
6. **Le conteneur de l'app tourne sans privilèges** (`USER node`). Vérification :
   `docker run --rm agentdesk-app:local id` → `uid=1000(node)`.
7. **Liste blanche des modèles** (`KNOWN_MODELS`) : aucune valeur fournie par un client ne devient
   une étiquette de métrique sans être validée.
8. **`npx` qui propose d'installer : réponse `n`, puis `pwd`.** Un paquet au nom d'une commande
   n'est pas forcément l'outil attendu (ex. le paquet `tsc` n'est pas TypeScript). Dans les
   automatisations (compose, CI), appeler les exécutables directement ou via `npm run`.
9. **Commandes destructives** (`rm -rf`, `docker volume rm`, `down -v`) : `pwd` ou
   `docker volume ls` juste avant, noms écrits en entier, une commande à la fois.
10. **Vulnérabilités des dépendances** : `npm audit` se **trie** (paquet concerné, usage en
    production, exploitabilité réelle) et se **compare** à la liste déjà acceptée avant d'agir.
    **Jamais `npm audit fix --force`** sans analyse : il peut changer de version majeure, y compris
    à la baisse. Les dépendances dépréciées sont remplacées. Décisions consignées dans `SECURITY.md`.
11. **Scripts d'installation npm** : approuver seulement des paquets identifiés
    (`npm install-scripts ls`, puis `approve <paquet>`).
12. **Images fixées en version** (`postgres:17-alpine`, `ollama/ollama:0.34.4`,
    `prom/prometheus:v3.15.0`, `grafana/grafana:13.2.3`), jamais `latest`. Lire les notes de
    version avant de changer de version majeure.

---

## 10. Quand escalader

S'arrêter et demander de l'aide **avant d'agir** dans ces situations :

- Toute opération **destructive** sur des données de production (suppression de volume,
  réinitialisation, SQL manuel).
- Une **migration échouée en production**, ou un retour en arrière de version qui implique
  une migration.
- Une alerte **critique** qui ne se résout pas avec les vérifications de la section 7.2.
- Un **secret potentiellement exposé** (commité, présent dans une image, affiché dans des logs
  ou une capture d'écran) : le secret doit être changé, pas seulement retiré.
- Une vulnérabilité **exploitable** dans notre contexte.
- Un problème **bloquant depuis plus d'une heure** sans nouvelle piste.

**Informations à fournir** : le symptôme exact (message d'erreur complet), ce qui a déjà été
vérifié, ce qui a été tenté, et l'état actuel (`docker compose ps -a`).