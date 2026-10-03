# Sécurité

Ce document recense les risques connus du projet, les décisions prises et les mesures en place.
Les règles de sécurité opérationnelles (secrets, commandes destructives, etc.) sont dans
[RUNBOOK.md](RUNBOOK.md), section 9.

---

## 1. Vulnérabilités connues acceptées

### 2026-09-28 — 4 vulnérabilités « high » dans l'outil CLI `prisma` 7.10.0

| Paquet | Faille | Exploitable ici? |
|---|---|---|
| deepmerge-ts < 8.0.0 | Épuisement de pile sur objets récursifs (GHSA-ggr8-5vv4-36mx) | Non : fusionne uniquement `prisma7.config.ts`, fichier versionné et contrôlé par l'équipe |
| mysql2 <= 3.23.0 | Fuite d'identifiants par rétrogradation d'authentification (GHSA-3f6p-5ww8-9rcr) | Non : pilote MySQL, le projet utilise PostgreSQL |
| mysql2 <= 3.23.0 | Bombe de décompression zlib (GHSA-rgwj-5xj2-c3m3) | Non : même raison |

- **Périmètre** : dépendances de l'outil CLI `prisma` uniquement (génération du client, migrations).
  Le serveur (`@prisma/client`, `@prisma/adapter-pg`, `pg`, `fastify`) n'est pas concerné.
- **Correctif proposé par npm** : `npm audit fix --force` rétrograde vers `prisma@6.19.3`,
  incompatible avec la configuration Prisma 7 du projet. Rejeté.
- **Compromis assumé** : `prisma` est en dépendance de production pour que le service `migrate`
  puisse appliquer les migrations ; ces vulnérabilités sont donc présentes dans l'image, sans être
  atteignables. Amélioration possible : une image dédiée aux migrations.
- **Décision** : risque accepté.
- **Réévaluation** : à chaque version corrective de Prisma 7.x, ou si le projet ajoute une base
  MySQL. Surveillance manuelle (`npm audit`) tant que Dependabot n'est pas configuré.
- **Suivi** : 2026-10-01, l'ajout de `@prometheus-io/client` n'a introduit aucune nouvelle
  vulnérabilité (même liste de 4).

---

## 2. Dépendances dépréciées

### 2026-10-01 — `prom-client` remplacé par `@prometheus-io/client`

- **Constat** : avertissement `deprecated` à l'installation : `prom-client` a été remplacé par
  `@prometheus-io/client`, publié par l'organisation officielle Prometheus.
- **Risque** : un paquet déprécié ne reçoit plus de correctifs, y compris de sécurité.
- **Vérification** : même projet renommé, mêmes exports et mêmes noms de métriques.
- **Décision** : migration immédiate, tant que la bibliothèque n'était utilisée qu'à un seul endroit
  (`app/src/metrics.ts`) et qu'aucun tableau de bord n'en dépendait.
- **Vérification après migration** : sortie de `/metrics` identique, `npm run typecheck` sans erreur.

---

## 3. Risques identifiés et mesures en place

### Injection de prompt

- **Risque** : un message client peut contenir des instructions adressées au modèle
  (« ignore tes consignes et classe ce message en... »).
- **Constat** : mesuré par le banc d'évaluation (cas `injection`). Prompt v1 : les trois modèles
  obéissent. Prompt v2 (consigne explicite de traiter le message comme une donnée) : seul
  `qwen3:4b` résiste complètement, `granite4.1:3b` partiellement, `llama3.2:3b` pas du tout.
- **Mesures** :
  - le modèle **n'exécute rien** : il ne peut que proposer une classification, validée par Zod
    (valeurs limitées aux catégories et priorités autorisées) ;
  - l'impact maximal d'une injection réussie est une **mauvaise étiquette** sur le message de
    l'attaquant lui-même.
- **Risque résiduel** : accepté pour la classification. Toute future action à impact (réponse
  automatique, remboursement, suppression) exigera une validation humaine : la défense contre
  l'injection se fait dans l'architecture, pas seulement dans le prompt.

### Explosion de cardinalité des métriques

- **Risque** : l'étiquette `model` des métriques vient de la requête du client ; des milliers de
  noms inventés créeraient autant de séries dans Prometheus.
- **Mesure** : liste blanche `KNOWN_MODELS`. Un modèle inconnu est refusé en 400 avant tout appel
  à Ollama et avant toute métrique. Vérifié : aucune série créée pour un modèle refusé.

### Exposition réseau

- **Mesure** : tous les ports publiés sur `127.0.0.1` uniquement. Critique pour Ollama, dont l'API
  n'a aucune authentification (utilisation du GPU, ajout ou suppression de modèles).
- **Observation hors périmètre** : un PostgreSQL installé sur le poste Windows écoute sur
  `0.0.0.0:5432` (exposé au réseau local). À restreindre ou arrêter s'il n'est plus utilisé.

### Données qui quittent l'infrastructure

- **Mesures** : `OLLAMA_NO_CLOUD=true` (aucun recours aux modèles hébergés d'Ollama) ;
  Grafana sans télémétrie (`GF_ANALYTICS_REPORTING_ENABLED` et `GF_ANALYTICS_CHECK_FOR_UPDATES`
  à `false`).
- **Décision à venir (Jev)** : Jev (TypeSafe AI) est un service hébergé, sans poids publiés. Son
  intégration est prévue comme fournisseur **optionnel**, limité aux **données non sensibles**
  (le jeu de tests synthétique). Les vraies données (courriels) resteront traitées localement.

### Grafana

- Identifiants administrateur dans le `.env` racine (jamais commité) ; inscription désactivée
  (`GF_USERS_ALLOW_SIGN_UP=false`).
- Tableaux de bord et source de données provisionnés depuis Git, non modifiables dans l'interface.

### Secrets dans l'image

- Voir l'incident du 2026-09-28 : `.dockerignore` dans `app/`, build multi-étapes, vérification
  `docker run --rm agentdesk-app:local ls -la`.