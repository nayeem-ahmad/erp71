export const helpMessages = {
    title: "Centre d'aide",
    description: "Questions fréquentes et guides",
    quickLinks: {
        emailSupport: {
            title: "Assistance par e-mail",
            subtitle: 'support@erp71.com',
        },
        contact: {
            title: "Nous contacter",
            subtitle: "Envoyer un message",
        },
        status: {
            title: "État du système",
            subtitle: "Administrateur de la plateforme — tableau de bord en direct",
        },
    },
    footerPrefix: "Vous ne trouvez pas ce que vous cherchez ?",
    footerLink: "Contactez notre équipe d'assistance",
    sections: {
        gettingStarted: {
            title: "Premiers pas",
            icon: '🚀',
            faqs: [
                {
                    q: "Comment ajouter mon premier produit ?",
                    a: "Allez dans Stock → Produits et cliquez sur « Nouveau produit ». Seuls un nom et un prix de vente sont obligatoires ; SKU, catégorie, marque, seuil de réapprovisionnement et stock initial sont facultatifs. Pour en charger plusieurs d'un coup, utilisez « Importer un CSV » — les colonnes du modèle sont name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit. Les lignes dont le SKU existe déjà sont ignorées : l'import ajoute donc de nouveaux produits, il ne met pas à jour les produits existants.",
                },
                {
                    q: "Comment commencer à vendre ?",
                    a: "Ouvrez Ventes → Point de vente, touchez les produits pour composer le panier, rattachez éventuellement un client, encaissez (espèces, bKash ou carte — vous pouvez répartir sur les trois) et validez. Configurez d'abord votre magasin et vos entrepôts, dans Paramètres et Stock, pour que le stock soit suivi au bon endroit.",
                },
                {
                    q: "Comment inviter du personnel et contrôler ses droits ?",
                    a: "Allez dans Équipe (Paramètres → Équipe) et invitez une personne par e-mail ; elle rejoint l'espace via un lien d'invitation. Attribuez un rôle — OWNER, MANAGER, CASHIER ou ACCOUNTANT, ou un rôle personnalisé que vous définissez — pour déterminer les modules et actions accessibles. Inviter des membres exige le compte propriétaire ou la permission « Manage Users ».",
                },
                {
                    q: "Quelles offres d'abonnement existe-t-il ?",
                    a: "Les offres payantes en libre-service sont BASIC, ACCOUNTING et STANDARD ; PREMIUM — qui débloque le CRM, la production et l'assistant IA — est affichée comme « bientôt disponible ». L'ancienne offre Free n'est plus proposée aux nouvelles inscriptions. Comparez et changez d'offre à tout moment dans Facturation.",
                },
            ],
        },
        pos: {
            title: "Point de vente (POS)",
            icon: '🛒',
            faqs: [
                {
                    q: "Comment fonctionne le POS hors ligne ?",
                    a: "Le point de vente continue de fonctionner en cas de coupure Internet. Une bannière jaune apparaît, les produits déjà chargés restent consultables et chaque vente est enregistrée sur votre appareil plutôt que sur le serveur. À la reconnexion, appuyez sur « Synchroniser maintenant » (ou patientez simplement) et les ventes en attente se téléversent automatiquement.",
                },
                {
                    q: "Puis-je accepter plusieurs moyens de paiement sur une même vente ?",
                    a: "Oui. La fenêtre d'encaissement comporte des champs distincts pour les espèces, bKash et la carte de crédit, et les additionne : une vente peut donc être répartie sur les trois. (Nagad et le virement bancaire sont reconnus par le moteur comptable mais ne sont pas des boutons de paiement sur l'écran du POS.)",
                },
                {
                    q: "Comment fonctionnent les remises en caisse ?",
                    a: "Le POS applique les remises de deux façons : saisir un code de remise valide puis appuyer sur Appliquer, ou déduire du total les points de fidélité d'un client. Il n'y a pas de champ libre en pourcentage ou en montant sur le POS lui-même — créez les codes dans Paramètres → Codes de remise.",
                },
                {
                    q: "Qu'imprime le ticket ?",
                    a: "Après une vente, vous pouvez imprimer un ticket thermique 80 mm indiquant le nom du magasin, le numéro de facture, la date, les lignes d'articles, le sous-total, la taxe, le total, les paiements reçus, la monnaie ou le solde dû, ainsi qu'un QR code permettant de vérifier la facture. À noter : les tickets POS n'impriment pour l'instant ni BIN ni détail de TVA.",
                },
            ],
        },
        sales: {
            title: "Ventes, retours et clients",
            icon: '🧾',
            faqs: [
                {
                    q: "Où consulter et rechercher les ventes passées ?",
                    a: "Allez dans Ventes → Ventes pour la liste complète. La pagination se fait côté serveur, l'affichage reste donc rapide même avec des milliers de factures. Recherchez par numéro de série, client ou référence, filtrez par statut (Brouillon, Terminée, Remboursée, Remboursement partiel) et ouvrez une ligne pour la consulter, la modifier ou la supprimer.",
                },
                {
                    q: "Comment enregistrer un retour ou un remboursement client ?",
                    a: "Ouvrez Ventes → Retours clients → « Traiter un retour », saisissez le numéro de série de la vente d'origine (par ex. S-00001) et appuyez sur Rechercher, puis choisissez les articles et les quantités à retourner. Le remboursement est valorisé d'après la vente d'origine et ne peut dépasser ce qui a été vendu, le stock retourné revient en inventaire, et le remboursement suit le mode de paiement du client — espèces rendues pour une vente réglée, ou réduction du solde dû pour une vente à crédit.",
                },
                {
                    q: "Comment vendre à crédit et suivre les créances clients ?",
                    a: "Ajoutez vos clients dans Ventes → Clients. Pour vendre à crédit, le client doit avoir une limite de crédit définie — sinon la vente est bloquée, et une vente à crédit qui dépasserait la limite est également refusée. La fiche de chaque client affiche son solde dû et un grand livre crédit où enregistrer les règlements.",
                },
                {
                    q: "Où gérer les règlements clients et les impayés ?",
                    a: "Utilisez Ventes → Règlements clients pour enregistrer les sommes reçues, Ventes → Grand livre clients pour un relevé courant par client, et le rapport d'antériorité des créances (dans Ventes → Clients) pour voir qui doit quoi et depuis combien de temps.",
                },
            ],
        },
        inventory: {
            title: "Gestion des stocks",
            icon: '📦',
            faqs: [
                {
                    q: "Comment suivre le stock sur plusieurs entrepôts ?",
                    a: "Créez vos entrepôts dans la configuration du stock et choisissez les valeurs par défaut de chaque flux dans Stock → Paramètres de stock. Le stock est tenu par entrepôt ; déplacez-le via Stock → Transferts, un flux en deux temps envoi puis réception où l'envoi diminue la source, la réception augmente la destination, et les réceptions partielles sont autorisées.",
                },
                {
                    q: "Comment fonctionnent les alertes de stock faible ?",
                    a: "Définissez un seuil de réapprovisionnement sur chaque produit (ou une valeur par défaut dans les Paramètres de stock). Chaque matin à 07h00, le système vérifie les quantités disponibles et, pour tout ce qui est au niveau du seuil ou en dessous, envoie un e-mail au titulaire du compte, déclenche une notification dans l'application et — si les SMS de stock faible sont activés — lui envoie un SMS. Stock → Rapport de réapprovisionnement liste à la demande tout ce qui est sous son seuil.",
                },
                {
                    q: "Comment importer de nombreux produits d'un coup ?",
                    a: "Allez dans Stock → Produits → « Importer un CSV » et téléversez le modèle (colonnes : name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit). Le prix de vente est obligatoire sur chaque ligne, une quantité de stock initial crée un mouvement de stock d'ouverture, et les lignes dont le SKU existe déjà sont ignorées — utilisez donc l'import pour ajouter de nouveaux produits, pas pour mettre à jour ceux qui existent.",
                },
                {
                    q: "Qu'est-ce qu'un inventaire physique, et quand faut-il une validation ?",
                    a: "Un inventaire physique (Stock → Inventaires) compte le stock réel face au système. Le lancement d'une session fige la quantité attendue de chaque produit de l'entrepôt choisi ; vous saisissez les quantités comptées et chaque écart est calculé. Si le plus grand écart dépasse le seuil d'anomalie (25 par défaut, réglable dans les Paramètres de stock), la session doit être revue avant d'être comptabilisée ; la comptabilisation ajuste le stock et enregistre une écriture comptable.",
                },
            ],
        },
        purchases: {
            title: "Achats et fournisseurs",
            icon: '🚚',
            faqs: [
                {
                    q: "Comment enregistrer un achat auprès d'un fournisseur ?",
                    a: "Allez dans Achat → Achats et créez-en un : choisissez le magasin/entrepôt et le fournisseur (ou ajoutez-le sur place) et saisissez les lignes de produits avec quantité et coût unitaire, plus taxe, remise et frais de port en option. L'enregistrement de l'achat réceptionne immédiatement la marchandise (le stock augmente) et comptabilise le montant total en dette fournisseur — il n'y a pas de champ espèces, enregistrez donc tout règlement séparément en Paiement fournisseur.",
                },
                {
                    q: "Quelle est la différence entre une commande fournisseur et un achat ?",
                    a: "Une commande fournisseur (Achat → Commandes fournisseurs) est un engagement qui ne modifie pas le stock. Lorsque vous la marquez Réceptionnée, elle augmente alors le stock et comptabilise la dette, exactement comme un achat direct. Utilisez les commandes lorsque vous commandez avant la livraison, et un achat direct lorsque la marchandise arrive en même temps.",
                },
                {
                    q: "Comment retourner de la marchandise à un fournisseur ?",
                    a: "Utilisez Achat → Retours fournisseurs. Un retour peut être rattaché à un achat ou autonome ; il diminue le stock, réduit le solde dû au fournisseur (dans la limite de ce que vous lui devez actuellement) et enregistre l'écriture comptable correspondante.",
                },
                {
                    q: "Comment payer mes fournisseurs et voir ce que je dois ?",
                    a: "Enregistrez les règlements dans Achat → Paiement fournisseur — vous pouvez payer ou recevoir, imputer un règlement sur des factures précises et laisser le reliquat en acompte à imputer plus tard. Achat → Grand livre fournisseurs affiche le solde courant de chaque fournisseur, et chaque fournisseur dispose aussi d'un récapitulatif de facturation et d'un grand livre crédit.",
                },
            ],
        },
        accounting: {
            title: "Comptabilité",
            icon: '📊',
            faqs: [
                {
                    q: "Dois-je saisir moi-même les écritures de journal ?",
                    a: "Non — le système tient la comptabilité en partie double automatiquement. Les règles de comptabilisation (Comptabilité → Règles de comptabilisation) associent chaque événement opérationnel (vente, achat, retour, transfert, salaire, ajustement) aux comptes à débiter et à créditer, et les écritures sont générées à mesure que ces événements surviennent. Vous ne saisissez manuellement que ce que les règles ne couvrent pas.",
                },
                {
                    q: "Qu'est-ce que le plan comptable ?",
                    a: "Le plan comptable (Comptabilité → Plan comptable) est la liste maîtresse de vos comptes — actifs, passifs, capitaux propres, produits et charges — organisée en groupes et sous-groupes. Chaque ligne d'écriture s'impute sur l'un de ces comptes : il est donc le socle de tous vos états.",
                },
                {
                    q: "Puis-je saisir manuellement, et quels états sont disponibles ?",
                    a: "Oui — Comptabilité → Saisie d'écriture enregistre à la main les écritures de caisse, de banque, de virement et de journal, et les écrans Écritures, Journal et Grand livre permettent de les relire. Les états comprennent la balance, le compte de résultat, le bilan, le livre de caisse, le livre de banque, l'antériorité des créances et dettes, et un état de TVA ; les exercices comptables permettent de verrouiller les mois clos afin d'empêcher les saisies antidatées.",
                },
                {
                    q: "Comment exporter vers Tally ou QuickBooks ?",
                    a: "Sur la page d'accueil de la comptabilité, cliquez sur « Exporter », choisissez Tally XML ou QuickBooks IIF, sélectionnez une période et téléchargez. Le fichier s'importe directement dans le logiciel comptable concerné.",
                },
            ],
        },
        crm: {
            title: "CRM et prospects",
            icon: '🤝',
            faqs: [
                {
                    q: "Que contient le module CRM, et qui peut l'utiliser ?",
                    a: "Le CRM couvre les prospects, les échanges, les relances, les campagnes et les clients, ainsi que les paramètres des sources et catégories de prospects et des champs personnalisés, le tout accessible depuis le hub CRM. L'essentiel relève de l'offre Premium — sur les autres offres, vous conservez les clients mais les outils de pipeline sont masqués.",
                },
                {
                    q: "Comment créer et traiter un prospect ?",
                    a: "Allez dans CRM → Prospects → « Nouveau prospect » et saisissez au minimum un nom (mobile, e-mail, source, catégorie, priorité, statut, liens sociaux et prochaine étape sont facultatifs). Un prospect suit des étapes fixes — Nouveau, Contacté, Qualifié, Perdu, Converti — et vous l'affectez via la personne indiquée dans « Prochaine étape assignée à » ; la liste permet aussi l'affectation et le changement de statut en masse. Le moment venu, « Convertir en client » crée ou rattache le client dans Ventes.",
                },
                {
                    q: "D'où viennent les listes Source et Catégorie ?",
                    a: "Ce sont vos propres données de référence — gérez-les dans CRM → Sources et catégories. Chaque source porte en outre un poids de score (0 à 25) qui alimente le score automatique du prospect. Vous pouvez ajouter, modifier, masquer ou supprimer des valeurs ; supprimer une valeur utilisée vous demande de réaffecter les prospects concernés, et les valeurs intégrées sont masquées plutôt que supprimées.",
                },
                {
                    q: "Comment fonctionnent les relances et les échanges ?",
                    a: "Les relances (CRM → Relances) forment une file unique de rappels — Générale, Recouvrement, Anniversaire ou Réapprovisionnement — créés depuis la fiche d'un client ou d'un prospect, les rappels Anniversaire et Réapprovisionnement étant aussi générés automatiquement. Les échanges (CRM → Échanges) constituent un journal filtrable et en lecture seule de chaque point de contact (appel, SMS, WhatsApp, visite, etc.) enregistré sur les prospects par toute votre équipe ; vous en créez un depuis la fiche du prospect.",
                },
            ],
        },
        manufacturing: {
            title: "Production",
            icon: '🏭',
            faqs: [
                {
                    q: "Comment créer une recette produit (nomenclature) ?",
                    a: "Sur la page Production, ouvrez l'onglet Nomenclature et cliquez sur « Nouvelle nomenclature ». Une recette désigne un produit fini, le nombre d'unités produites par lancement, et ses composants avec leurs quantités. Les composants se saisissent par identifiant produit, et le produit fini d'une recette ne peut plus être modifié une fois créée. La production est une fonctionnalité Premium/en option.",
                },
                {
                    q: "Quel est l'effet d'un ordre de fabrication sur le stock ?",
                    a: "Dans l'onglet Ordres de fabrication, créez un ordre à partir d'une nomenclature et d'une quantité ; il démarre en brouillon. Son lancement revérifie la disponibilité des composants, et sa clôture consomme le stock de composants (plus les rebuts saisis) et ajoute les produits finis en stock. La production ne déplace que du stock — elle ne génère pas d'écriture au grand livre.",
                },
                {
                    q: "Comment sont calculés le coût de l'ordre et le prix de vente ?",
                    a: "À la clôture, le coût matière est figé d'après le dernier coût de chaque composant, et vous pouvez ajouter d'autres lignes de coût (main-d'œuvre, impression, transport, frais généraux, etc.), éventuellement reprises d'une facture d'achat de services. L'ordre affiche alors un coût total et un coût unitaire, et pour les ordres clôturés un panneau de tarification propose un prix de vente en coût majoré, applicable au produit.",
                },
            ],
        },
        hr: {
            title: "RH et paie",
            icon: '👥',
            faqs: [
                {
                    q: "Comment ajouter des salariés ?",
                    a: "Allez dans RH → Salariés → « Nouveau salarié » et saisissez au minimum un nom et un téléphone (e-mail, date d'entrée, pièce d'identité, service, fonction et salaire de base sont facultatifs), ou ajoutez-en plusieurs via la fenêtre d'import. Un matricule est généré automatiquement, et vous pouvez rattacher un salarié à un compte pour qu'il puisse se connecter.",
                },
                {
                    q: "Comment sont gérés la présence et les congés ?",
                    a: "RH → Présence enregistre une entrée par salarié et par jour — Présent, Absent, Demi-journée ou Férié, avec heures d'arrivée et de départ facultatives — en saisie manuelle, faute de pointeuse. RH → Congés comporte deux onglets : Demandes (soumettre, puis approuver ou refuser) et Types (définir un type de congé et son nombre de jours par an).",
                },
                {
                    q: "Comment verser les salaires ?",
                    a: "Utilisez RH → Paiements de salaire → « Verser un salaire », choisissez le salarié et la période, puis saisissez le montant (prérempli à partir du salaire de base) et le mode de règlement. Chaque versement génère une écriture comptable (débit Salaires à payer, crédit compte de règlement). Les versements sont des montants forfaitaires uniques — il n'y a pas encore de bulletins de paie ni de détail des primes et retenues.",
                },
            ],
        },
        aiAssistant: {
            title: "Assistant IA",
            icon: '🤖',
            faqs: [
                {
                    q: "Qu'est-ce que l'assistant métier IA et comment l'ouvrir ?",
                    a: "C'est un panneau de discussion — l'icône robot « Interroger l'assistant métier » — qui répond aux questions sur vos propres données : ventes, stock, clients, créances et plus encore. Il est strictement en lecture seule : il peut consulter et expliquer, mais ne peut rien modifier. L'assistant relève de l'offre Premium, l'icône n'apparaît donc que si votre offre l'inclut.",
                },
                {
                    q: "Que voit-il réellement, et puis-je me fier à ses réponses ?",
                    a: "Demandez-lui « que sais-tu faire ? » : il indique vos succursales, jusqu'où remontent vos données et les outils qu'il peut utiliser — une réponse vide signifie donc une période vide, pas une requête défaillante. Chaque réponse liste ses sources (les rapports et périodes exacts utilisés) afin que vous puissiez la vérifier. Vous pouvez aussi lui demander de repérer les opérations inhabituelles — ventes à perte, factures en double, écarts de prix importants — et il vous signalera toute vérification qui n'a pas pu aboutir plutôt que de laisser croire que tout est en ordre.",
                },
                {
                    q: "Que sont les crédits IA et comment en obtenir davantage ?",
                    a: "Les crédits IA sont une dotation mensuelle incluse dans votre offre (1 crédit = 1 000 jetons), consommée par l'assistant et les autres fonctions IA ; consultez-les dans Crédits IA. Ils se réinitialisent à chaque période de facturation et ne peuvent pas être achetés séparément — une dotation plus large s'obtient en changeant d'offre (BASIC inclut 100/mois, STANDARD 500). Ils diffèrent des crédits SMS, qui sont prépayés et achetables.",
                },
                {
                    q: "Puis-je poser une question à l'oral plutôt qu'au clavier ?",
                    a: "Oui — si votre navigateur le permet (Chrome, Edge ou Safari en HTTPS), un microphone apparaît à côté d'Envoyer. Touchez-le, énoncez votre question, puis corrigez le texte si besoin et envoyez. L'assistant ne lit pas encore les réponses à voix haute.",
                },
            ],
        },
        billing: {
            title: "Facturation et abonnement",
            icon: '💳',
            faqs: [
                {
                    q: "Comment changer d'offre ?",
                    a: "Allez dans Facturation, choisissez une carte d'offre et Mensuel ou Annuel, puis poursuivez vers le paiement SSL Wireless (qui accepte carte, bKash et Nagad). L'engagement annuel coûte l'équivalent de dix mois — soit deux mois offerts, environ 17 % d'économie. Seul le propriétaire ou un rôle habilité à la facturation peut modifier l'abonnement.",
                },
                {
                    q: "Puis-je résilier mon abonnement ?",
                    a: "Oui — dans Facturation, choisissez « Résilier à la fin de la période ». Votre accès se poursuit jusqu'au terme de la période payée en cours, et rien n'est supprimé. Voir la politique de remboursement sur /refund pour le détail.",
                },
                {
                    q: "Que se passe-t-il si mon paiement échoue ou si l'offre expire ?",
                    a: "L'abonnement passe d'abord en impayé et vous recevez des e-mails de rappel pendant un court délai de grâce (environ 7 jours). S'il reste impayé, le compte est rétrogradé vers l'offre Free plutôt que supprimé — vos données sont toujours conservées, et un nouveau paiement rétablit toutes les fonctionnalités.",
                },
                {
                    q: "Quelle différence entre crédits IA et crédits SMS ?",
                    a: "Les crédits IA sont une dotation mensuelle liée à l'offre, destinée aux fonctions IA, et se réinitialisent à chaque période. Les crédits SMS sont un solde prépayé que vous rechargez dans Crédits SMS : ils sont consommés quand le système envoie des messages (tickets de vente, alertes de stock faible, campagnes CRM), à raison d'un crédit par segment de message et par destinataire, et un solde faible vous avertit avant que les envois n'échouent.",
                },
            ],
        },
        storefront: {
            title: "Boutique en ligne",
            icon: '🌐',
            faqs: [
                {
                    q: "Comment activer ma boutique en ligne ?",
                    a: "Allez dans Boutique → Boutique (paramètres), activez-la et définissez un slug d'URL (minuscules, chiffres et tirets). Votre boutique publique se trouve alors à l'adresse /store/votre-slug, et vous pouvez ajouter une bannière, un titre principal et une image.",
                },
                {
                    q: "Comment les clients passent-ils commande ?",
                    a: "Les clients ouvrent l'adresse de votre boutique, parcourent les produits en stock et passent commande en indiquant leurs coordonnées. Les commandes arrivent dans Boutique → Commandes en ligne au statut En attente, où vous pouvez les marquer Confirmées ou Annulées.",
                },
                {
                    q: "Les commandes de la boutique diminuent-elles automatiquement mon stock ?",
                    a: "Pas encore. Une commande vérifie la disponibilité du stock mais ne le décrémente pas, et confirmer une commande ne fait que changer son statut — vous préparez la commande et ajustez le stock vous-même. La décrémentation automatique du stock pour les commandes en ligne figure à notre feuille de route pour une future version.",
                },
            ],
        },
        security: {
            title: "Sécurité et compte",
            icon: '🔒',
            faqs: [
                {
                    q: "Comment activer l'authentification à deux facteurs (2FA) ?",
                    a: "Ouvrez votre profil depuis le menu du compte et allez dans l'onglet 2FA. Cliquez sur Générer un QR code, scannez-le avec une application d'authentification (Google Authenticator, Authy, etc.), saisissez le code à 6 chiffres et activez. Ensuite, la connexion demande un code depuis votre téléphone.",
                },
                {
                    q: "Que faire si j'oublie mon mot de passe ?",
                    a: "Sur la page de connexion, cliquez sur « Mot de passe oublié » et saisissez votre adresse e-mail pour recevoir un lien de réinitialisation. Vous pouvez aussi changer votre mot de passe à tout moment depuis Profil → Mot de passe (le nouveau mot de passe doit comporter au moins 8 caractères).",
                },
                {
                    q: "Comment exporter ou supprimer mes données ?",
                    a: "Allez dans Profil → Données et confidentialité. « Télécharger mes données » produit un export JSON de votre compte, et « Demander la suppression des données » ouvre une demande traitée sous 30 jours.",
                },
                {
                    q: "Comment fonctionnent les rôles et l'accès de l'équipe ?",
                    a: "Gérez les personnes dans Équipe. Les rôles intégrés sont OWNER, MANAGER, CASHIER et ACCOUNTANT, et vous pouvez créer des rôles personnalisés ; chaque rôle accorde un ensemble précis de permissions de module et d'action. Seul le propriétaire ou un utilisateur disposant de « Manage Users » peut inviter des membres ou modifier les rôles.",
                },
            ],
        },
    },
} as const;
