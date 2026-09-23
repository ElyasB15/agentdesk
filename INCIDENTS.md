# Journal des incidents

Chaque incident suit le même format : symptôme, cause, correctif, vérification.
L'objectif : que quelqu'un qui rencontre le même problème dans six mois
puisse le régler sans moi.

---

## 2026-09-22 — Module introuvable au lancement du serveur

- **Symptôme** : `npx tsx src/server.ts` échoue avec `ERR_MODULE_NOT_FOUND`
  sur `src/server.ts`. npx propose aussi d'installer tsx.
- **Cause** : commande lancée depuis la racine du repo au lieu du dossier `app/`.
  Le chemin `src/server.ts` est relatif au dossier courant, et tsx est installé
  dans `app/node_modules`.
- **Correctif** : `cd app` avant de lancer la commande.
- **Vérification** : `curl http://localhost:3000/health` répond `{"status":"ok"}`.
- **Prévention** : script `npm run dev` défini dans `app/package.json`.

---

## 2026-09-22 — WSL2 : Ubuntu refuse de démarrer (erreur 0x80370102)

- **Symptôme** : à l'installation, Ubuntu échoue avec
  `WslRegisterDistribution failed with error: 0x80370102`.
- **Diagnostic 1** : Gestionnaire des tâches → Performance → Processeur
  affiche « Virtualisation : Désactivé ».
- **Correctif 1** : activation de SVM Mode dans le BIOS
  (MSI B450M-A PRO MAX, processeur AMD Ryzen 5 2600 :
  F7 → OC → Advanced CPU Configuration → SVM Mode → Enabled).
  Activation des fonctionnalités Windows VirtualMachinePlatform et
  Microsoft-Windows-Subsystem-Linux via `dism.exe`.
- **Vérification 1** : « Virtualisation : Activé ». **Mais l'erreur persiste.**
- **Diagnostic 2** : `bcdedit /enum "{current}" | findstr -i hypervisor`
  affiche `hypervisorlaunchtype Off`. L'hyperviseur Windows ne se lance pas
  au démarrage, probablement désactivé lors d'une installation de VirtualBox.
- **Correctif 2** : `bcdedit /set hypervisorlaunchtype auto`, puis redémarrage.
- **Vérification 2** : `bcdedit` affiche `Auto`, Ubuntu