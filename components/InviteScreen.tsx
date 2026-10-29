import Link from "next/link";
import type { GroupInvitePreview } from "@/lib/store";
import { Mark } from "./Mark";

type Props = {
  invite: GroupInvitePreview | null;
  code: string;
};

function whenFr(iso: string) {
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) return "";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(stamp);
}

export function InviteScreen({ invite, code }: Props) {
  const next = `/${(invite?.code || code).toUpperCase()}`;
  const loginHref = `/?next=${encodeURIComponent(next)}`;
  const registerHref = `/?next=${encodeURIComponent(next)}&mode=register`;

  if (!invite) {
    return (
      <main className="invite-cyber">
        <div className="invite-fx" aria-hidden="true">
          <div className="invite-grid" />
          <div className="invite-scan" />
          <div className="invite-glow" />
        </div>
        <p className="landing-brand invite-brand">
          <Mark />
          CodeCapture
        </p>
        <section className="invite-panel shard">
          <i className="tick tl" />
          <i className="tick tr" />
          <i className="tick bl" />
          <i className="tick br" />
          <p className="kicker">Signal perdu</p>
          <h1>Lien introuvable</h1>
          <p className="lede">
            Ce code ne correspond à aucun groupe. Vérifie le lien, ou demande un nouveau QR au créateur.
          </p>
          <div className="invite-actions">
            <Link className="lime" href="/">
              Aller à CodeCapture
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const created = whenFr(invite.createdAt);
  const online = invite.memberOnline;
  const total = invite.memberCount;

  return (
    <main className="invite-cyber">
      <div className="invite-fx" aria-hidden="true">
        <div className="invite-grid" />
        <div className="invite-scan" />
        <div className="invite-glow" />
        <p className="invite-watermark">{invite.code}</p>
      </div>
      <p className="landing-brand invite-brand">
        <Mark />
        CodeCapture
      </p>
      <section className="invite-panel shard">
        <i className="tick tl" />
        <i className="tick tr" />
        <i className="tick bl" />
        <i className="tick br" />
        <div className="invite-rail">
          <p className="kicker">Invitation · accès groupe</p>
          <span className={["invite-live", online > 0 ? "on" : ""].filter(Boolean).join(" ")}>
            <i />
            {online > 0 ? "Canal actif" : "Canal en veille"}
          </span>
        </div>
        <h1>{invite.name}</h1>
        <p className="lede">
          Connecte-toi ou crée un compte : le groupe s’ajoute à ta liste, et tu arrives directement dedans.
        </p>
        <div className="invite-code-block" aria-label={`Code ${invite.code}`}>
          <span>CODE</span>
          <strong className="group-code">{invite.code}</strong>
        </div>
        <dl className="invite-facts">
          <div>
            <dt>Créé par</dt>
            <dd className="invite-creator">{invite.creatorName}</dd>
          </div>
          <div>
            <dt>Membres</dt>
            <dd>
              <span className="invite-ratio">
                {online}/{total}
              </span>
              <span className="invite-ratio-hint">connectés / connus</span>
            </dd>
          </div>
          {created ? (
            <div>
              <dt>Depuis</dt>
              <dd>{created}</dd>
            </div>
          ) : null}
          <div>
            <dt>Statut</dt>
            <dd>{online > 0 ? `${online} en ligne maintenant` : "Personne en ligne pour l’instant"}</dd>
          </div>
        </dl>
        <div className="invite-actions">
          <Link className="lime" href={loginHref}>
            Se connecter
          </Link>
          <Link className="ghost" href={registerHref}>
            Créer un compte
          </Link>
        </div>
      </section>
    </main>
  );
}
