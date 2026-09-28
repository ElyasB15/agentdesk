# Sécurité

## Vulnérabilités connues acceptées

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
- **Décision** : risque accepté.
- **Réévaluation** : à chaque version corrective de Prisma 7.x (surveillée par Dependabot),
  ou si le projet ajoute une base MySQL.