export const AUTO_INTERVAL = -1;

export const INTERVALS = [
  { sec: 15, label: "15 secondes" },
  { sec: 30, label: "30 secondes" },
  { sec: 60, label: "1 minute" },
  { sec: 120, label: "2 minutes" },
  { sec: 300, label: "5 minutes" },
  { sec: AUTO_INTERVAL, label: "Auto" },
] as const;

export const MODELS = [
  { id: "gpt-4o", label: "GPT-4o — le plus fiable pour lire le code" },
  { id: "gpt-4o-mini", label: "GPT-4o mini — plus économique" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
] as const;

export const DEFAULT_MODEL = "gpt-4o";
export const DEFAULT_INTERVAL = 60;
export const MAX_PHOTOS_PER_SEND = 24;
export const PHOTO_BATCH = 8;

export const LEGACY_BRIEFS = [
  "Reconstitue chaque fichier visible en entier. Garde le nom de fichier affiché (onglet, titre ou chemin). Si plusieurs photos montrent le même fichier, fusionne-les dans l'ordre, du haut du fichier vers la suite.",
];

export const DEFAULT_BRIEF =
  "Reconstitue chaque fichier visible en entier. Garde le chemin complet, dossiers inclus. Si plusieurs photos montrent le même fichier, fusionne-les du haut vers le bas, et recopie le code tel quel.\n\nRéponds par un seul bloc, sans autre texte et sans plusieurs zones à copier. Chaque fichier commence par /:/: puis son chemin, puis /:/:, puis son contenu. Exemple :\n/:/:B2/POO/Animal.php/:/:\n<?php\nclass Animal {}\n/:/:B2/POO/Chien.php/:/:\n<?php\nclass Chien extends Animal {}";

export const CHAT_PROMPT = `Tu reçois des photos prises dans l'ordre chronologique, devant un écran, une feuille ou un tableau. Ton seul travail : reconstituer les fichiers de code visibles, prêts à être rangés.

Comment lire les photos :
- Chaque photo continue la précédente. Lis-les du haut vers le bas, dans l'ordre où elles sont données.
- Le nom que tu écris est le fichier, précédé d'un seul dossier : Dossier/fichier.php. Tu ne recopies jamais un chemin d'ordinateur. /home/coucou.php ou C:\\cours\\coucou.php deviennent seulement coucou.php, puis tu choisis le dossier.
- Le dossier, c'est toi qui le décides. Si plusieurs fichiers vont ensemble (un exercice, une classe et celles qui l'utilisent, une page et son style), ils partagent un dossier au nom court, pris sur ce que tu vois : 11-Les-exceptions/1-exception-simple.php.
- Si tu ne sais pas dans quel dossier ranger le fichier, ou s'il n'a pas de dossier à lui, tu le mets dans DIVERS : DIVERS/Commerce.php.
- Un fichier déjà écrit dans un dossier y reste. Les photos suivantes corrigent ce même fichier, au même chemin. Tu ne le déplaces pas, ni depuis DIVERS, ni depuis un autre dossier.
- Exception : s'il était dans DIVERS et qu'une photo plus tardive montre qu'il a besoin d'un autre fichier, donc d'un vrai dossier, tu laisses DIVERS/Nom.php tel qu'il est, et tu crées un second fichier du même nom dans le nouveau dossier. Tu n'effaces pas la copie DIVERS.
- Plusieurs photos du même fichier deviennent un seul fichier. Fusionne-les du haut du fichier vers la suite. Ne recommence pas le fichier à chaque photo.
- Recopie ce qui est lisible tel quel : indentation, lignes vides, commentaires. N'embellis pas une ligne que tu vois clairement.
- Écris les espaces, tabulations et signes < > & tels quels. N'utilise aucune entité HTML : pas de &#x20;, &nbsp;, &lt; ou &amp;.
- N'ajoute aucun antislash en fin de ligne. Écris <?php, pas \\<?php\\, et ne termine pas chaque ligne par \\.
- N'écris jamais [illisible]. Si un morceau est coupé, flou ou impossible à lire, remplace-le par le code le plus probable pour que le fichier s'exécute.
- S'il manque le début, ajoute ce début. Exemple : le fichier appelle une fonction qui n'apparaît nulle part, alors tu ajoutes <?php et tu crées cette fonction, avec un corps crédible, pour que l'appel ait un sens.
- Une photo plus tardive du même fichier remplace ce que tu avais deviné. Si le vrai début, la vraie fonction ou la vraie ligne apparaît, tu effaces ta version provisoire et tu mets ce qui est écrit.
- Ignore l'interface autour du fichier : navigateur, menus, explorateur, numéros de ligne, minimap, autres onglets. Sers-t'en seulement pour lire le nom du fichier ouvert.
- Ne crée pas un fichier dont aucune photo ne montre le nom. Tu complètes les fichiers visibles, tu n'en ouvres pas un nouveau de ton côté.

Comment répondre :
- Réponds par un seul bloc de texte. Pas de phrase avant, pas de phrase après, pas de titre, pas de liste, pas de plusieurs zones à copier, pas de balises markdown.
- Chaque fichier commence par /:/: puis Dossier/nom.ext, puis /:/:, puis son contenu. Le dossier est celui que tu as choisi, ou DIVERS. Un seul niveau, jamais un chemin d'ordinateur.
- Le contenu va jusqu'au prochain /:/: , ou jusqu'à la fin s'il n'y a plus de fichier.
- S'il y a un autre fichier, enchaîne tout de suite avec /:/: puis Dossier/nom.ext, puis /:/:, puis son contenu.
- La suite de caractères /:/: ne sert qu'à ouvrir un nom de fichier et à le fermer. Ne l'écris nulle part dans le code.
- Il y a toujours au moins un fichier.

Forme exacte, ici avec deux fichiers :
/:/:DIVERS/Commerce.php/:/:
<?php
echo "ok";
/:/:11-Les-exceptions/1-exception-simple.php/:/:
<?php
function diviser(int $a, int $b) { return $a / $b; }`;

export function isAutoInterval(sec: number) {
  return sec === AUTO_INTERVAL || sec === 600;
}

export function isInterval(sec: number): boolean {
  return INTERVALS.some((item) => item.sec === sec) || sec === 600;
}

export function isModel(value: string): boolean {
  return MODELS.some((item) => item.id === value);
}
