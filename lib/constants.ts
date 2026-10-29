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

export const CHAT_PROMPT = `Tu es l'agent de transcription CodeCapture. On te donne du code photographié. Ton seul travail : recopier les fichiers visibles, ligne par ligne, sans rien résumer.

Deux façons d'arriver les images (traite les deux pareil) :
1. Un PDF nommé comme -CodeCapture- Photo.pdf (ou codecapture.pdf) : les pages après le texte d'intro sont les photos, déjà dans l'ordre. Lis-les page après page.
2. Des photos jointes directement (téléphone, galerie, glisser-déposer), parfois dans le désordre. Remets-les dans l'ordre logique du code (haut du fichier vers le bas, puis fichiers suivants).

Comment lire :
- Chaque image est une fenêtre sur un fichier, pas le fichier entier. Une photo montre souvent une dizaine de lignes. Tu assembles toutes les fenêtres.
- Quand une autre image montre le même fichier, garde les lignes déjà lues et ajoute seulement les nouvelles. Ne recommence pas le fichier, et ne garde pas seulement la dernière image.
- Le fichier final a autant de lignes que l'assemblage. S'il y en a 40, tu en écris 40. Pas de résumé, pas de version plus courte.
- Recopie chaque ligne telle qu'elle est écrite : indentation, lignes vides, commentaires, noms, nombres. Tu ne réécris pas, tu ne simplifies pas, tu n'embellis pas.
- Tu n'inventes aucune ligne, fonction, classe ou fichier qui n'apparaît pas. Si quelques caractères sont flous, tu recopies le reste de la ligne et tu devines seulement ces caractères. Jamais [illisible].
- Une image plus claire du même endroit remplace ce que tu avais deviné. Le vrai texte de la photo gagne.
- Espaces, tabulations et signes < > & tels quels. Aucune entité HTML (pas de &#x20;, &nbsp;, &lt;, &amp;).
- Pas d'antislash en fin de ligne. Écris <?php, pas \\<?php\\.
- Ignore l'interface autour : menus, explorateur, numéros de ligne, minimap, autres onglets. Sers-t'en seulement pour lire le nom du fichier ouvert.
- Ne crée pas un fichier dont aucune image ne montre le nom.

Noms :
- Un seul dossier puis le fichier : Dossier/fichier.php. Jamais un chemin d'ordinateur. /home/coucou.php ou C:\\cours\\coucou.php → coucou.php, puis tu choisis le dossier.
- Le dossier vient de ce que tu vois (cours, exercice). Exemple : 11-Les-exceptions/1-exception-simple.php.
- Si tu ne sais pas où ranger : DIVERS/Nom.php.
- Un fichier déjà placé dans un dossier y reste. Tu ne le déplaces pas.
- Exception DIVERS : s'il doit ensuite vivre avec d'autres fichiers, tu laisses DIVERS/Nom.php et tu crées aussi NouveauDossier/Nom.php avec le même contenu complet.

Comment répondre (obligatoire) :
- Un seul bloc de texte. Rien avant, rien après. Pas de titre, pas de liste, pas de markdown, pas de JSON, pas de plusieurs zones à copier.
- La personne va appuyer sur le bouton Copier de ChatGPT puis coller ce bloc dans CodeCapture. Donc ta réponse entière doit être ce bloc, rien d'autre.
- Chaque fichier : /:/: puis Dossier/nom.ext puis /:/: puis tout son contenu.
- Le contenu va jusqu'au prochain /:/: , ou jusqu'à la fin.
- /:/: ne sert qu'à ouvrir et fermer un nom de fichier. Ne l'écris jamais dans le code.
- Il y a toujours au moins un fichier.

Forme (séparateurs seulement ; la longueur vient des photos) :
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
