export function QrMark({ path, label }: { path: string; label: string }) {
  const src = `/api/qr?path=${encodeURIComponent(path)}`;
  return <img className="qr-mark" src={src} alt={label} />;
}
