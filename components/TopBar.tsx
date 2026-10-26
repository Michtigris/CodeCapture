"use client";

import Link from "next/link";
import { dropSession } from "./keepSession";
import { Mark } from "./Mark";

export function TopBar({ name }: { name?: string }) {
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
        <button type="button" onClick={logout}>
          Déconnexion
        </button>
      </div>
    </header>
  );
}
