import { Counter, Histogram, Registry, collectDefaultMetrics } from "@prometheus-io/client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "agentdesk_http_request_duration_seconds",
  help: "Durée des requêtes HTTP, par méthode, route et code de statut",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const classificationsTotal = new Counter({
  name: "agentdesk_classifications_total",
  help: "Classifications effectuées, par modèle et validité de l'appel d'outil",
  labelNames: ["model", "tool_call_valid"] as const,
  registers: [registry],
});

export const classificationDuration = new Histogram({
  name: "agentdesk_classification_duration_seconds",
  help: "Latence d'une classification, par modèle",
  labelNames: ["model"] as const,
  buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 40],
  registers: [registry],
});

export const classificationErrorsTotal = new Counter({
  name: "agentdesk_classification_errors_total",
  help: "Échecs d'appel au service de modèles, par modèle",
  labelNames: ["model"] as const,
  registers: [registry],
});