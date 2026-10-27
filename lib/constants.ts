export const INTERVALS = [
  { sec: 15, label: "15 secondes" },
  { sec: 30, label: "30 secondes" },
  { sec: 60, label: "1 minute" },
  { sec: 120, label: "2 minutes" },
  { sec: 300, label: "5 minutes" },
  { sec: 600, label: "10 minutes" },
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
- Le nom du fichier est celui qui est affiché : onglet, titre ou chemin, dossiers inclus. Exemple : B2/POO/Animal.php. Ne raccourcis pas le chemin et n'invente pas un nom.
- Plusieurs photos du même fichier deviennent un seul fichier. Fusionne-les du haut du fichier vers la suite. Ne recommence pas le fichier à chaque photo.
- Recopie le code tel quel : indentation, lignes vides, commentaires, fautes. N'améliore rien et n'invente aucune ligne.
- Écris les espaces, tabulations et signes < > & tels quels. N'utilise aucune entité HTML : pas de &#x20;, &nbsp;, &lt; ou &amp;.
- Un morceau illisible s'écrit [illisible], à la place du morceau seulement. Ne le devine pas.
- Ignore l'interface autour du fichier : navigateur, menus, explorateur, numéros de ligne, minimap, autres onglets. Sers-t'en seulement pour lire le nom du fichier ouvert.
- N'ajoute pas un fichier qui n'est pas visible.

Comment répondre :
- Réponds par un seul bloc de texte. Pas de phrase avant, pas de phrase après, pas de titre, pas de liste, pas de plusieurs zones à copier, pas de balises markdown.
- Chaque fichier commence par /:/: puis son chemin complet, puis /:/:, puis son contenu.
- Le contenu va jusqu'au prochain /:/: , ou jusqu'à la fin s'il n'y a plus de fichier.
- S'il y a un autre fichier, enchaîne tout de suite avec /:/: puis son chemin, puis /:/:, puis son contenu.
- La suite de caractères /:/: ne sert qu'à ouvrir un chemin et à le fermer. Ne l'écris nulle part dans le code.
- Il y a toujours au moins un fichier.

Forme exacte, ici avec deux fichiers :
/:/:B2/POO/Animal.php/:/:
<?php
class Animal {}
/:/:B2/POO/index.html/:/:
<h1>Bonjour</h1>`;

export function isInterval(sec: number): boolean {
  return INTERVALS.some((item) => item.sec === sec);
}

export function isModel(value: string): boolean {
  return MODELS.some((item) => item.id === value);
}
