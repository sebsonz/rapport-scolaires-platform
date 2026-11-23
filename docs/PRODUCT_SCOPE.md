# Périmètre fonctionnel V1

## Profils
- `CENTRAL_ADMIN` : tous départements, écoles et champs.
- `CATEGORY_1` : écoles de son département ; champs A, B, C, D, F.
- `CATEGORY_2` : écoles de son département ; champs I, K, L.

Les rôles historiques GROUPE1/GROUPE2 ne sont pas assimilés à ces profils sans validation.

## Rapport
Données par année scolaire, établissement et groupe pédagogique. H est calculée automatiquement ; G est exclusivement modifiable par l'administrateur central.

## Livraison
Un établissement peut conserver plusieurs bordereaux historisés. Les lignes portent promotion, groupe et quantité. La règle de validation des totaux sera finalisée avec le métier.

## Statistiques
Filtres : année scolaire, département, établissement, cycle, promotion et période. Les chiffres illustratifs ne sont pas validés.

## Hors périmètre initial
- Migration automatique de formules sans audit.
- Accès direct des utilisateurs au classeur source.
- Import de données fictives en production.
