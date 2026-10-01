# Règles d'annotation

Ces règles définissent la bonne réponse attendue pour chaque message du jeu de tests.
Elles représentent la politique métier du service client, pas l'avis d'un modèle.

## Catégories

| Catégorie | Couvre |
|---|---|
| `livraison` | Colis non reçu, en retard, perdu, endommagé pendant le transport, suivi de colis |
| `facturation` | Paiement, facture, prélèvement, remboursement **lorsque la cause est un problème de paiement** |
| `technique` | Application, site web, connexion, compte, bogue, erreur |
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