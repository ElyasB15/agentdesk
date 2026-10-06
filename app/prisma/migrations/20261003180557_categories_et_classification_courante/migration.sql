-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('MODEL', 'HUMAN');

-- AlterTable
ALTER TABLE "classification_runs" ADD COLUMN     "category_id" INTEGER;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "category_id" INTEGER,
ADD COLUMN     "classification_source" "ClassificationSource",
ADD COLUMN     "classified_at" TIMESTAMP(3),
ADD COLUMN     "priority" TEXT;

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "normalized_label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_normalized_label_key" ON "categories"("normalized_label");

-- CreateIndex
CREATE INDEX "classification_runs_category_id_idx" ON "classification_runs"("category_id");

-- CreateIndex
CREATE INDEX "messages_category_id_idx" ON "messages"("category_id");

-- CreateIndex
CREATE INDEX "messages_priority_idx" ON "messages"("priority");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_runs" ADD CONSTRAINT "classification_runs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Migration de données
-- ============================================================

-- 1. Catégories de départ (politique métier de eval/RULES.md)
INSERT INTO "categories" ("label", "normalized_label", "description", "position", "updated_at") VALUES
  ('Livraison',   'livraison',   'Colis non reçu, en retard, perdu, endommagé pendant le transport, suivi de colis.', 1, CURRENT_TIMESTAMP),
  ('Facturation', 'facturation', 'Paiement, facture, prélèvement, remboursement lorsque la cause est un problème de paiement.', 2, CURRENT_TIMESTAMP),
  ('Technique',   'technique',   'Application, site web, connexion, compte, mot de passe, bogue, erreur.', 3, CURRENT_TIMESTAMP),
  ('Autre',       'autre',       'Tout le reste : demande d''information générale, remerciement, sujet sans rapport.', 4, CURRENT_TIMESTAMP);

-- 2. Relier chaque classification existante à sa catégorie, par son nom
UPDATE "classification_runs" AS r
SET "category_id" = c."id"
FROM "categories" AS c
WHERE c."normalized_label" = lower(trim(r."category"));

-- 3. Classification courante de chaque message : sa dernière classification valide
UPDATE "messages" AS m
SET "category_id"           = last_run."category_id",
    "priority"              = last_run."priority",
    "classification_source" = 'MODEL',
    "classified_at"         = last_run."created_at"
FROM (
  SELECT DISTINCT ON ("message_id") "message_id", "category_id", "priority", "created_at"
  FROM "classification_runs"
  WHERE "tool_call_valid" = true AND "category_id" IS NOT NULL
  ORDER BY "message_id", "created_at" DESC
) AS last_run
WHERE m."id" = last_run."message_id";