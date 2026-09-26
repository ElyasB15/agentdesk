import Fastify from "fastify";
import { prisma } from "./db.js";

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