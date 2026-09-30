#!/usr/bin/env python3
"""Évalue des modèles de classification à travers l'API AgentDesk.

Pour chaque modèle : un appel de chauffe (non compté), puis tous les cas du jeu de tests.
Produit un rapport Markdown et un fichier JSON dans eval/results/.
"""

import argparse
import json
import math
import platform
import statistics
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_MODELS = ["granite4.1:3b", "qwen3:4b", "llama3.2:3b"]


def call(base_url, method, path, payload=None, timeout=120):
    """Appelle une URL et renvoie la réponse JSON. Lève une exception en cas d'échec."""
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def percentile(values, pct):
    """Percentile par rang le plus proche."""
    ordered = sorted(values)
    rank = math.ceil(pct / 100 * len(ordered))
    return ordered[max(rank - 1, 0)]


def load_dataset(path):
    cases = json.loads(path.read_text(encoding="utf-8"))
    for case in cases:
        if not case.get("expected_category") or not case.get("expected_priority"):
            sys.exit(f"Cas non annoté dans {path} : {case.get('id')}")
    return cases


def classify(api, model, message_id):
    """Classe un message et renvoie un résultat normalisé, même en cas d'erreur HTTP."""
    try:
        run = call(api, "POST", f"/messages/{message_id}/classify", {"model": model})
    except urllib.error.HTTPError as err:
        return {"error": f"HTTP {err.code}", "valid": False,
                "category": None, "priority": None, "latency_ms": None}
    return {"error": None, "valid": run["toolCallValid"],
            "category": run["category"], "priority": run["priority"],
            "latency_ms": run["latencyMs"]}


def evaluate_model(api, model, cases, message_ids):
    print(f"\n=== {model} ===")
    warmup = classify(api, model, message_ids[cases[0]["id"]])
    print(f"  chauffe : {warmup['latency_ms']} ms (non comptée)")

    results = []
    for case in cases:
        result = classify(api, model, message_ids[case["id"]])
        result["id"] = case["id"]
        result["category_ok"] = result["category"] == case["expected_category"]
        result["priority_ok"] = result["priority"] == case["expected_priority"]
        results.append(result)
        status = result["error"] or (
            f"{result['category']}/{result['priority']} "
            f"{'✅' if result['category_ok'] else '❌'}{'✅' if result['priority_ok'] else '❌'} "
            f"{result['latency_ms']} ms"
        )
        print(f"  {case['id']:<22} {status}")
    return results


def summarize(results):
    n = len(results)
    latencies = [r["latency_ms"] for r in results if r["latency_ms"] is not None]
    return {
        "cases": n,
        "valid_rate": sum(r["valid"] for r in results) / n,
        "category_accuracy": sum(r["category_ok"] for r in results) / n,
        "priority_accuracy": sum(r["priority_ok"] for r in results) / n,
        "latency_median_ms": statistics.median(latencies) if latencies else None,
        "latency_p95_ms": percentile(latencies, 95) if latencies else None,
        "errors": sum(r["error"] is not None for r in results),
    }


def pct(value):
    return f"{value:.0%}"


def ms(value):
    return "n/a" if value is None else f"{value:.0f} ms"


def build_report(meta, cases, all_results, summaries):
    lines = [
        f"# Évaluation des modèles — {meta['date']}",
        "",
        f"- API : `{meta['api']}`",
        f"- Ollama : `{meta['ollama_version']}`",
        f"- Jeu de tests : {len(cases)} cas (`eval/dataset.json`, règles dans `eval/RULES.md`)",
        f"- Machine : {meta['machine']}",
        "- Protocole : appels regroupés par modèle, un appel de chauffe non compté par modèle",
        "",
        "## Résumé",
        "",
        "| Modèle | Appels d'outils valides | Catégorie juste | Priorité juste | Latence médiane | Latence p95 | Erreurs |",
        "|---|---|---|---|---|---|---|",
    ]
    for model, s in summaries.items():
        lines.append(
            f"| `{model}` | {pct(s['valid_rate'])} | {pct(s['category_accuracy'])} | "
            f"{pct(s['priority_accuracy'])} | {ms(s['latency_median_ms'])} | "
            f"{ms(s['latency_p95_ms'])} | {s['errors']} |"
        )

    models = list(all_results)
    lines += ["", "## Détail par cas", "",
              "| Cas | Attendu | " + " | ".join(f"`{m}`" for m in models) + " |",
              "|---|---|" + "---|" * len(models)]
    for i, case in enumerate(cases):
        cells = []
        for model in models:
            r = all_results[model][i]
            if r["error"]:
                cells.append(r["error"])
            else:
                cells.append(
                    f"{'✅' if r['category_ok'] else '❌'} {r['category']} / "
                    f"{'✅' if r['priority_ok'] else '❌'} {r['priority']}"
                )
        lines.append(
            f"| {case['id']} | {case['expected_category']} / {case['expected_priority']} | "
            + " | ".join(cells) + " |"
        )
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://localhost:3000")
    parser.add_argument("--ollama", default="http://localhost:11434")
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--dataset", type=Path, default=EVAL_DIR / "dataset.json")
    args = parser.parse_args()

    cases = load_dataset(args.dataset)

    try:
        health = call(args.api, "GET", "/health", timeout=5)
    except (urllib.error.URLError, OSError) as err:
        sys.exit(f"API injoignable sur {args.api} : {err}")
    if health.get("database") != "ok":
        sys.exit(f"API en mauvaise santé : {health}")

    try:
        ollama_version = call(args.ollama, "GET", "/api/version", timeout=5)["version"]
    except (urllib.error.URLError, OSError, KeyError):
        ollama_version = "inconnue"

    print(f"Création de {len(cases)} messages...")
    message_ids = {
        case["id"]: call(args.api, "POST", "/messages", {"content": case["content"]})["id"]
        for case in cases
    }

    all_results = {m: evaluate_model(args.api, m, cases, message_ids) for m in args.models}
    summaries = {m: summarize(r) for m, r in all_results.items()}

    now = datetime.now(timezone.utc)
    meta = {
        "date": now.strftime("%Y-%m-%d %H:%M UTC"),
        "api": args.api,
        "ollama_version": ollama_version,
        "machine": f"{platform.system()} {platform.machine()}, Python {platform.python_version()}",
        "models": args.models,
    }
    report = build_report(meta, cases, all_results, summaries)

    stamp = now.strftime("%Y%m%d-%H%M%S")
    results_dir = EVAL_DIR / "results"
    results_dir.mkdir(exist_ok=True)
    (results_dir / f"{stamp}.md").write_text(report, encoding="utf-8")
    (results_dir / f"{stamp}.json").write_text(
        json.dumps({"meta": meta, "summaries": summaries, "results": all_results},
                   indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print("\n" + report)
    print(f"Rapport enregistré dans eval/results/{stamp}.md")


if __name__ == "__main__":
    main()