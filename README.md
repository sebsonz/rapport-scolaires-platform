# Plateforme de gestion des rapports scolaires

V1 en construction pour l'année scolaire 2026-2027.

## Structure
- `apps/web` : application React + TypeScript + Vite.
- `supabase/migrations` : schéma PostgreSQL, RLS et fonctions contrôlées.
- `docs` : périmètre, droits et correspondance du classeur source.

## Règles confirmées
- Catégorie 1 : saisie A, B, C, D et F.
- Catégorie 2 : saisie I, K et L.
- Colonne G : administrateur central uniquement.
- Colonnes E, H et J : calculées par le système d'après les formules observées dans le classeur.
- Lecture complète des rapports du département affecté ; aucun accès aux autres départements.
- Un rapport est conservé par groupe pédagogique et année scolaire.
- Les bordereaux sont historisés et détaillés par promotion/groupe.

## Développement local
```powershell
cd apps/web
npm install
Copy-Item .env.example .env.local
npm run dev
```

L'application démarre actuellement en mode démonstration. La connexion Supabase sera activée après création du projet DEV et configuration des variables d'environnement.

## Sécurité
Les écritures des rapports passent par des fonctions PostgreSQL qui vérifient le rôle et les champs modifiables. Les tables n'accordent pas de droits d'écriture directs aux clients navigateur.

## Important
N'applique pas la migration à un projet de production. Elle est destinée au projet Supabase DEV. Aucun compte, aucune école et aucun effectif fictif ne doit être importé comme donnée officielle.
