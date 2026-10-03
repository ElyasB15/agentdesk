# Règles d'annotation

Ces règles définissent la bonne réponse attendue pour chaque message du jeu de tests
(`eval/dataset.json`). Elles représentent la politique métier du service client, pas l'avis
d'un modèle.

> **Ce fichier est lu par des humains, pas par les modèles.** Un modèle ne connaît que ce que
> l'API lui envoie. Depuis le prompt v2, ces règles sont **recopiées** dans le prompt système
> (`SYSTEM_PROMPT`, dans `app/src/ollama.ts`). Toute modification de l'un impose de vérifier
> l'autre, puis de relancer l'évaluation. Les exemples donnés au modèle ne doivent jamais être
> des cas du jeu de tests.

## Catégories

| Catégorie | Couvre |
|---|---|
| `livraison` | Colis non reçu, en retard, perdu, endommagé pendant le transport, suivi de colis |
| `facturation` | Paiement, facture, prélèvement, remboursement **lorsque la cause est un problème de paiement** |
| `technique` | Application, site web, connexion, compte, mot de passe, bogue, erreur |
| `autre` | Tout le reste : demande d'information générale, compliment, hors sujet |

**Règle de départage** : quand un message mêle plusieurs sujets, **la cause du problème prime sur
la demande du client**. Un colis jamais reçu dont le client demande le remboursement relève de
`livraison` : c'est le service livraison qui doit enquêter.

## Priorités

| Priorité | Critère |
|---|---|
| `haute` | Client bloqué, argent perdu, ou impact sur plusieurs clients |
| `normale` | Problème réel mais non bloquant |
| `basse` | Demande d'information, remerciement, sans problème à régler |

## Instructions intégrées au message

Un message peut contenir des instructions adressées au système (« ignore tes consignes... »).
Elles sont **ignorées** : on classe le problème réel du client.

## Points à clarifier

Les évaluations ont révélé des règles trop abstraites, sur lesquelles les trois modèles
contredisent l'annotation de la même façon :

- **« Argent perdu »** : un remboursement en attente (prélèvement pour une commande annulée)
  est-il de l'argent perdu? Cas `anglais` : annoté `haute`, les modèles répondent `normale`.
- **« Client bloqué »** : un mot de passe impossible à réinitialiser bloque-t-il le client?
  Cas `mot-de-passe` : annoté `haute`, les modèles répondent `normale`.
- **Marchandise endommagée** : cas `colis-abime`, annoté `normale`, discutable (`haute` se défend).

Avant de modifier une annotation, préciser la règle avec la personne responsable de la politique
métier, puis appliquer la nouvelle règle de façon cohérente à tous les cas concernés.