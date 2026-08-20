export const helpMessages = {
    title: "Hilfecenter",
    description: "Häufige Fragen und Anleitungen",
    quickLinks: {
        emailSupport: {
            title: "E-Mail-Support",
            subtitle: 'support@erp71.com',
        },
        contact: {
            title: "Kontakt aufnehmen",
            subtitle: "Nachricht senden",
        },
        status: {
            title: "Systemstatus",
            subtitle: "Plattformadmin — Live-Zustands-Dashboard",
        },
    },
    footerPrefix: "Sie finden nicht, wonach Sie suchen?",
    footerLink: "Wenden Sie sich an unser Support-Team",
    sections: {
        gettingStarted: {
            title: "Erste Schritte",
            icon: '🚀',
            faqs: [
                {
                    q: "Wie füge ich mein erstes Produkt hinzu?",
                    a: "Gehen Sie zu Lagerbestand → Produkte und klicken Sie auf „Neues Produkt“. Erforderlich sind nur ein Name und ein Verkaufspreis; SKU, Kategorie, Marke, Meldebestand und Anfangsbestand sind optional. Für viele auf einmal nutzen Sie „CSV importieren“ — die Vorlagenspalten sind name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit. Zeilen mit bereits vorhandener SKU werden übersprungen: Der Import legt also neue Produkte an, statt bestehende zu aktualisieren.",
                },
                {
                    q: "Wie fange ich an zu verkaufen?",
                    a: "Öffnen Sie Verkauf → Kassensystem, tippen Sie Produkte an, um den Warenkorb zu füllen, ordnen Sie optional einen Kunden zu, nehmen Sie die Zahlung entgegen (bar, bKash oder Karte — auch auf alle drei aufteilbar) und bestätigen Sie. Richten Sie zuvor unter Einstellungen und Lagerbestand Ihre Filiale und Lager ein, damit der Bestand an der richtigen Stelle geführt wird.",
                },
                {
                    q: "Wie lade ich Mitarbeitende ein und steuere ihre Rechte?",
                    a: "Gehen Sie zu Team (Einstellungen → Team) und laden Sie eine Person per E-Mail ein; sie tritt über einen Einladungslink bei. Weisen Sie eine Rolle zu — OWNER, MANAGER, CASHIER oder ACCOUNTANT oder eine selbst definierte Rolle —, um festzulegen, welche Module und Aktionen nutzbar sind. Zum Einladen wird das Inhaberkonto oder die Berechtigung „Manage Users“ benötigt.",
                },
                {
                    q: "Welche Abo-Tarife gibt es?",
                    a: "Die selbst buchbaren kostenpflichtigen Tarife sind BASIC, ACCOUNTING und STANDARD; PREMIUM — das CRM, Fertigung und den KI-Assistenten freischaltet — wird als „demnächst“ angezeigt. Der frühere Free-Tarif wird für Neuanmeldungen nicht mehr angeboten. Tarife vergleichen und wechseln Sie jederzeit unter Abrechnung.",
                },
            ],
        },
        pos: {
            title: "Kassensystem (POS)",
            icon: '🛒',
            faqs: [
                {
                    q: "Wie funktioniert das Offline-POS?",
                    a: "Das Kassensystem arbeitet weiter, wenn das Internet ausfällt. Ein gelbes Banner erscheint, bereits geladene Produkte bleiben durchsuchbar, und jeder Verkauf wird auf Ihrem Gerät statt auf dem Server gespeichert. Sobald Sie wieder verbunden sind, drücken Sie „Jetzt synchronisieren“ (oder warten einfach ab), und die ausstehenden Verkäufe werden automatisch hochgeladen.",
                },
                {
                    q: "Kann ich in einem Verkauf mehrere Zahlungsarten annehmen?",
                    a: "Ja. Der Kassendialog hat getrennte Felder für Bargeld, bKash und Kreditkarte und addiert sie, sodass ein Verkauf auf alle drei aufgeteilt werden kann. (Nagad und Banküberweisung erkennt die Buchhaltung zwar, sie sind auf der POS-Oberfläche aber keine Zahlungsschaltflächen.)",
                },
                {
                    q: "Wie funktionieren Rabatte an der Kasse?",
                    a: "Das POS gewährt Rabatte auf zwei Wegen: einen gültigen Rabattcode eingeben und auf Anwenden drücken, oder die Treuepunkte eines Kunden auf den Gesamtbetrag anrechnen. Ein freies Prozent- oder Betragsfeld gibt es am POS selbst nicht — Codes legen Sie unter Einstellungen → Rabattcodes an.",
                },
                {
                    q: "Was wird auf dem Beleg gedruckt?",
                    a: "Nach einem Verkauf können Sie einen 80-mm-Thermobeleg drucken mit Filialname, Rechnungsnummer, Datum, Positionen, Zwischensumme, Steuer, Gesamtbetrag, geleisteten Zahlungen, Rückgeld oder offenem Betrag sowie einem QR-Code zur Rechnungsprüfung. Beachten Sie: POS-Belege drucken derzeit keine BIN und keine MwSt.-Aufschlüsselung.",
                },
            ],
        },
        sales: {
            title: "Verkäufe, Retouren & Kunden",
            icon: '🧾',
            faqs: [
                {
                    q: "Wo sehe und durchsuche ich frühere Verkäufe?",
                    a: "Die vollständige Liste finden Sie unter Verkauf → Verkäufe. Sie blättert serverseitig und bleibt daher auch bei Tausenden Rechnungen schnell. Suchen Sie nach Belegnummer, Kunde oder Referenz, filtern Sie nach Status (Entwurf, Abgeschlossen, Erstattet, Teilerstattung) und öffnen Sie eine Zeile zum Ansehen, Bearbeiten oder Löschen.",
                },
                {
                    q: "Wie erfasse ich eine Kundenretoure oder Erstattung?",
                    a: "Öffnen Sie Verkauf → Verkaufsretouren → „Retoure bearbeiten“, geben Sie die Belegnummer des ursprünglichen Verkaufs ein (z. B. S-00001), drücken Sie Suchen und wählen Sie dann Artikel und Mengen. Die Erstattung wird aus dem ursprünglichen Verkauf bepreist und kann das Verkaufte nicht übersteigen, zurückgenommene Ware geht in den Bestand zurück, und die Erstattung folgt der Zahlungsart des Kunden — Bargeld zurück bei bezahltem Verkauf oder Minderung des offenen Saldos bei einem Kreditverkauf.",
                },
                {
                    q: "Wie verkaufe ich auf Rechnung und verfolge Außenstände?",
                    a: "Kunden legen Sie unter Verkauf → Kunden an. Für einen Verkauf auf Rechnung muss beim Kunden ein Kreditlimit hinterlegt sein — sonst wird der Verkauf blockiert; auch ein Kreditverkauf, der das Limit überschreiten würde, wird abgelehnt. Die Detailseite jedes Kunden zeigt den offenen Saldo und ein Kreditkonto, in dem Sie Zahlungen erfassen.",
                },
                {
                    q: "Wo verwalte ich Kundenzahlungen und überfällige Salden?",
                    a: "Nutzen Sie Verkauf → Kundenzahlungen, um eingegangenes Geld auf Salden zu buchen, Verkauf → Kundenkonto für einen laufenden Auszug je Kunde und den Fälligkeitsbericht (unter Verkauf → Kunden), um zu sehen, wer wie viel und wie lange schuldet.",
                },
            ],
        },
        inventory: {
            title: "Bestandsverwaltung",
            icon: '📦',
            faqs: [
                {
                    q: "Wie verfolge ich Bestand über mehrere Lager?",
                    a: "Legen Sie Lager in der Bestandseinrichtung an und wählen Sie unter Lagerbestand → Bestandseinstellungen Standardwerte je Ablauf. Der Bestand wird je Lager geführt; verschieben Sie ihn über Lagerbestand → Umlagerungen, einen zweistufigen Ablauf aus Senden und Empfangen: Senden verringert die Quelle, Empfangen erhöht das Ziel, Teilempfänge sind zulässig.",
                },
                {
                    q: "Wie funktionieren Warnungen bei geringem Bestand?",
                    a: "Legen Sie je Produkt einen Meldebestand fest (oder einen Standard in den Bestandseinstellungen). Jeden Morgen um 07:00 Uhr prüft das System die vorhandenen Mengen und sendet für alles auf oder unter dem Meldebestand eine E-Mail an den Kontoinhaber, erzeugt eine In-App-Benachrichtigung und schickt — wenn SMS bei geringem Bestand aktiviert ist — eine SMS. Lagerbestand → Nachbestellbericht listet auf Abruf alles unterhalb des Meldebestands.",
                },
                {
                    q: "Wie importiere ich viele Produkte auf einmal?",
                    a: "Gehen Sie zu Lagerbestand → Produkte → „CSV importieren“ und laden Sie die Vorlage hoch (Spalten: name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit). Der Verkaufspreis ist in jeder Zeile erforderlich, eine Anfangsbestandsmenge erzeugt eine Anfangsbestandsbewegung, und Zeilen mit bereits vorhandener SKU werden übersprungen — nutzen Sie den Import also zum Anlegen neuer Produkte, nicht zum Aktualisieren bestehender.",
                },
                {
                    q: "Was ist eine Inventur, und wann muss sie freigegeben werden?",
                    a: "Eine Inventur (Lagerbestand → Inventuren) zählt den physischen Bestand gegen das System. Beim Start einer Sitzung wird die erwartete Menge jedes Produkts im gewählten Lager festgehalten; Sie tragen die gezählten Mengen ein, und jede Abweichung wird berechnet. Übersteigt die größte Abweichung den Abweichungsschwellenwert (standardmäßig 25, einstellbar in den Bestandseinstellungen), muss die Sitzung vor dem Buchen geprüft werden; das Buchen passt den Bestand an und erzeugt einen Buchungsbeleg.",
                },
            ],
        },
        purchases: {
            title: "Einkauf & Lieferanten",
            icon: '🚚',
            faqs: [
                {
                    q: "Wie erfasse ich einen Einkauf bei einem Lieferanten?",
                    a: "Gehen Sie zu Einkauf → Einkäufe und legen Sie einen an: Filiale/Lager und Lieferanten wählen (oder direkt anlegen) und Produktzeilen mit Menge und Stückkosten hinzufügen, dazu optional Steuer, Rabatt und Fracht. Das Speichern des Einkaufs bucht den Wareneingang sofort (Bestand steigt) und den vollen Betrag als Verbindlichkeit — es gibt kein Bargeldfeld, erfassen Sie Zahlungen also separat als Lieferantenzahlung.",
                },
                {
                    q: "Was ist der Unterschied zwischen Bestellung und Einkauf?",
                    a: "Eine Bestellung (Einkauf → Bestellungen) ist eine Zusage, die den Bestand nicht verändert. Erst wenn Sie sie als Erhalten markieren, erhöht sie den Bestand und bucht die Verbindlichkeit, genau wie ein direkter Einkauf. Nutzen Sie Bestellungen, wenn Sie vor der Lieferung ordern, und einen direkten Einkauf, wenn die Ware gleichzeitig eintrifft.",
                },
                {
                    q: "Wie sende ich Ware an einen Lieferanten zurück?",
                    a: "Nutzen Sie Einkauf → Einkaufsretouren. Eine Retoure kann mit einem Einkauf verknüpft sein oder eigenständig stehen; sie verringert den Bestand, senkt den offenen Saldo des Lieferanten (begrenzt auf den aktuell geschuldeten Betrag) und bucht den passenden Beleg.",
                },
                {
                    q: "Wie bezahle ich Lieferanten und sehe meine Verbindlichkeiten?",
                    a: "Erfassen Sie Zahlungen unter Einkauf → Lieferantenzahlung — Sie können zahlen oder Geld erhalten, eine Zahlung auf bestimmte Rechnungen verteilen und einen Rest als Anzahlung für später stehen lassen. Einkauf → Lieferantenkonto zeigt den laufenden Saldo je Lieferant, und zu jedem Lieferanten gibt es zudem eine Abrechnungsübersicht und ein Kreditkonto.",
                },
            ],
        },
        accounting: {
            title: "Buchhaltung",
            icon: '📊',
            faqs: [
                {
                    q: "Muss ich Buchungssätze selbst erfassen?",
                    a: "Nein — das System führt die doppelte Buchhaltung automatisch. Buchungsregeln (Buchhaltung → Buchungsregeln) ordnen jedem betrieblichen Vorgang (Verkauf, Einkauf, Retoure, Umlagerung, Gehalt, Korrektur) die zu belastenden und zu erkennenden Konten zu, und Belege entstehen, sobald diese Vorgänge eintreten. Manuell buchen Sie nur, was die Regeln nicht abdecken.",
                },
                {
                    q: "Was ist der Kontenplan?",
                    a: "Der Kontenplan (Buchhaltung → Kontenplan) ist die Stammliste Ihrer Sachkonten — Vermögen, Verbindlichkeiten, Eigenkapital, Erträge und Aufwendungen — gegliedert in Gruppen und Untergruppen. Jede Belegzeile bucht auf eines dieser Konten, er ist damit die Grundlage aller Berichte.",
                },
                {
                    q: "Kann ich manuell buchen, und welche Berichte gibt es?",
                    a: "Ja — Buchhaltung → Belegerfassung erfasst Kassen-, Bank-, Umbuchungs- und Journalbelege von Hand, und die Ansichten Belege, Journal und Konto dienen der Prüfung. Zu den Berichten zählen Summen- und Saldenliste, GuV, Bilanz, Kassenbuch, Bankbuch, OP-Listen für Forderungen/Verbindlichkeiten und ein MwSt./Steuerbericht; Geschäftsperioden können abgeschlossene Monate sperren, um Rückdatierungen zu verhindern.",
                },
                {
                    q: "Wie exportiere ich nach Tally oder QuickBooks?",
                    a: "Klicken Sie auf der Buchhaltungsübersicht auf „Exportieren“, wählen Sie Tally XML oder QuickBooks IIF, legen Sie einen Zeitraum fest und laden Sie die Datei herunter. Sie lässt sich direkt in das jeweilige Buchhaltungspaket importieren.",
                },
            ],
        },
        crm: {
            title: "CRM & Leads",
            icon: '🤝',
            faqs: [
                {
                    q: "Was umfasst das CRM-Modul, und wer kann es nutzen?",
                    a: "CRM deckt Leads, Konversationen, Wiedervorlagen, Kampagnen und Kunden ab, dazu Einstellungen für Lead-Quellen & -Kategorien sowie benutzerdefinierte Felder, alle erreichbar über die CRM-Übersicht. Das meiste davon ist eine Funktion des Premium-Tarifs — in anderen Tarifen bleiben die Kunden verfügbar, die Pipeline-Werkzeuge sind aber ausgeblendet.",
                },
                {
                    q: "Wie lege ich einen Lead an und bearbeite ihn?",
                    a: "Gehen Sie zu CRM → Leads → „Neuer Lead“ und geben Sie mindestens einen Namen ein (Mobilnummer, E-Mail, Quelle, Kategorie, Priorität, Status, Social-Links und nächster Schritt sind optional). Ein Lead durchläuft feste Stufen — Neu, Kontaktiert, Qualifiziert, Verloren, Konvertiert — und Sie weisen ihn über die Person unter „Nächster Schritt zugewiesen an“ zu; die Liste unterstützt auch Massenzuweisung und Statusänderungen. Wenn es so weit ist, legt „In Kunde umwandeln“ den Kunden im Verkauf an oder verknüpft ihn.",
                },
                {
                    q: "Woher stammen die Listen für Quelle und Kategorie?",
                    a: "Es sind Ihre eigenen Stammdaten — verwalten Sie sie unter CRM → Quellen & Kategorien. Jede Quelle trägt zudem eine Punktgewichtung (0–25), die in den automatischen Lead-Score einfließt. Sie können Werte hinzufügen, bearbeiten, ausblenden oder löschen; beim Löschen eines verwendeten Werts werden Sie gebeten, die betroffenen Leads auf einen Ersatz umzuhängen, und eingebaute Werte werden ausgeblendet statt entfernt.",
                },
                {
                    q: "Wie funktionieren Wiedervorlagen und Konversationen?",
                    a: "Wiedervorlagen (CRM → Wiedervorlagen) sind eine einzige Warteschlange von Erinnerungen — Allgemein, Inkasso, Geburtstag oder Nachbestellung —, die von der Detailseite eines Kunden oder Leads aus entstehen; Geburtstags- und Nachbestellerinnerungen werden zusätzlich automatisch erzeugt. Konversationen (CRM → Konversationen) ist ein schreibgeschütztes, filterbares Protokoll jedes Kontaktpunkts (Anruf, SMS, WhatsApp, Besuch usw.), der teamweit zu Leads erfasst wurde; einen neuen Eintrag erfassen Sie auf der Detailseite des Leads.",
                },
            ],
        },
        manufacturing: {
            title: "Fertigung",
            icon: '🏭',
            faqs: [
                {
                    q: "Wie lege ich eine Rezeptur (Stückliste) an?",
                    a: "Öffnen Sie auf der Fertigungsseite den Reiter Stückliste und klicken Sie auf „Neue Stückliste“. Eine Rezeptur benennt ein Ausgangsprodukt, wie viele Einheiten ein Durchlauf erzeugt, und die Komponenten mit Mengen. Komponenten werden über die Produkt-ID erfasst, und das Ausgangsprodukt einer Rezeptur lässt sich nach dem Anlegen nicht mehr ändern. Fertigung ist eine Premium-/Zusatzfunktion.",
                },
                {
                    q: "Wie wirkt sich ein Fertigungsauftrag auf den Bestand aus?",
                    a: "Legen Sie im Reiter Fertigungsaufträge einen Auftrag aus einer Stückliste und einer Losgröße an; er beginnt als Entwurf. Beim Start wird erneut geprüft, ob die Komponenten vorrätig sind, und beim Abschluss werden die Komponenten verbraucht (zuzüglich eingetragenem Ausschuss) und die Fertigerzeugnisse dem Bestand zugebucht. Die Fertigung bewegt ausschließlich Bestand — sie bucht nicht ins Hauptbuch.",
                },
                {
                    q: "Wie werden Auftragskosten und Verkaufspreis berechnet?",
                    a: "Beim Abschluss wird der Materialaufwand aus den jeweils letzten Kosten jeder Komponente festgehalten, und Sie können weitere Kostenzeilen ergänzen (Lohn, Druck, Transport, Gemeinkosten usw.), optional aus einer Dienstleistungsrechnung übernommen. Der Auftrag weist dann Gesamtkosten und Kosten je Einheit aus, und für abgeschlossene Aufträge schlägt ein Preisbereich einen Verkaufspreis nach dem Zuschlagsprinzip vor, den Sie auf das Produkt anwenden können.",
                },
            ],
        },
        hr: {
            title: "Personal & Lohn",
            icon: '👥',
            faqs: [
                {
                    q: "Wie lege ich Mitarbeitende an?",
                    a: "Gehen Sie zu Personal → Mitarbeitende → „Neue Person“ und erfassen Sie mindestens Name und Telefonnummer (E-Mail, Eintrittsdatum, Ausweisnummer, Abteilung, Position und Grundgehalt sind optional), oder legen Sie mehrere über den Importdialog an. Ein Personalcode wird automatisch vergeben, und Sie können eine Person mit einem Systemzugang verknüpfen, damit sie sich anmelden kann.",
                },
                {
                    q: "Wie werden Anwesenheit und Urlaub abgebildet?",
                    a: "Personal → Anwesenheit erfasst je Person und Tag einen Eintrag — Anwesend, Abwesend, Halbtags oder Feiertag, mit optionalen Kommt-/Geht-Zeiten — manuell, da es kein Zeiterfassungsgerät gibt. Personal → Abwesenheiten hat zwei Reiter: Anträge (einreichen, dann genehmigen oder ablehnen) und Arten (Abwesenheitsart und Tage pro Jahr festlegen).",
                },
                {
                    q: "Wie zahle ich Gehälter aus?",
                    a: "Nutzen Sie Personal → Gehaltszahlungen → „Gehalt zahlen“, wählen Sie Person und Abrechnungszeitraum und erfassen Sie Betrag (aus dem Grundgehalt vorbelegt) und Zahlungsart. Jede Zahlung erzeugt einen Buchungsbeleg (Soll: Verbindlichkeiten aus Löhnen, Haben: Zahlungskonto). Zahlungen sind einzelne Pauschalbeträge — Lohnabrechnungen oder Zuschlags-/Abzugsaufstellungen gibt es noch nicht.",
                },
            ],
        },
        aiAssistant: {
            title: "KI-Assistent",
            icon: '🤖',
            faqs: [
                {
                    q: "Was ist der KI-Geschäftsassistent und wie öffne ich ihn?",
                    a: "Es ist ein Chat-Bereich — das Roboter-Symbol „Den Geschäftsassistenten fragen“ —, der Fragen zu Ihren eigenen Daten beantwortet: Verkäufe, Bestand, Kunden, Forderungen und mehr. Er ist streng schreibgeschützt: Er kann nachschlagen und erklären, aber nichts verändern. Der Assistent ist eine Funktion des Premium-Tarifs, das Symbol erscheint also nur, wenn Ihr Tarif ihn enthält.",
                },
                {
                    q: "Was sieht er tatsächlich, und kann ich den Antworten trauen?",
                    a: "Fragen Sie „Was kannst du?“, und er nennt Ihre Filialen, wie weit Ihre Aufzeichnungen zurückreichen und welche Werkzeuge er nutzen kann — eine leere Antwort bedeutet also einen leeren Zeitraum, keine fehlerhafte Abfrage. Jede Antwort führt ihre Quellen auf (die genauen Berichte und Zeiträume), sodass Sie sie überprüfen können. Sie können ihn auch bitten, auf auffällige Vorgänge zu prüfen — Verkäufe unter Einstandspreis, doppelte Rechnungen, große Preisausreißer — und er sagt Ihnen, wenn eine Prüfung nicht abgeschlossen werden konnte, statt Unbedenklichkeit zu suggerieren.",
                },
                {
                    q: "Was sind KI-Credits und wie bekomme ich mehr?",
                    a: "KI-Credits sind ein monatliches Kontingent Ihres Tarifs (1 Credit = 1.000 Token), das der Assistent und andere KI-Funktionen verbrauchen; einsehbar unter KI-Credits. Sie werden zu jeder Abrechnungsperiode zurückgesetzt und lassen sich nicht separat kaufen — ein größeres Kontingent erhalten Sie durch ein Upgrade (BASIC enthält 100/Monat, STANDARD 500). Sie unterscheiden sich von SMS-Credits, die vorausbezahlt und käuflich sind.",
                },
                {
                    q: "Kann ich eine Frage sprechen statt tippen?",
                    a: "Ja — sofern Ihr Browser es unterstützt (Chrome, Edge oder Safari über HTTPS), erscheint neben Senden ein Mikrofon. Tippen Sie darauf, sprechen Sie Ihre Frage, bearbeiten Sie den Text bei Bedarf und senden Sie ab. Antworten liest der Assistent noch nicht vor.",
                },
            ],
        },
        billing: {
            title: "Abrechnung & Abo",
            icon: '💳',
            faqs: [
                {
                    q: "Wie führe ich ein Upgrade durch?",
                    a: "Gehen Sie zu Abrechnung, wählen Sie eine Tarifkarte und Monatlich oder Jährlich und fahren Sie mit der SSL-Wireless-Kasse fort (die Karte, bKash und Nagad akzeptiert). Jährliche Zahlung kostet zehn Monate — praktisch zwei Monate gratis, rund 17 % Ersparnis. Nur der Inhaber oder eine Rolle mit Abrechnungsrecht kann das Abo ändern.",
                },
                {
                    q: "Kann ich mein Abo kündigen?",
                    a: "Ja — wählen Sie in der Abrechnung „Zum Periodenende kündigen“. Ihr Zugang bleibt bis zum Ende der laufenden bezahlten Periode bestehen, und es wird nichts gelöscht. Einzelheiten finden Sie in der Rückerstattungsrichtlinie unter /refund.",
                },
                {
                    q: "Was passiert, wenn meine Zahlung fehlschlägt oder der Tarif ausläuft?",
                    a: "Das Abo wird zunächst auf überfällig gesetzt, und Sie erhalten während einer kurzen Nachfrist (etwa 7 Tage) Erinnerungs-E-Mails. Bleibt es danach unbezahlt, wird das Konto nicht gelöscht, sondern auf den Free-Tarif herabgestuft — Ihre Daten bleiben stets erhalten, und mit einer erneuten Zahlung stehen alle Funktionen wieder zur Verfügung.",
                },
                {
                    q: "Was ist der Unterschied zwischen KI-Credits und SMS-Credits?",
                    a: "KI-Credits sind ein monatliches Tarifkontingent für KI-Funktionen und werden je Periode zurückgesetzt. SMS-Credits sind ein vorausbezahltes Guthaben, das Sie unter SMS-Credits aufladen: Es wird verbraucht, wenn das System Nachrichten versendet (Verkaufsbelege, Warnungen bei geringem Bestand, CRM-Kampagnen), ein Credit je Nachrichtensegment und Empfänger, und ein niedriger Stand warnt Sie, bevor Sendungen fehlschlagen.",
                },
            ],
        },
        storefront: {
            title: "E-Commerce-Onlineshop",
            icon: '🌐',
            faqs: [
                {
                    q: "Wie schalte ich meinen Onlineshop ein?",
                    a: "Gehen Sie zu Onlineshop → Onlineshop (Einstellungen), schalten Sie ihn ein und legen Sie einen URL-Slug fest (Kleinbuchstaben, Ziffern und Bindestriche). Ihr öffentlicher Shop liegt dann unter /store/ihr-slug, und Sie können Banner, Hero-Überschrift und Bild ergänzen.",
                },
                {
                    q: "Wie geben Kundinnen und Kunden Bestellungen auf?",
                    a: "Sie öffnen Ihre Shop-URL, stöbern in den vorrätigen Produkten und bestellen unter Angabe ihrer Kontaktdaten. Bestellungen laufen unter Onlineshop → Online-Bestellungen als Ausstehend ein, wo Sie sie als Bestätigt oder Storniert markieren können.",
                },
                {
                    q: "Verringern Shop-Bestellungen automatisch meinen Bestand?",
                    a: "Noch nicht. Eine Shop-Bestellung prüft die Verfügbarkeit, bucht den Bestand aber nicht ab, und das Bestätigen ändert nur den Status — Kommissionierung und Bestandskorrektur nehmen Sie selbst vor. Die automatische Bestandsbuchung für Online-Bestellungen steht für ein künftiges Release auf unserer Roadmap.",
                },
            ],
        },
        security: {
            title: "Sicherheit & Konto",
            icon: '🔒',
            faqs: [
                {
                    q: "Wie aktiviere ich die Zwei-Faktor-Authentifizierung (2FA)?",
                    a: "Öffnen Sie Ihr Profil über das Kontomenü und wechseln Sie zum Reiter 2FA. Klicken Sie auf QR erzeugen, scannen Sie ihn mit einer Authenticator-App (Google Authenticator, Authy usw.), geben Sie den 6-stelligen Code ein und aktivieren Sie. Danach wird bei der Anmeldung ein Code von Ihrem Telefon abgefragt.",
                },
                {
                    q: "Was, wenn ich mein Passwort vergesse?",
                    a: "Klicken Sie auf der Anmeldeseite auf „Passwort vergessen“ und geben Sie Ihre E-Mail-Adresse ein, um einen Link zum Zurücksetzen zu erhalten. Sie können Ihr Passwort außerdem jederzeit unter Profil → Passwort ändern (das neue Passwort muss mindestens 8 Zeichen haben).",
                },
                {
                    q: "Wie exportiere oder lösche ich meine Daten?",
                    a: "Gehen Sie zu Profil → Daten & Datenschutz. „Meine Daten herunterladen“ erzeugt einen JSON-Export Ihres Kontos, und „Datenlöschung beantragen“ startet einen Löschantrag, der innerhalb von 30 Tagen bearbeitet wird.",
                },
                {
                    q: "Wie funktionieren Rollen und Teamzugriff?",
                    a: "Personen verwalten Sie unter Team. Die eingebauten Rollen sind OWNER, MANAGER, CASHIER und ACCOUNTANT, und Sie können eigene Rollen anlegen; jede Rolle gewährt bestimmte Modul- und Aktionsberechtigungen. Nur der Inhaber oder eine Person mit „Manage Users“ kann Mitglieder einladen oder Rollen ändern.",
                },
            ],
        },
    },
} as const;
