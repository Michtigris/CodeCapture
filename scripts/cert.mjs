import fs from "fs";
import os from "os";
import path from "path";
import selfsigned from "selfsigned";

const dir = path.join(process.cwd(), "certs");
fs.mkdirSync(dir, { recursive: true });

const altNames = [
  { type: 2, value: "localhost" },
  { type: 7, ip: "127.0.0.1" },
];

for (const list of Object.values(os.networkInterfaces())) {
  for (const net of list ?? []) {
    const family = String(net.family);
    if (family === "IPv4" || family === "4") {
      altNames.push({ type: 7, ip: net.address });
    }
  }
}

const pems = await selfsigned.generate([{ name: "commonName", value: "CodeCapture" }], {
  days: 365,
  keySize: 2048,
  algorithm: "sha256",
  extensions: [{ name: "subjectAltName", altNames }],
});

fs.writeFileSync(path.join(dir, "dev-key.pem"), pems.private);
fs.writeFileSync(path.join(dir, "dev-cert.pem"), pems.cert);
console.log("Certificat écrit dans certs/. Lance ensuite : npm run dev:https");
