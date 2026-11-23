# Règles métier validées — Rapports scolaires

## 1. Périmètre et responsabilités

- Le référentiel national des classes/promotions possibles est créé et géré exclusivement par l’administration centrale.
- Le référentiel national n’est rattaché à aucune école : une classe catalogue décrit un niveau possible, pas une classe réellement ouverte dans un établissement.
- Catégorie 1 sélectionne, dans son rapport, les classes du référentiel qui existent réellement dans son établissement et renseigne l’effectif total, l’enrôlement initial, les ratissages et les corrections de dossiers.
- Les groupes pédagogiques réellement présents dans une école restent propres à l’établissement, à l’année scolaire et à la classe catalogue sélectionnée.
- Catégorie 2 ne crée pas de classe : elle sélectionne une classe déjà présente dans le rapport et enregistre les livraisons initiales, les livraisons après ratissage, les premières remises après correction et les réimpressions.
- Les corrections de dossiers ne sont pas de nouveaux enrôlements.
- Les réimpressions/remplacements de cartes déjà remises ne sont pas de nouvelles livraisons uniques.
- Une classe catalogue désactivée n’est plus proposée pour de nouvelles sélections, mais reste conservée pour l’historique des rapports existants.

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

## 6. Affectation des classes aux établissements

- La Catégorie 1 sélectionne les classes réellement présentes dans son établissement à partir du catalogue national actif.
- La sélection est enregistrée par établissement, année scolaire, classe du catalogue et groupe pédagogique.
- Le modèle existant `pedagogical_groups` est réutilisé : aucune table parallèle d’affectation des classes n’est créée.
- Le code du groupe pédagogique est unique pour une combinaison établissement + année scolaire + classe catalogue.
- Une sélection est autorisée uniquement pour un établissement actif, une année scolaire active, une classe catalogue active et un département où l’utilisateur possède le rôle Catégorie 1.
- La Catégorie 2 consulte les classes déjà configurées, sans pouvoir les créer.
- Les groupes déjà utilisés dans des rapports sont conservés pour l’historique.
