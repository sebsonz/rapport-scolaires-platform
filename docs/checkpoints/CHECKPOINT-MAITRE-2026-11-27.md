# CHECKPOINT MAÎTRE — RAPPORTS SCOLAIRES 2026-2027

Date : 27 novembre 2026
Dépôt : sebsonz/rapport-scolaires-platform
Projet : portail Web multi-rôles de collecte et consultation des rapports scolaires 2026-2027.

## 1. Objectif et principes du projet

Construire un portail Web multi-rôles permettant aux utilisateurs départementaux et aux écoles de saisir et consulter les rapports scolaires sans accès direct au classeur Google Sheets / Excel.

Le portail doit respecter strictement les rôles, la séparation des responsabilités, les périmètres départementaux et les règles d'écriture des colonnes. Le classeur reste une référence métier, mais les utilisateurs travaillent via l'application.

## 2. Règles métier déjà verrouillées

- La colonne G est réservée exclusivement à l'administrateur central.
- Catégorie 1 saisit les colonnes A, B, C, D et F.
- Catégorie 2 saisit les colonnes I, K et L.
- La colonne H est renseignée automatiquement par le système.
- Les membres départementaux consultent le rapport complet des écoles de leur département, mais ne modifient que les colonnes autorisées par leur catégorie.
- Ne pas élargir les permissions d'un rôle pour contourner un problème d'interface ou de données.
- Préserver les règles de cloisonnement et les contrôles côté serveur / base de données, pas seulement dans l'interface.

## 3. État GitHub vérifié le 27 novembre 2026

Dépôt : https://github.com/sebsonz/rapport-scolaires-platform
Branche par défaut : main
Branche intégrée à importer : feat/automatic-delivery-slips-integrated
Lien branche : https://github.com/sebsonz/rapport-scolaires-platform/tree/feat/automatic-delivery-slips-integrated

La branche `feat/automatic-delivery-slips-integrated` a été retrouvée sur GitHub. Le fichier `apps/web/src/SchoolReportDashboard.tsx` a été lu sur cette branche et confirme l'intégration des deux bordereaux.

Commit annoncé dans l'échange précédent : `d25ffb9` (à revérifier en local après import).

## 4. Intégration des bordereaux — état validé sur GitHub

Dans `apps/web/src/SchoolReportDashboard.tsx`, les imports incluent :
```tsx
import SchoolPedagogicalClasses from './SchoolPedagogicalClasses';
import DeliverySlips from './DeliverySlips';
import AutomaticDeliverySlips from './AutomaticDeliverySlips';

const SchoolCorrectionReasons = lazy(() => import('./features/school-correction-reasons/SchoolCorrectionReasons'));
```

La section bordereaux contient les deux composants :
```tsx
<section id="bordereaux">
  <DeliverySlips memberships={memberships}/>
  {(memberships.some(item => item.role === 'CENTRAL_ADMIN') ||
    memberships.some(item => item.role === 'CATEGORY_2')) &&
    <AutomaticDeliverySlips memberships={memberships}/>}
</section>
```

Règles :
- `DeliverySlips` est l'ancien bordereau manuel/historique : le conserver intact.
- `AutomaticDeliverySlips` est un composant séparé, ajouté en complément.
- Le bordereau automatique est rendu uniquement pour `CENTRAL_ADMIN` et `CATEGORY_2`.
- Les motifs de correction (`SchoolCorrectionReasons`) restent intégrés via lazy import.

## 5. Contenu annoncé de la branche intégrée

La branche est annoncée comme contenant :
- conservation du bordereau manuel historique ;
- ajout du module de bordereau automatique ;
- migration SQL additive associée ;
- intégration des deux bordereaux dans le tableau de bord ;
- motifs de modification présents dans la branche de départ `feat/school-correction-reasons-ui`.

Ne pas considérer la migration comme appliquée à un environnement : son statut DEV/STAGING/PRODUCTION doit être vérifié séparément avant toute opération SQL.

## 6. Situation du dépôt local — point critique à traiter en premier

Lors de la dernière session, le dépôt local était au milieu d'une tentative de merge en conflit. Il a été recommandé d'exécuter :
```bash
git merge --abort
```

Cette commande n'a PAS été confirmée comme exécutée. Il faut donc commencer par vérifier l'état réel du dépôt local.

Les deux fichiers non suivis mentionnés précédemment ne doivent pas être supprimés. Ne pas utiliser `git reset --hard`, `git clean`, ni aucune commande destructive.

## 7. Procédure de reprise locale — à faire dans cet ordre

Dans PowerShell, depuis le dossier local du projet :
```powershell
Set-Location D:\Projets\rapport-scolaires-platform
git status --short
git branch --show-current
git merge --abort
git status --short
```

Important :
- Exécuter `git merge --abort` uniquement si un merge est effectivement en cours. Si Git répond qu'aucun merge n'est en cours, ne pas insister.
- Examiner et préserver les fichiers non suivis / modifications locales.
- Ne pas lancer de commit, push, migration en production ou déploiement.

Ensuite importer la branche vérifiée :
```powershell
git fetch origin
git switch -c feat/automatic-delivery-slips-integrated --track origin/feat/automatic-delivery-slips-integrated
```

Si la branche locale existe déjà :
```powershell
git switch feat/automatic-delivery-slips-integrated
git pull --ff-only
```

Puis contrôler :
```powershell
git status --short
git branch --show-current
git log -1 --oneline
git diff --check
```

Si les commandes révèlent des modifications locales non commitées qui pourraient être écrasées par le changement de branche, s'arrêter et examiner avant toute action. Ne pas forcer le switch.

## 8. Prochaines étapes après import

1. Vérifier le statut Git local et confirmer que les marqueurs de conflit ont disparu.
2. Vérifier l'existence et le contenu des fichiers :
   - `apps/web/src/DeliverySlips.tsx` (ou son chemin réel)
   - `apps/web/src/AutomaticDeliverySlips.tsx` (ou son chemin réel)
   - `apps/web/src/features/school-correction-reasons/SchoolCorrectionReasons.tsx`
   - migration SQL additive associée au bordereau automatique.
3. Lire les composants et la migration avant d'exécuter quoi que ce soit.
4. Vérifier que le bordereau historique n'a pas été modifié ou supprimé.
5. Vérifier les autorisations du bordereau automatique côté UI ET côté base de données / RPC / RLS.
6. Examiner les tests disponibles et exécuter les tests ciblés puis les tests/build du workspace.
7. Vérifier les migrations sur l'environnement DEV seulement, après audit et validation explicite.
8. Garder STAGING et PRODUCTION intacts jusqu'à validation complète.

## 9. Garde-fous de travail

- Aucun commit ni déploiement pour le moment, sauf demande explicite ultérieure.
- Ne pas appliquer de migration en production.
- Ne pas supprimer de fichiers non suivis ou de changements locaux.
- Ne pas réécrire le module historique DeliverySlips.
- Ne pas contourner les permissions multi-rôles.
- Faire les vérifications à partir du dépôt GitHub actuel et du dépôt local, sans se fier aveuglément aux résumés antérieurs.
- Conserver une approche incrémentale : audit, validation, modification ciblée, tests.

## 10. Message de reprise à utiliser dans une nouvelle discussion

« Reprenons le projet RAPPORTS SCOLAIRES 2026-2027 à partir du checkpoint maître du 27 novembre 2026 dans le dépôt sebsonz/rapport-scolaires-platform. La branche GitHub `feat/automatic-delivery-slips-integrated` existe et son fichier `SchoolReportDashboard.tsx` a été vérifié : les imports DeliverySlips + AutomaticDeliverySlips sont présents et les deux bordereaux sont rendus avec la condition CENTRAL_ADMIN/CATEGORY_2. Le dépôt local était dans une tentative de merge en conflit ; l'exécution de git merge --abort n'est pas encore confirmée. Commence par me guider pour vérifier et sécuriser git status, préserver les fichiers non suivis, annuler uniquement le merge si nécessaire, puis importer la branche intégrée. Aucun commit, push, migration ni déploiement pour le moment. » 
