# Catalya — Préparation de devis

Prototype d’étude de cas FDE. Les entreprises, demandes et données commerciales du kit sont fictives.

## Démonstration publique

La version Vercel conserve un espace distinct par navigateur grâce à un cookie HttpOnly. Les dossiers, conversations, validations et documents sont enregistrés dans Vercel Blob privé. Ils expirent sept jours après leur dernière modification ; effacer le cookie fait perdre l’accès à cet espace. Utiliser uniquement des données fictives.

Le mode IA utilise une clé OpenRouter côté serveur. Un plafond global de 100 analyses IA par jour limite les appels publics ; le mode local reste disponible. Le modèle et le plafond sont configurables par `OPENROUTER_MODEL` et `PUBLIC_AI_DAILY_LIMIT`.

Cette version adapte le stockage du prototype local à Vercel. Les règles de calcul et le périmètre métier restent ceux du cas.


Le prototype transforme une demande client en devis calculé, soumis à une validation commerciale, puis généré en Word. Le fil conserve les questions et les réponses ; le détail des calculs et les sources sont accessibles à la demande.

## Essai rapide

La demande 1 produit **233 120 € HT / 279 744 € TTC**. La demande 5 montre les exceptions à faire traiter avant de produire une offre.

Sans clé, le mode local permet de reproduire les exemples du kit. Pour interpréter des mails avec l’IA, configurer une clé OpenRouter privée dans `.env.local`. Un échec IA est signalé ; aucun basculement silencieux n’est effectué.

## Démarrage

Node.js **24 LTS** est requis pour SQLite natif ; Node 24 est utilisé pour la vérification. Sous Windows :

```powershell
powershell -ExecutionPolicy Bypass -File .\demarrer.ps1
```

Le script installe les dépendances avec `npm ci`, compile et démarre sur **http://127.0.0.1:3000**. Il peut utiliser le runtime Node récent présent dans Codex sur cette machine si le Node global est trop ancien. Pour une installation manuelle :

```sh
npm ci
cp .env.example .env.local
# Renseigner OPENROUTER_API_KEY dans .env.local pour utiliser l’IA.
npm run build
npm start
```

La clé reste côté serveur. Elle n’est jamais préfixée `NEXT_PUBLIC_` ni incluse dans l’archive. Sans clé, sélectionner explicitement le mode local. Le serveur ne bascule pas silencieusement en mode local si un appel IA échoue.

## Parcours

1. Charger une des cinq demandes ou coller le texte du mail ; vérifier la date de traitement.
2. Analyser : l’agent consulte le référentiel avec des outils en lecture seule. Le serveur contrôle les champs, calcule les montants et détermine les blocages.
3. Si une donnée manque, lire les questions client et les actions internes. Le brouillon est copiable, sans envoi automatique.
4. Répondre dans le champ « Votre réponse à l’assistant », puis cliquer sur « Envoyer ». Elle s’ajoute à la source conservée et produit une nouvelle version.
5. Vérifier le devis affiché dans le fil ; ouvrir le détail et les sources si nécessaire. Cliquer sur « Valider le devis » dans la conversation, puis générer le Word.

Une saisie en cours, une modification du mode ou de la date désactive les actions de validation et de génération. Une nouvelle analyse invalide l’approbation. Le serveur refuse les versions périmées et les dossiers bloqués, indépendamment de l’interface.

La demande 1 produit 233 120 € HT / 279 744 € TTC. À 10 000 kg : 291 400 € HT. La demande 5 démontre le blocage sur la remise et l’engagement de délai. Les modèles grand compte et export sont fournis, mais leur génération reste hors périmètre tant que les conditions métier ne sont pas résolues.

## Données et limites

Les données et modèles du kit sont inclus. En local, les dossiers et documents sont enregistrés dans `runtime/catalya.db` ; une nouvelle analyse invalide l’approbation précédente. La validation utilise une identité de démonstration.

La génération Word couvre le modèle standard. Les remises exceptionnelles, conditions grand compte/export, stocks et dates de livraison exigent une décision métier. Aucun envoi de mail ni raccordement Jask/SI n’est réalisé.

Un usage partagé demandera notamment des identités et droits, des sources synchronisées et des sauvegardes. L’application nécessite un serveur avec disque durable. Les tests sur le kit ne remplacent pas un pilote sur des demandes réelles.

## Vérifications facultatives

```sh
npm test
```

Les règles de calcul, la validation et la génération sont testées sans réseau. Les jeux et scripts d’évaluation IA sont fournis pour inspection ; leur exécution peut appeler le fournisseur et engager des coûts.

## Déployer sur Vercel

1. Importer ce dépôt dans un projet Vercel avec Node.js 24 et le framework Next.js.
2. Créer et connecter un stockage **Vercel Blob privé** au projet. La CLI fournit `BLOB_READ_WRITE_TOKEN` ; le SDK accepte aussi la connexion OIDC du projet.
3. Ajouter `OPENROUTER_API_KEY` dans les secrets de production pour activer l’IA. Sans clé, les exemples restent utilisables en mode local.
4. Déployer. La configuration inclut les référentiels, les cinq demandes et les modèles Word dans les fonctions serveur.

Le stockage charge un instantané privé dans SQLite en mémoire pour chaque opération, puis sauvegarde les tables du visiteur et les Word. Les écritures conditionnelles par ETag refusent les modifications concurrentes. Aucun disque persistant n’est nécessaire. Le résultat de l’analyse n’est transmis au navigateur qu’après sauvegarde.

Le cookie est une capacité d’accès à la démonstration, sans compte utilisateur. Ce prototype ne fournit pas les identités, droits organisationnels et intégrations nécessaires à un usage métier partagé.

## Vérification

`npm test` couvre les règles, les clarifications, la validation, la génération Word, l’isolation des visiteurs, la restauration du stockage hébergé et les conflits de sauvegarde. Les tests automatisés ne consomment pas d’API IA. `npm run build` vérifie la compilation de production.
