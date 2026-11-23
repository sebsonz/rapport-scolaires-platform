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

L'application reste en mode démonstration tant que l'authentification réelle et les lectures/écritures Supabase ne sont pas intégrées. La présence de l'URL et de la clé publique seule ne signifie pas que les données sont connectées.

## Règles confirmées
- Catégorie 1 : gestion des classes et saisie A, B, C, D et F ; les ratissages et corrections sont enregistrés dans le journal des opérations.
- Catégorie 2 : enregistrement des livraisons initiales, livraisons après ratissage, premières remises après correction et réimpressions ; saisie des observations K et L.
- Colonne G : administrateur central uniquement.
- Colonne I (total livré) : calculée par le système à partir des livraisons uniques ; elle n'est pas saisie directement.
- Colonnes E, H et J : calculées par le système.
- Les corrections de dossiers et les réimpressions sont comptabilisées séparément et ne gonflent pas les totaux uniques.
- Lecture des rapports limitée aux départements affectés.
- Un compte peut être affecté à plusieurs départements avec des rôles différents, y compris les deux catégories dans un même département.
- Un rapport est conservé par groupe pédagogique et année scolaire.
- Les bordereaux sont historisés et détaillés par promotion/groupe.

## Sécurité
Les écritures des rapports et l'enregistrement des opérations passent par des fonctions PostgreSQL qui vérifient le rôle, le département et les limites métier. Les tables n'accordent pas de droits d'écriture directs aux clients navigateur. Les contrôles de l'interface ne remplacent jamais les contrôles PostgreSQL.

## Important
Les migrations sont testées dans la CI sur PostgreSQL avec des stubs Auth, mais elles ne sont pas encore appliquées à ce projet Supabase DEV. Ne pas les appliquer en production. Aucun compte, aucune école et aucun effectif fictif ne doit être importé comme donnée officielle.
