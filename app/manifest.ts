import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CodeCapture",
    short_name: "CodeCapture",
    description: "Photographie du code, récupère les fichiers.",
    start_url: "/groupes",
    display: "standalone",
    background_color: "#0e0f0c",
    theme_color: "#0e0f0c",
    lang: "fr",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
