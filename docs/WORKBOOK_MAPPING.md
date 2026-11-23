# Mapping du classeur source

Source inspectée : `RAPPORT SCOLAIRES 2026_2027.xlsx`, feuilles `Modele` et `CEG L ENTENTE`, ligne d'en-tête 3.

| Colonne | Modele | CEG L ENTENTE | Traitement V1 |
|---|---|---|---|
| A | PROMOTION | PROMOTION | Catégorie 1 |
| B | CLASSE | CLASSE | Catégorie 1 |
| C | EFFECTIF CLASSE | EFFECTIF CLASSE | Catégorie 1 |
| D | TOTAL ENROLE | TOTAL ENROLE | Catégorie 1 |
| E | RESTE A ENROLE | RESTE A ENROLE | Calcul système : C-D |
| F | RATISSAGE | RATISSAGE | Catégorie 1 |
| G | TOTAL IMPRIMER | TOTAL IMPRIMER | Administrateur central uniquement |
| H | REP CLASSE | DATE | Calcul système : reprend B ; l'intitulé varie selon la feuille |
| I | TOTAL LIVRE | TOTAL LIVRE | Catégorie 2 |
| J | Etat | VERIFICATION | Calcul système : compare D et I lorsque les deux sont renseignés |
| K | ECART DE LIVRAISON | RATISSAGE 2 | Catégorie 2 |
| L | OBSERVATIONS | OBSERVATIONS | Catégorie 2 |

La feuille contient des lignes de groupes pédagogiques sous les promotions. Le modèle relationnel stocke donc un enregistrement de rapport par groupe pédagogique, et non un seul enregistrement par école.

Les colonnes statistiques à droite du tableau et les formules de synthèse doivent être auditées séparément avant de verrouiller les indicateurs. Les libellés E/H/J et leurs formules sont confirmés dans les deux feuilles observées. Les autres libellés doivent rester tels quels, sans normalisation destructive.
