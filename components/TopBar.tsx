"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dropSession } from "./keepSession";
import { Mark } from "./Mark";

export function TopBar({ name }: { name?: string }) {
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    if (!ask) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setAsk(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask]);

  async function logout() {
    dropSession();
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/";
  }

  return (
    <header className="topbar">
      <Link href="/groupes" className="brand-lockup">
        <Mark />
        CodeCapture
      </Link>
      <div className="top-actions">
        {name ? <span className="who">{name}</span> : null}
        <Link href="/groupes">Groupes</Link>
        <Link href="/reglages">Réglages</Link>
        <button type="button" onClick={() => setAsk(true)}>
          Déconnexion
        </button>
      </div>
      {ask ? (
        <div
          className="qr-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-title"
          onClick={() => setAsk(false)}
        >
          <div className="ask" onClick={(event) => event.stopPropagation()}>
            <i className="tick tl" />
            <i className="tick tr" />
            <i className="tick bl" />
            <i className="tick br" />
            <p id="logout-title">Se déconnecter ?</p>
            <div className="row">
              <button type="button" className="cp-line" autoFocus onClick={() => setAsk(false)}>
                Annuler
              </button>
              <button type="button" className="cp" onClick={() => void logout()}>
                Déconnexion
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
