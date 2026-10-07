#!/bin/bash
# Hook PreToolUse : bloque toute modification d'une migration déjà commitée.
# Code 2 = action bloquée (le message sur stderr est renvoyé à l'agent).

# Échouer fermé : sans jq, on ne peut pas vérifier, donc on bloque.
if ! command -v jq > /dev/null 2>&1; then
  echo "Hook proteger-migrations inopérant : jq est introuvable. Action bloquée par précaution." >&2
  exit 2
fi

FILE=$(jq -r '.tool_input.file_path // empty')

# Pas de chemin de fichier : rien à vérifier.
[ -z "$FILE" ] && exit 0

# On ne s'intéresse qu'aux fichiers de migrations.
case "$FILE" in
  */app/prisma/migrations/*) ;;
  *) exit 0 ;;
esac

# Le fichier est-il déjà suivi par Git (donc commité)?
cd "$CLAUDE_PROJECT_DIR" || exit 2
if git ls-files --error-unmatch "$FILE" > /dev/null 2>&1; then
  echo "Bloqué : $FILE est une migration déjà commitée. Ne jamais modifier une migration existante : créer une nouvelle migration (npm run db:migrate -- --name ...)." >&2
  exit 2
fi

exit 0