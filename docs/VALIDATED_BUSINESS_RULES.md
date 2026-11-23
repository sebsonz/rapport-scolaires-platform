# Règles métier validées — Rapports scolaires

## 1. Périmètre et responsabilités

- Le tableau de bord est commun à Catégorie 1 et Catégorie 2.
- Catégorie 1 crée les classes et renseigne l'effectif total, l'enrôlement initial, les ratissages et les corrections de dossiers.
- Catégorie 2 ne crée pas de classe : elle sélectionne une classe déjà créée et enregistre les livraisons initiales, les livraisons après ratissage, les premières remises après correction et les réimpressions.
- Les corrections de dossiers ne sont pas de nouveaux enrôlements.
- Les réimpressions/remplacements de cartes déjà remises ne sont pas de nouvelles livraisons uniques.

## 2. Calculs officiels par classe

- Total réellement enrôlé = enrôlement initial + ratissages cumulés.
- Reste à enrôler = effectif total - total réellement enrôlé.
- Total livré unique = livraison initiale + livraison ratissage + première remise après correction.
- Réimpressions/remplacements = compteur séparé, exclu du total livré unique.
- Reste à livrer = total réellement enrôlé - total livré unique.
- Taux d'enrôlement = total réellement enrôlé / effectif total × 100.
- Taux de livraison = total livré unique / total réellement enrôlé × 100.

Les deux taux doivent rester entre 0 et 100 %. Une valeur supérieure à 100 % est une anomalie bloquante à corriger, jamais un taux valide. Si le dénominateur est nul, le taux est non calculable.

## 3. Contrôles transactionnels

- Effectif total, enrôlement initial, ratissage et livraisons sont des entiers non négatifs.
- Enrôlement initial ≤ effectif total.
- Enrôlement initial + ratissages cumulés ≤ effectif total.
- Livraisons uniques cumulées ≤ total réellement enrôlé.
- Chaque opération est historisée et porte une clé d'idempotence pour empêcher les doublons dus aux renvois réseau.
- Les opérations de correction de dossier et de réimpression ne gonflent pas les effectifs uniques.
- Les contrôles doivent être exécutés dans PostgreSQL/backend, pas seulement dans le navigateur.

## 4. Utilisateurs multi-départements

- Un compte peut être affecté à plusieurs départements.
- Les rôles sont attribués par département : un utilisateur peut être Catégorie 1 dans un département et Catégorie 2 dans un autre.
- Les deux rôles peuvent aussi être cumulés dans un même département.
- Le tableau de bord affiche « Tous mes départements » uniquement sur le périmètre autorisé, puis une situation détaillée par département.
- L'administrateur central dispose du périmètre global.
- Les statistiques départementales sont agrégées à partir des classes/établissements sans multiplier les lignes par le nombre d'écoles.

## 5. État de l'implémentation

La migration `20261123000200_multi_department_operations_and_statistics.sql` ajoute le registre des opérations, les rôles multiples par département, les contrôles de capacité, la RPC d'enregistrement, l'affectation de rôles et la situation statistique par département.

La connexion Supabase, l'application de la migration et les tests SQL sur un projet DEV restent des étapes distinctes. Ne pas appliquer cette migration en production avant validation.
