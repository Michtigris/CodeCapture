import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <div className="wrap">
        <h1 className="display">Page introuvable</h1>
        <Link href="/">Retour à CodeCapture</Link>
      </div>
    </main>
  );
}
