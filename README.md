# Plateforme de gestion des rapports scolaires

V1 en construction pour l'année scolaire 2026-2027.

## Structure
- `apps/web` : application React + TypeScript + Vite.
- `supabase/migrations` : schéma PostgreSQL, RLS et fonctions contrôlées.
- `supabase/tests` : tests SQL de règles métier.
- `docs` : périmètre, droits et correspondance du classeur source.

## Environnement Supabase DEV
Projet DEV configuré :
- URL : `https://ajsymouuzretgditttub.supabase.co`
- Project Ref : `ajsymouuzretgditttub`

Dans `apps/web`, copier le modèle d'environnement :
```powershell
Copy-Item .env.example .env.local
```
Puis renseigner la clé publique publishable (ou anon legacy) dans `.env.local` depuis Supabase > Project Settings > API Keys.

Variables :
- `VITE_SUPABASE_URL` : URL DEV ci-dessus.
- `VITE_SUPABASE_ANON_KEY` : clé publique du projet.

Ne jamais utiliser une clé `service_role` ou `secret` dans le frontend, dans Git ou dans une conversation. Le fichier `.env.local` ne doit pas être commité.

## Développement local
```powershell
cd apps/web
npm install
Copy-Item .env.example .env.local
npm run dev
```

L'application reste en mode démonstration tant que la clé publique n'est pas renseignée et que l'authentification réelle n'est pas intégrée. La présence de l'URL seule ne signifie pas que les données sont connectées.

## Règles confirmées
- Catégorie 1 : saisie A, B, C, D et F.
- Catégorie 2 : saisie I, K et L.
- Colonne G : administrateur central uniquement.
- Colonnes E, H et J : calculées par le système d'après les formules observées dans le classeur.
- Lecture des rapports limitée aux départements affectés.
- Un compte peut être affecté à plusieurs départements avec des rôles différents.
- Un rapport est conservé par groupe pédagogique et année scolaire.
- Les bordereaux sont historisés et détaillés par promotion/groupe.

## Sécurité
Les écritures des rapports passent par des fonctions PostgreSQL qui vérifient le rôle et les champs modifiables. Les tables n'accordent pas de droits d'écriture directs aux clients navigateur. Les contrôles de l'interface ne remplacent jamais les contrôles PostgreSQL.

## Important
Les migrations sont testées dans la CI sur PostgreSQL 16 avec des stubs Auth, mais elles ne sont pas encore appliquées à ce projet Supabase DEV. Ne pas les appliquer en production. Aucun compte, aucune école et aucun effectif fictif ne doit être importé comme donnée officielle.
