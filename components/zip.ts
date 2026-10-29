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

function zipEntries(files: { path: Uint8Array; body: Uint8Array }[]): Blob {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const crc = crc32(file.body);
    const local = new DataView(new ArrayBuffer(30 + file.path.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, file.body.length, true);
    local.setUint32(22, file.body.length, true);
    local.setUint16(26, file.path.length, true);
    bytes(local).set(file.path, 30);
    locals.push(bytes(local), file.body);
    const head = new DataView(new ArrayBuffer(46 + file.path.length));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, file.body.length, true);
    head.setUint32(24, file.body.length, true);
    head.setUint16(28, file.path.length, true);
    head.setUint32(42, offset, true);
    bytes(head).set(file.path, 46);
    central.push(bytes(head));
    offset += 30 + file.path.length + file.body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...locals, ...central, bytes(end)] as BlobPart[], { type: "application/zip" });
}

export function zipFolder(folder: string, files: { name: string; text: string }[]): Blob {
  const encoder = new TextEncoder();
  return zipEntries(
    files.map((file) => ({
      path: encoder.encode(`${folder}/${file.name}`),
      body: encoder.encode(file.text.endsWith("\n") ? file.text : `${file.text}\n`),
    })),
  );
}

export function zipBlobs(files: { name: string; data: Uint8Array }[]): Blob {
  const encoder = new TextEncoder();
  return zipEntries(files.map((file) => ({ path: encoder.encode(file.name), body: file.data })));
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
