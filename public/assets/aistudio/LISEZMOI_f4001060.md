# Suivi PAC — programme Windows + page mobile

## Ce que contient le dossier
| Fichier | Rôle |
|---|---|
| `suivi_pac.py` | L'interface (page de saisie + page de suivi). **C'est lui qu'on lance.** |
| `suivi_core.py` | Les calculs, la lecture/écriture d'Excel, la page mobile. Même dossier que le précédent. |
| `construire_exe.bat` | Double-clic = fabrique `dist\SuiviPAC.exe`. |
| `requirements.txt` | Liste des modules Python à installer. |

## 1. Installer (une seule fois)
1. Installer **Python 3.10 ou plus** depuis python.org (cocher « Add Python to PATH ») ; Thonny peut aussi servir d'installation.
2. Dans **Thonny** : menu *Outils → Gérer les paquets…* et installer : `openpyxl`, `lxml`, `matplotlib`, `cryptography`, `pyinstaller`.

## 2. Lancer avec Thonny
Ouvrir `suivi_pac.py` dans Thonny, puis ▶ (F5). Au premier lancement, choisir votre fichier `Suivi_PAC.xlsx`.
Le programme crée à côté de lui `config.json` (chemin du fichier Excel) et `donnees_pac.json` (vos saisies).

## 3. Fabriquer l'exe
- Le plus simple : double-cliquer `construire_exe.bat` (compter 2 à 5 minutes). Résultat : `dist\SuiviPAC.exe`.
- À la main : dans Thonny, *Outils → Ouvrir l'interpréteur système*, puis :
  `pyinstaller --noconsole --onefile --name SuiviPAC --hidden-import matplotlib.backends.backend_tkagg --hidden-import lxml._elementpath --hidden-import cryptography.hazmat.primitives.ciphers.aead suivi_pac.py`
- Copier `SuiviPAC.exe` où vous voulez. Il crée ses fichiers (`config.json`, `donnees_pac.json`, `sauvegardes\`, `mobile\`) dans son propre dossier.
### Si le .bat ne marche pas (message « 'py' n'est pas reconnu » ou « Python introuvable »)
Python n'est alors visible que dans Thonny. Faites ceci :
1. Ouvrez `suivi_pac.py` dans Thonny (le dossier courant devient celui du fichier).
2. Menu **Outils → Ouvrir l'interpréteur système** : une fenêtre noire s'ouvre dans le bon dossier.
3. Tapez ces deux lignes, une par une (Entrée après chacune) :
   `python -m pip install -r requirements.txt`
   `python -m PyInstaller --noconsole --onefile --name SuiviPAC --hidden-import matplotlib.backends.backend_tkagg --hidden-import lxml._elementpath --hidden-import cryptography.hazmat.primitives.ciphers.aead suivi_pac.py`
4. Quand « completed successfully » apparaît, l'exe est dans le sous-dossier `dist`.

- Si l'antivirus le bloque (faux positif fréquent avec `--onefile`), remplacer `--onefile` par `--onedir`, ou ajouter une exception.

## 4. Utilisation
**Saisie du jour** : date (◄ ► pour changer de jour), température, PAC consommée/produite, EDF kWh et €, gaz (non compté). Les résultats s'affichent en gras et en couleur (vert = mieux que l'an dernier, rouge = pire), avec en dessous deux graphiques : aujourd'hui vs N-1 / N-2 / N-3 / moyenne, et la jauge de l'objectif d'économies de l'année. Puis **Enregistrer ce jour**.

**Règle de calcul** : la dépense de cette année = **EDF seulement** (le gaz n'est plus compté). Les références (N-1, N-2, N-3, moyenne) = **électricité + gaz** de ces années-là.

**Suivi** (page défilante) : cartes *Économie cumulée vs N-1* et *Bénéfice vs N-1* (cumulé, mois, dernier jour, objectifs 700 € et 35 % sur l'année de chauffage du 15/09 au 14/09), puis 6 graphiques : dépense de chauffage par mois, économie cumulée avec objectif, économie par mois, année de chauffage (N-1 gaz + élec et élec PAC, sans les mois à 0), dépense du jour vs N-1 et objectif -35 %, COP réel.

**Objectifs** : lus dans la feuille *Verdict du jour* de l'Excel (F16 = 35 %, F17 = 700 €).

**Écrire dans Excel** : remplit les colonnes de saisie de la feuille *Journal* (sans toucher aux formules, aux graphiques ni aux autres feuilles) et force Excel à tout recalculer à l'ouverture.
- Le fichier Excel doit être **fermé** au moment du clic.
- Une copie datée est faite dans `sauvegardes\` avant chaque écriture.
- La date doit exister dans la colonne A du Journal (jusqu'à fin avril 2027 dans votre fichier).
- Menu *Fichier → Relire les saisies depuis Excel* : sens inverse (Excel remplace l'appli).

## 5. Téléphone (Android)
Le programme génère `mobile\index.html` : une page autonome (cartes + 3 graphiques + tableau mensuel), sans internet.
- **Wi-Fi** : menu *Téléphone → Partager sur le Wi-Fi*, puis ouvrir l'adresse affichée dans Chrome sur le téléphone (même Wi-Fi). Fonctionne tant que le programme est ouvert.
- **Dossier synchronisé** : menu *Téléphone → Choisir un dossier partagé* (OneDrive, Google Drive…). Chaque clic sur *Page mobile* y copie la page ; l'ouvrir depuis l'appli Drive/OneDrive du téléphone.
- Chrome → ⋮ → *Ajouter à l'écran d'accueil* : la page se lance comme une appli.

## 6. Ce qui est calculé, et d'où ça vient
Le programme lit dans votre Excel : la feuille *Paramètres* (prix, abonnements, tolérance, fenêtre), *Données* (Enedis, gaz, météo) et *Ref N-1*. Il refait les mêmes calculs que le Journal : dépense du jour = EDF € + gaz € ; référence N-1 = colonne J de *Ref N-1* ; moyenne = N-1, N-2, N-3 sur la fenêtre ±3 jours. Si vous changez la structure de ces feuilles, les en-têtes du Journal (Date, Temp ext, PAC conso…) doivent rester reconnaissables.

## 7. Publier en ligne (GitHub Pages) protégé par mot de passe
La page et `data.json` sont **chiffrés** (PBKDF2-SHA256 200 000 tours + AES-256-GCM) avec votre mot de passe avant d'être envoyés. Sans le mot de passe, GitHub et les visiteurs ne voient que du texte illisible. Le déchiffrement se fait dans le navigateur du téléphone : le mot de passe ne part nulle part.
La version Wi-Fi local / dossier partagé (menu Téléphone → Générer la page mobile) reste **non chiffrée** : elle ne sort pas de chez vous.

**À faire une seule fois**
1. Créer un compte gratuit sur github.com (identifiant neutre, pas votre vrai nom).
2. *New repository* : nom `suivi-pac-x7k2q9` (le vôtre), **Public**, cocher *Add a README file*, *Create repository*.
3. Dans le dépôt : *Settings → Pages → Build and deployment → Source : Deploy from a branch → Branch : main, dossier / (root) → Save*.
4. Créer un jeton : photo de profil → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*. Durée 1 an, *Repository access : Only select repositories* (votre dépôt), *Permissions → Repository permissions → Contents : Read and write*. Copier le jeton (`github_pat_…`) : il ne s'affiche qu'une fois.
5. GitHub → *Settings → Emails* : cocher *Keep my email addresses private* et *Block command line pushes that expose my email*. Laisser vide nom, lieu et présentation du profil.
6. Dans le programme : *Téléphone → Configurer la publication en ligne…* : identifiant GitHub, nom du dépôt, jeton, **mot de passe de la page** (long, que vous ne réutilisez pas ailleurs).

**A chaque mise à jour** : *Téléphone → Publier en ligne*. L'adresse `https://IDENTIFIANT.github.io/NOM-DU-DEPOT/` est copiée. Sur le téléphone : ouvrir l'adresse, saisir le mot de passe (case « Rester connecté sur cet appareil »), puis Chrome → ⋮ → *Ajouter à l'écran d'accueil*. Première publication : comptez 1 à 2 minutes.

**Sécurité**
- Le jeton et le mot de passe sont enregistrés en clair dans `config.json` à côté du programme : ne partagez pas ce fichier ni le dossier de l'exe.
- Un mot de passe faible peut être deviné par force brute (le fichier chiffré est public). Prenez une phrase de 4 mots ou plus.
- Changer le mot de passe : le reconfigurer puis republier ; l'ancien reste lisible dans l'historique GitHub avec l'ancien mot de passe (sans importance si vous l'abandonnez).
- « Rester connecté » mémorise le mot de passe dans le navigateur du téléphone : à éviter sur un appareil partagé.

**Pour une future appli** : `https://IDENTIFIANT.github.io/NOM-DU-DEPOT/data.json` contient :
`{"v":1,"kdf":"PBKDF2-SHA256","iter":200000,"cipher":"AES-256-GCM","salt":"…","iv":"…","ct":"…"}` (valeurs en base64).
Clé = PBKDF2-HMAC-SHA256(mot de passe UTF-8, salt, 200000 tours, 32 octets). Déchiffrement AES-256-GCM avec `iv` ; `ct` = texte chiffré suivi de l'étiquette GCM de 16 octets (format natif de WebCrypto). Le résultat est un JSON : indicateurs, mois, jours, COP.
