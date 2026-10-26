export async function sendResetEmail(to: string, link: string): Promise<void> {
  const key = process.env["RESEND_API_KEY"];
  if (!key) {
    throw new Error("L'envoi d'email n'est pas encore branché.");
  }
  const from = process.env["EMAIL_FROM"] || "CodeCapture <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Changer ton mot de passe CodeCapture",
      text: [
        "Tu as demandé à changer le mot de passe de ton compte CodeCapture.",
        "",
        "Ouvre ce lien dans l'heure qui vient :",
        link,
        "",
        "Si tu n'es pas à l'origine de cette demande, ignore cet email.",
      ].join("\n"),
    }),
  });
  if (!res.ok) {
    throw new Error("L'email n'a pas pu être envoyé. Réessaie dans un moment.");
  }
}
