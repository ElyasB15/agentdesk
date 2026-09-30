import Fastify from "fastify";
import { prisma } from "./db.js";
import { classify, type ClassifyResult } from "./ollama.js";

const app = Fastify({ logger: true });

app.get("/health", async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok" };
  } catch (err) {
    app.log.error({ err }, "health check : base de données injoignable");
    return reply.code(503).send({ status: "error", database: "unreachable" });
  }
});

type CreateMessageBody = { content: string };

app.post<{ Body: CreateMessageBody }>(
  "/messages",
  {
    schema: {
      body: {
        type: "object",
        required: ["content"],
        additionalProperties: false,
        properties: {
          content: { type: "string", minLength: 1, maxLength: 10000 },
        },
      },
    },
  },
  async (request, reply) => {
    const message = await prisma.message.create({
      data: { content: request.body.content },
    });
    return reply.code(201).send(message);
  },
);

app.get("/messages", async () => {
  return prisma.message.findMany({
    orderBy: { receivedAt: "desc" },
    take: 50,
    include: { runs: true },
  });
});

const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "granite4.1:3b";

type ClassifyParams = { id: string };
type ClassifyBody = { model?: string };

app.post<{ Params: ClassifyParams; Body: ClassifyBody }>(
  "/messages/:id/classify",
  {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        properties: { model: { type: "string", minLength: 1, maxLength: 100 } },
      },
    },
  },
  async (request, reply) => {
    const message = await prisma.message.findUnique({ where: { id: request.params.id } });
    if (!message) {
      return reply.code(404).send({ error: "Message introuvable" });
    }

    const model = request.body.model ?? DEFAULT_MODEL;

    let result: ClassifyResult;
    try {
      result = await classify(message.content, model);
    } catch (err) {
      request.log.error({ err, model }, "échec de l'appel à Ollama");
      return reply.code(502).send({ error: "Le service de modèles n'a pas répondu correctement" });
    }

    const run = await prisma.classificationRun.create({
      data: {
        messageId: message.id,
        model,
        toolCallValid: result.classification !== null,
        latencyMs: result.latencyMs,
        category: result.classification?.categorie ?? null,
        priority: result.classification?.priorite ?? null,
        summary: result.classification?.resume ?? null,
      },
    });

    return reply.code(201).send(run);
  },
);



const port = Number(process.env.PORT ?? 3000);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "arrêt en cours");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}