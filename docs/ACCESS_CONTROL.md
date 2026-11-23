# Matrice des accès

| Ressource / champ | Administrateur central | Catégorie 1 | Catégorie 2 |
|---|---:|---:|---:|
| Lecture des rapports | Tous départements | Départements affectés | Départements affectés |
| A, B, C, D, F | Modifier | Modifier | Lecture seule |
| G | Modifier | Lecture seule | Lecture seule |
| H | Calcul système | Lecture seule | Lecture seule |
| Enrôlement initial / ratissage / corrections de dossiers | Contrôle global | Modifier | Lecture seule |
| Livraison initiale / ratissage / première remise après correction / réimpression | Contrôle global | Lecture seule | Modifier |
| Établissements hors périmètre | Oui | Non | Non |

## Affectations multi-départements

- Une affectation correspond à un utilisateur, un département et un rôle.
- Le même utilisateur peut avoir plusieurs départements.
- Il peut avoir Catégorie 1 dans un département et Catégorie 2 dans un autre.
- Il peut aussi cumuler les deux rôles dans un même département.
- L'accès « Tous mes départements » agrège uniquement les départements affectés au compte.
- L'administrateur central peut consulter et administrer tous les départements.

## Application des droits

Les fonctions PostgreSQL contrôlent les autorisations champ par champ. Le frontend n'est jamais une barrière de sécurité.

- `has_department_access` contrôle le périmètre départemental.
- `has_department_role` contrôle un rôle précis dans un département.
- `assign_department_role` est réservé à l'administrateur central.
- `record_school_report_operation` contrôle le rôle, le périmètre, la capacité de la classe et les plafonds de livraison dans une transaction.
- Les écritures directes des tables métier depuis le navigateur restent interdites.
