# Matrice des accès

| Ressource / champ | Administrateur central | Catégorie 1 | Catégorie 2 |
|---|---:|---:|---:|
| Lecture rapport des écoles du département | Tous départements | Département affecté | Département affecté |
| A, B, C, D, F | Modifier | Modifier | Lecture seule |
| G | Modifier | Lecture seule | Lecture seule |
| H | Calcul système | Lecture seule | Lecture seule |
| I, K, L | Modifier | Lecture seule | Modifier |
| Écoles d'un autre département | Oui | Non | Non |

Les règles de la base sont la référence de sécurité. Le frontend ne constitue jamais une barrière d'autorisation.
