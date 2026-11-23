# Audit du classeur RAPPORT SCOLAIRES 2026-2027

Fichier examiné : `RAPPORT SCOLAIRES 2026_2027(1).xlsx`.

## Feuilles et volumes constatés

| Feuille | Lignes | Colonnes | Formules |
|---|---:|---:|---:|
| Modele | 202 | 29 | 626 |
| CEG L ENTENTE | 372 | 29 | 381 |
| Utilisateurs | 14 | 3 | 0 |
| Logs | 199 | 8 | 0 |
| Ecoles | 5 | 2 | 0 |
| Dashboard | 1 | 2 | 0 |
| MemoSource | 1 | 6 | 0 |
| _SYNC_MEMO_ | 1 | 6 | 0 |

## Colonnes source observées (ligne 3)

| Colonne | Intitulé | Sens observé |
|---|---|---|
| A | PROMOTION | Promotion |
| B | CLASSE | Groupe/classe |
| C | EFFECTIF CLASSE | Effectif total |
| D | TOTAL ENROLE | Enrôlement initial |
| E | RESTE A ENROLE | Formule existante C-D |
| F | RATISSAGE | Enrôlement complémentaire |
| G | TOTAL IMPRIMER | Impression, réservé à l'administration centrale |
| H | REP CLASSE / DATE | Formule reprenant B, intitulé différent selon la feuille |
| I | TOTAL LIVRE | Total livré |
| J | Etat / VERIFICATION | Formule comparant D et I |
| K | ECART DE LIVRAISON / RATISSAGE 2 | Libellé différent selon la feuille |
| L | OBSERVATIONS | Observations |

Les lignes de rapport représentent les groupes pédagogiques d'une école. Les groupes doivent être rattachés à leur établissement et à l'année scolaire.

## Divergences de formules constatées

1. Dans `Modele`, la synthèse TOTAL ENROLE utilise `SUM(D4:D126,F4:F126)`, donc D + F.
2. Dans `CEG L ENTENTE`, la synthèse TOTAL ENROLE utilise `SUM(D4:D120)`, donc D seulement.
3. Dans les deux feuilles, le reste par ligne en E utilise C-D et ne déduit pas F.
4. Dans les deux feuilles, J compare D et I, sans ajouter le ratissage.
5. Le taux TAUX ENROLE est basé sur la synthèse P5/P4, donc il hérite de la divergence du total enrôlé.
6. Les synthèses de TOTAL LIVRE, TOTAL IMPRIME et RESTE A IMPRIMER utilisent des plages et formules distinctes à vérifier avant reproduction complète des états d'impression.

## Décision d'implémentation

Les formules divergentes ne sont pas recopiées à l'identique. La logique métier validée pour la plateforme est :

- Enrôlé réel = D (enrôlement initial) + ratissages cumulés.
- Reste à enrôler = C - enrôlé réel.
- Correction de dossier = compteur distinct, exclu de l'enrôlé réel.
- Livré unique = livraisons initiales + livraisons ratissage + premières remises après correction.
- Réimpressions/remplacements = compteur distinct, exclu du livré unique.
- Reste à livrer = enrôlé réel - livré unique.
- Taux de livraison = livré unique / enrôlé réel × 100.

Le modèle historique contient des colonnes statistiques et des formules supplémentaires au-delà de A:L. Elles devront être auditées séparément avant de certifier la reproduction complète des rapports Excel.
