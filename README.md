# Catalya â€” PrÃ©paration de devis

Prototype dâ€™Ã©tude de cas FDE. Les entreprises, demandes et donnÃ©es commerciales du kit sont fictives.

## DÃ©monstration publique

La version Vercel conserve un espace distinct par navigateur grÃ¢ce Ã  un cookie HttpOnly. Les dossiers, conversations, validations et documents sont enregistrÃ©s dans Vercel Blob privÃ©. Ils expirent sept jours aprÃ¨s leur derniÃ¨re modification ; effacer le cookie fait perdre lâ€™accÃ¨s Ã  cet espace. Utiliser uniquement des donnÃ©es fictives.

Le mode IA utilise une clÃ© OpenRouter cÃ´tÃ© serveur. Un plafond global de 100 analyses IA par jour limite les appels publics ; le mode local reste disponible. Le modÃ¨le et le plafond sont configurables par `OPENROUTER_MODEL` et `PUBLIC_AI_DAILY_LIMIT`.

Cette version adapte le stockage du prototype local Ã  Vercel. Les rÃ¨gles de calcul et le pÃ©rimÃ¨tre mÃ©tier restent ceux du cas.


Le prototype transforme une demande client en devis calculÃ©, soumis Ã  une validation commerciale, puis gÃ©nÃ©rÃ© en Word. Le fil conserve les questions et les rÃ©ponses ; le dÃ©tail des calculs et les sources sont accessibles Ã  la demande.

## Essai rapide

La demande 1 produit **233 120 â‚¬ HT / 279 744 â‚¬ TTC**. La demande 5 montre les exceptions Ã  faire traiter avant de produire une offre.

Sans clÃ©, le mode local permet de reproduire les exemples du kit. Pour interprÃ©ter des mails avec lâ€™IA, configurer une clÃ© OpenRouter privÃ©e dans `.env.local`. Un Ã©chec IA est signalÃ© ; aucun basculement silencieux nâ€™est effectuÃ©.

## DÃ©marrage

Node.js **24 LTS** est requis pour SQLite natif ; Node 24 est utilisÃ© pour la vÃ©rification. Sous Windows :

```powershell
powershell -ExecutionPolicy Bypass -File .\demarrer.ps1
```

Le script installe les dÃ©pendances avec `npm ci`, compile et dÃ©marre sur **http://127.0.0.1:3000**. Il peut utiliser le runtime Node rÃ©cent prÃ©sent dans Codex sur cette machine si le Node global est trop ancien. Pour une installation manuelle :

```sh
npm ci
cp .env.example .env.local
# Renseigner OPENROUTER_API_KEY dans .env.local pour utiliser lâ€™IA.
npm run build
npm start
```

La clÃ© reste cÃ´tÃ© serveur. Elle nâ€™est jamais prÃ©fixÃ©e `NEXT_PUBLIC_` ni incluse dans lâ€™archive. Sans clÃ©, sÃ©lectionner explicitement le mode local. Le serveur ne bascule pas silencieusement en mode local si un appel IA Ã©choue.

## Parcours

1. Charger une des cinq demandes ou coller le texte du mail ; vÃ©rifier la date de traitement.
2. Analyser : lâ€™agent consulte le rÃ©fÃ©rentiel avec des outils en lecture seule. Le serveur contrÃ´le les champs, calcule les montants et dÃ©termine les blocages.
3. Si une donnÃ©e manque, lire les questions client et les actions internes. Le brouillon est copiable, sans envoi automatique.
4. RÃ©pondre dans le champ Â« Votre rÃ©ponse Ã  lâ€™assistant Â», puis cliquer sur Â« Envoyer Â». Elle sâ€™ajoute Ã  la source conservÃ©e et produit une nouvelle version.
5. VÃ©rifier le devis affichÃ© dans le fil ; ouvrir le dÃ©tail et les sources si nÃ©cessaire. Cliquer sur Â« Valider le devis Â» dans la conversation, puis gÃ©nÃ©rer le Word.

Une saisie en cours, une modification du mode ou de la date dÃ©sactive les actions de validation et de gÃ©nÃ©ration. Une nouvelle analyse invalide lâ€™approbation. Le serveur refuse les versions pÃ©rimÃ©es et les dossiers bloquÃ©s, indÃ©pendamment de lâ€™interface.

La demande 1 produit 233 120 â‚¬ HT / 279 744 â‚¬ TTC. Ã€ 10 000 kg : 291 400 â‚¬ HT. La demande 5 dÃ©montre le blocage sur la remise et lâ€™engagement de dÃ©lai. Les modÃ¨les grand compte et export sont fournis, mais leur gÃ©nÃ©ration reste hors pÃ©rimÃ¨tre tant que les conditions mÃ©tier ne sont pas rÃ©solues.

## DonnÃ©es et limites

Les donnÃ©es et modÃ¨les du kit sont inclus. En local, les dossiers et documents sont enregistrÃ©s dans `runtime/catalya.db` ; une nouvelle analyse invalide lâ€™approbation prÃ©cÃ©dente. La validation utilise une identitÃ© de dÃ©monstration.

La gÃ©nÃ©ration Word couvre le modÃ¨le standard. Les remises exceptionnelles, conditions grand compte/export, stocks et dates de livraison exigent une dÃ©cision mÃ©tier. Aucun envoi de mail ni raccordement Jask/SI nâ€™est rÃ©alisÃ©.

Un usage partagÃ© demandera notamment des identitÃ©s et droits, des sources synchronisÃ©es et des sauvegardes. Lâ€™application nÃ©cessite un serveur avec disque durable. Les tests sur le kit ne remplacent pas un pilote sur des demandes rÃ©elles.

## VÃ©rifications facultatives

```sh
npm test
```

Les rÃ¨gles de calcul, la validation et la gÃ©nÃ©ration sont testÃ©es sans rÃ©seau. Les jeux et scripts dâ€™Ã©valuation IA sont fournis pour inspection ; leur exÃ©cution peut appeler le fournisseur et engager des coÃ»ts.

## DÃ©ployer sur Vercel

1. Importer ce dÃ©pÃ´t dans un projet Vercel avec Node.js 24 et le framework Next.js.
2. CrÃ©er et connecter un stockage **Vercel Blob privÃ©** au projet. La CLI fournit `BLOB_READ_WRITE_TOKEN` ; le SDK accepte aussi la connexion OIDC du projet.
3. Ajouter `OPENROUTER_API_KEY` dans les secrets de production pour activer lâ€™IA. Sans clÃ©, les exemples restent utilisables en mode local.
4. DÃ©ployer. La configuration inclut les rÃ©fÃ©rentiels, les cinq demandes et les modÃ¨les Word dans les fonctions serveur.

Le stockage charge un instantanÃ© privÃ© dans SQLite en mÃ©moire pour chaque opÃ©ration, puis sauvegarde les tables du visiteur et les Word. Les Ã©critures conditionnelles par ETag refusent les modifications concurrentes. Aucun disque persistant nâ€™est nÃ©cessaire. Le rÃ©sultat de lâ€™analyse nâ€™est transmis au navigateur quâ€™aprÃ¨s sauvegarde.

Le cookie est une capacitÃ© dâ€™accÃ¨s Ã  la dÃ©monstration, sans compte utilisateur. Ce prototype ne fournit pas les identitÃ©s, droits organisationnels et intÃ©grations nÃ©cessaires Ã  un usage mÃ©tier partagÃ©.

## VÃ©rification

`npm test` couvre les rÃ¨gles, les clarifications, la validation, la gÃ©nÃ©ration Word, lâ€™isolation des visiteurs, la restauration du stockage hÃ©bergÃ© et les conflits de sauvegarde. Les tests automatisÃ©s ne consomment pas dâ€™API IA. `npm run build` vÃ©rifie la compilation de production.
