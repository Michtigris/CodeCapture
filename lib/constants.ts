export const AUTO_INTERVAL = -1;

export const SENSES = [
  { id: "faible", label: "Faible", ratio: 0.08, delta: 16 },
  { id: "moyen", label: "Moyen", ratio: 0.15, delta: 24 },
  { id: "normal", label: "Normal", ratio: 0.25, delta: 32 },
  { id: "forte", label: "Forte", ratio: 0.45, delta: 48 },
] as const;

export type SenseId = (typeof SENSES)[number]["id"];

export function senseById(id: string | null | undefined) {
  return SENSES.find((item) => item.id === id) ?? SENSES[2];
}

export const GAPS = [
  { sec: 0, label: "Instant" },
  { sec: 2, label: "2 secondes" },
  { sec: 5, label: "5 secondes" },
  { sec: 15, label: "15 secondes" },
  { sec: 30, label: "30 secondes" },
  { sec: 60, label: "1 minute" },
] as const;

export type GapSec = (typeof GAPS)[number]["sec"];

export function gapBySec(value: unknown): GapSec {
  if (value === null || value === undefined || value === "") return 5;
  const sec = typeof value === "number" ? value : Number(value);
  const found = GAPS.find((item) => item.sec === sec);
  return found ? found.sec : 5;
}

export function isGap(value: unknown): value is GapSec {
  if (value === null || value === undefined || value === "") return false;
  const sec = typeof value === "number" ? value : Number(value);
  return GAPS.some((item) => item.sec === sec);
}

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

export const CHAT_PROMPT = `Tu reçois des photos prises dans l'ordre chronologique, devant un écran, une feuille ou un tableau. Ton seul travail : recopier les fichiers de code visibles, ligne par ligne, sans rien résumer.

Comment lire les photos :
- Chaque photo est une fenêtre sur un fichier, pas le fichier entier. Une photo montre souvent une dizaine de lignes. Le fichier continue au-dessus et en dessous. Tu assembles toutes les fenêtres.
- Lis les photos dans l'ordre, du haut vers le bas. Quand la photo suivante montre le même fichier, garde les lignes déjà lues et ajoute seulement les lignes nouvelles. Ne recommence pas le fichier, et ne garde pas seulement la dernière photo.
- Le fichier final a autant de lignes que l'assemblage des photos. S'il y en a 40, tu en écris 40. Tu n'as pas le droit de t'arrêter à 10 lignes, ni de remplacer un fichier par une version plus courte.
- Recopie chaque ligne visible telle qu'elle est écrite : indentation, lignes vides, commentaires, noms, nombres. Tu ne réécris pas, tu ne simplifies pas, tu n'embellis pas, tu ne rends pas le code « plus propre ».
- Tu n'inventes aucune ligne, fonction, classe ou fichier qui n'est pas sur les photos. Tu ne complètes pas un fichier pour qu'il « s'exécute ». Si quelques caractères d'une ligne sont flous, tu recopies le reste de cette ligne et tu devines seulement ces caractères. Tu n'écris jamais [illisible].
- Une photo plus tardive du même endroit remplace ce que tu avais deviné sur ces caractères. Le vrai texte de la photo gagne.
- Écris les espaces, tabulations et signes < > & tels quels. N'utilise aucune entité HTML : pas de &#x20;, &nbsp;, &lt; ou &amp;.
- N'ajoute aucun antislash en fin de ligne. Écris <?php, pas \\<?php\\, et ne termine pas chaque ligne par \\.
- Ignore l'interface autour du fichier : navigateur, menus, explorateur, numéros de ligne, minimap, autres onglets. Sers-t'en seulement pour lire le nom du fichier ouvert.
- Ne crée pas un fichier dont aucune photo ne montre le nom.

Le nom du fichier :
- Tu écris un seul dossier, puis le fichier : Dossier/fichier.php. Tu ne recopies jamais un chemin d'ordinateur. /home/coucou.php ou C:\\cours\\coucou.php deviennent seulement coucou.php, puis tu choisis le dossier.
- Le dossier, c'est toi qui le décides, d'après ce que tu vois (le titre du cours, l'exercice). Exemple de forme : 11-Les-exceptions/1-exception-simple.php.
- Si tu ne sais pas dans quel dossier ranger le fichier, tu le mets dans DIVERS : DIVERS/Nom.php.
- Un fichier déjà écrit dans un dossier y reste. Les photos suivantes corrigent ce même fichier, au même chemin. Tu ne le déplaces pas.
- Exception : s'il était dans DIVERS et qu'une photo plus tardive montre qu'il va avec d'autres fichiers, tu laisses DIVERS/Nom.php, et tu crées aussi NouveauDossier/Nom.php avec le même contenu complet. Tu n'effaces pas la copie DIVERS.

Comment répondre :
- Réponds par un seul bloc de texte. Pas de phrase avant, pas de phrase après, pas de titre, pas de liste, pas de plusieurs zones à copier, pas de balises markdown.
- Chaque fichier commence par /:/: puis Dossier/nom.ext, puis /:/:, puis tout son contenu. Un seul niveau de dossier.
- Le contenu va jusqu'au prochain /:/: , ou jusqu'à la fin s'il n'y a plus de fichier.
- S'il y a un autre fichier, enchaîne tout de suite avec /:/: puis Dossier/nom.ext, puis /:/:, puis tout son contenu.
- La suite de caractères /:/: ne sert qu'à ouvrir un nom de fichier et à le fermer. Ne l'écris nulle part dans le code.
- Il y a toujours au moins un fichier.

La forme ci-dessous montre seulement les séparateurs. Elle ne montre pas la longueur. Tes fichiers sont ceux des photos, aussi longs qu'elles.
/:/:DIVERS/Nom.php/:/:
contenu intégral du fichier, toutes les lignes
/:/:Dossier/Autre.php/:/:
contenu intégral du fichier, toutes les lignes`;

export function isAutoInterval(sec: number) {
  return sec === AUTO_INTERVAL || sec === 600;
}

export function isInterval(sec: number): boolean {
  return INTERVALS.some((item) => item.sec === sec) || sec === 600;
}

export function isModel(value: string): boolean {
  return MODELS.some((item) => item.id === value);
}
