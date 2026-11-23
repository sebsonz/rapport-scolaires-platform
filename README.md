# Plateforme de gestion des rapports scolaires

V1 en construction pour l'année scolaire 2026-2027.

## Architecture
- `apps/web`: application React + TypeScript + Vite.
- `supabase/migrations`: schéma PostgreSQL, contraintes et politiques RLS.
- `docs`: décisions métier, matrice des accès et règles de calcul.

## Principes de sécurité
- Aucun utilisateur métier n'accède directement au classeur source.
- L'accès est limité au département et aux écoles affectés.
- Catégorie 1 : modification des champs A, B, C, D et F.
- Catégorie 2 : modification des champs I, K et L.
- Colonne G : administrateur central uniquement.
- Colonne H : calculée par le système.
- Les contrôles d'autorisation sont appliqués en base et côté serveur.

## État
Fondation initiale. Les valeurs de démonstration ne sont pas officielles.
