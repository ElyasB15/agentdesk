-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_runs" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "category" TEXT,
    "priority" TEXT,
    "summary" TEXT,
    "tool_call_valid" BOOLEAN NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classification_runs_message_id_idx" ON "classification_runs"("message_id");

-- AddForeignKey
ALTER TABLE "classification_runs" ADD CONSTRAINT "classification_runs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
