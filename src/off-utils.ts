// Parsing for OpenSCAD's native OFF/COFF mesh export format. Used both by the
// live Three.js preview (flat triangle positions) and by STL/3MF export
// (indexed mesh). Coordinates stay in OpenSCAD's native Z-up frame — callers
// rotate for display only, never for export.

export interface IndexedMesh {
  vertices: number[][];
  triangles: number[][];
}

function parseOffHeader(lines: string[]): { i: number; nv: number; nf: number } | null {
  let i = 0;
  const hm = lines[i].match(/^C?OFF\s*(.*)/);
  if (!hm) return null;
  let countStr = hm[1].trim();
  i++;
  if (!countStr) countStr = lines[i++];
  const [nv, nf] = countStr.split(/\s+/).map(Number);
  if (!nv || !nf) return null;
  return { i, nv, nf };
}

// Flat [x,y,z, x,y,z, ...] per-triangle-corner position list, fan-triangulating
// any n-gon faces. Suitable for a non-indexed THREE.BufferGeometry or for
// writing directly to STL.
export function offToTrianglePositions(offText: string): number[] | null {
  const lines = offText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const header = parseOffHeader(lines);
  if (!header) return null;
  let { i, nv, nf } = header;

  const verts: number[] = [];
  for (let j = 0; j < nv; j++) {
    const p = lines[i++].split(/\s+/).map(Number);
    verts.push(p[0], p[1], p[2]);
  }

  const positions: number[] = [];
  for (let j = 0; j < nf; j++) {
    const p = lines[i++].split(/\s+/).map(Number);
    const n = p[0];
    const fv = p.slice(1, n + 1);
    for (let k = 1; k < fv.length - 1; k++) {
      for (const vi of [fv[0], fv[k], fv[k + 1]]) {
        const b = vi * 3;
        positions.push(verts[b], verts[b + 1], verts[b + 2]);
      }
    }
  }
  return positions;
}

// { vertices: [[x,y,z], ...], triangles: [[a,b,c], ...] } — needed for
// writing an indexed mesh into a .3mf <mesh> element.
export function offToIndexedMesh(offText: string): IndexedMesh | null {
  const lines = offText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const header = parseOffHeader(lines);
  if (!header) return null;
  let { i, nv, nf } = header;

  const vertices: number[][] = [];
  for (let j = 0; j < nv; j++) {
    vertices.push(lines[i++].split(/\s+/).map(Number).slice(0, 3));
  }

  const triangles: number[][] = [];
  for (let j = 0; j < nf; j++) {
    const p = lines[i++].split(/\s+/).map(Number);
    const n = p[0];
    const fv = p.slice(1, n + 1);
    for (let k = 1; k < fv.length - 1; k++) triangles.push([fv[0], fv[k], fv[k + 1]]);
  }
  return { vertices, triangles };
}
