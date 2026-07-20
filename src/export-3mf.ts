// Optional module: writes a multi-color .3mf from N separately-rendered OFF
// parts, for projects that render one part per color pass (multi-material /
// AMS-style prints) and want a single file instead of N STLs the user would
// have to reposition by hand.
//
// Uses the 3MF *Materials and Properties Extension*'s <m:colorgroup>/
// <m:color> rather than the core-spec <basematerials> element that
// OpenSCAD's own 3MF exporter emits: Bambu Studio (and this was verified
// against real slicer behavior, not just spec-reading) doesn't treat
// <basematerials> as multi-color data — it silently imports one flat,
// uncolored object. <m:colorgroup> is structurally identical (same pid/p1
// triangle references, just pointing at a colorgroup resource instead of a
// basematerials one) and Bambu Studio/OrcaSlicer/PrusaSlicer all read it
// correctly.
import { offToIndexedMesh } from './off-utils.js';

export interface ColoredPart {
  off: string;
  /** e.g. "#DCDCDC" — a 6-digit hex color, no alpha. */
  colorHex: string;
}

interface ZipFile {
  name: string;
  data: Uint8Array;
}

// Minimal STORE-method (uncompressed) ZIP writer — a .3mf just needs a valid
// OPC zip container, and STORE sidesteps pulling in a DEFLATE implementation
// for a handful of small XML files.
let crc32Table: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crc32Table) {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    crc32Table = t;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = crc32Table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZipStore(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const size = data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true); // method: 0 = store
    local.setUint16(10, 0, true);
    local.setUint16(12, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    localChunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centralChunks.push(new Uint8Array(central.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const centralStart = offset;
  const centralSize = centralChunks.reduce((a, c) => a + c.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);
  end.setUint16(20, 0, true);

  const allChunks = [...localChunks, ...centralChunks, new Uint8Array(end.buffer)];
  const out = new Uint8Array(allChunks.reduce((a, c) => a + c.length, 0));
  let pos = 0;
  for (const c of allChunks) { out.set(c, pos); pos += c.length; }
  return out;
}

export function buildMultiColor3mf(parts: ColoredPart[]): Uint8Array {
  const meshes = parts.map((p) => offToIndexedMesh(p.off));

  let vOffset = 0;
  const vertices: number[][] = [];
  const triangles: number[][] = [];
  meshes.forEach((mesh, partIndex) => {
    if (!mesh) return;
    vertices.push(...mesh.vertices);
    for (const [a, b, c] of mesh.triangles) {
      triangles.push([a + vOffset, b + vOffset, c + vOffset, partIndex]);
    }
    vOffset += mesh.vertices.length;
  });

  const vertexXml = vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('\n');
  const triXml = triangles.map(([a, b, c, m]) => `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${m}"/>`).join('\n');
  const colorXml = parts.map((p) => `<m:color color="${p.colorHex}FF"/>`).join('');

  const modelXml = `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ` +
    `xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" unit="millimeter">\n` +
    `<resources><m:colorgroup id="1">${colorXml}</m:colorgroup>` +
    `<object id="2" type="model" pid="1" pindex="0"><mesh>` +
    `<vertices>${vertexXml}</vertices><triangles>${triXml}</triangles>` +
    `</mesh></object></resources>` +
    `<build><item objectid="2"/></build></model>`;

  const contentTypes = `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `</Types>`;

  const rels = `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" Id="rel0"/>` +
    `</Relationships>`;

  const enc = new TextEncoder();
  return buildZipStore([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(modelXml) },
  ]);
}

export function downloadMultiColor3mf(parts: ColoredPart[], filename: string): void {
  const bytes = buildMultiColor3mf(parts);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/3mf' }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
