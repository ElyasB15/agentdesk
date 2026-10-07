import Fastify from "fastify";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./db.js";
import { classify, type ClassifyResult } from "./ollama.js";
import {
  classificationDuration,
  classificationErrorsTotal,
  classificationsTotal,
  httpRequestDuration,
  initModelSeries,
  registry,
} from "./metrics.js";

const app = Fastify({ logger: true });

app.addHook("onResponse", async (request, reply) => {
  httpRequestDuration.observe(
    {
      method: request.method,
      route: request.routeOptions.url ?? "non_trouvee",
      status_code: String(reply.statusCode),
    },
    reply.elapsedTime / 1000,
  );
});

app.get("/health", async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok" };
  } catch (err) {
    app.log.error({ err }, "health check : base de données injoignable");
    return reply.code(503).send({ status: "error", database: "unreachable" });
  }
});


app.get("/metrics", async (_request, reply) => {
  reply.header("Content-Type", registry.contentType);
  return registry.metrics();
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

const KNOWN_MODELS = (process.env.KNOWN_MODELS ?? DEFAULT_MODEL)
  .split(",")
  .map((m) => m.trim())
  .filter((m) => m.length > 0);

initModelSeries(KNOWN_MODELS);

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

    if (!KNOWN_MODELS.includes(model)) {
      return reply.code(400).send({ error: `Modèle non autorisé : ${model}` });
    }

    let result: ClassifyResult;
    try {
      result = await classify(message.content, model);
    } catch (err) {
      request.log.error({ err, model }, "échec de l'appel à Ollama");
      classificationErrorsTotal.inc({ model });
      return reply.code(502).send({ error: "Le service de modèles n'a pas répondu correctement" });
    }

    classificationDuration.observe({ model }, result.latencyMs / 1000);
    classificationsTotal.inc({
      model,
      tool_call_valid: String(result.classification !== null),
    });

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

type DeleteParams = { id: string };

app.delete<{ Params: DeleteParams }>(
  "/messages/:id",
  {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
  },
  async (request, reply) => {
    const { id } = request.params;
    try {
      await prisma.message.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return reply.code(404).send({ error: "Message introuvable" });
      }
      throw err;
    }
    request.log.info({ messageId: id }, "message supprimé");
    return reply.code(204).send();
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