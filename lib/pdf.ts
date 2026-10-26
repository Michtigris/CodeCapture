function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function pdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, 42);
}

export function photosToPdf(input: { intro: string; jpegs: Buffer[] }): Buffer {
  const images = input.jpegs
    .map((jpeg) => {
      const size = jpegSize(jpeg);
      if (!size || size.width < 1 || size.height < 1) return null;
      return { jpeg, ...size };
    })
    .filter((item): item is { jpeg: Buffer; width: number; height: number } => item !== null);
  if (!images.length) throw new Error("Aucune photo JPEG à mettre dans le PDF.");

  const pageW = 595;
  const pageH = 842;
  const imageCount = images.length;
  const objects = 5 + imageCount * 3;
  const offsets = new Array<number>(objects + 1).fill(0);
  const chunks: Buffer[] = [];
  let length = 0;
  const push = (part: string | Buffer) => {
    const buf = typeof part === "string" ? Buffer.from(part, "latin1") : part;
    chunks.push(buf);
    length += buf.length;
  };
  const obj = (id: number, body: string | Buffer) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n");
  const intro = wrap(
    input.intro.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\n\x20-\x7E]/g, " "),
    85,
  )
    .map((line, index) => `1 0 0 1 48 ${790 - index * 16} Tm (${pdfText(line)}) Tj`)
    .join("\n");
  const introStream = Buffer.from(`BT /F1 11 Tf\n${intro}\nET`, "latin1");
  const pageIds = [5];
  for (let index = 0; index < imageCount; index += 1) pageIds.push(8 + index * 3);
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");

  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  obj(
    4,
    Buffer.concat([
      Buffer.from(`<< /Length ${introStream.length} >>\nstream\n`, "latin1"),
      introStream,
      Buffer.from("\nendstream", "latin1"),
    ]),
  );
  obj(
    5,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>",
  );

  images.forEach((image, index) => {
    const imageId = 6 + index * 3;
    const contentId = 7 + index * 3;
    const pageId = 8 + index * 3;
    const maxW = pageW - 72;
    const maxH = pageH - 72;
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;
    const content = Buffer.from(`q\n${drawW} 0 0 ${drawH} ${x} ${y} cm\n/Im${index} Do\nQ`, "latin1");
    obj(
      imageId,
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`,
          "latin1",
        ),
        image.jpeg,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
    obj(
      contentId,
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"),
        content,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
    obj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
  });

  const xref = length;
  let table = `xref\n0 ${objects + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objects; id += 1) {
    table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  push(table);
  push(`trailer\n<< /Size ${objects + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return Buffer.concat(chunks);
}
