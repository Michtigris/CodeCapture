function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc ^= data[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer);
}

export function zipFolder(folder: string, files: { name: string; text: string }[]): Blob {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const path = encoder.encode(`${folder}/${file.name}`);
    const body = encoder.encode(file.text.endsWith("\n") ? file.text : `${file.text}\n`);
    const crc = crc32(body);
    const local = new DataView(new ArrayBuffer(30 + path.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, body.length, true);
    local.setUint16(26, path.length, true);
    bytes(local).set(path, 30);
    locals.push(bytes(local), body);
    const head = new DataView(new ArrayBuffer(46 + path.length));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, body.length, true);
    head.setUint32(24, body.length, true);
    head.setUint16(28, path.length, true);
    head.setUint32(42, offset, true);
    bytes(head).set(path, 46);
    central.push(bytes(head));
    offset += 30 + path.length + body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...central, bytes(end)] as BlobPart[];
  return new Blob(parts, { type: "application/zip" });
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
