// ASCII STL writer, one "solid" per triangle-position list. Normals are
// computed (not left zeroed) since some slicers use them for orientation
// sanity checks.
export function trianglesToStl(positions: number[], name = 'model'): string {
  const lines = [`solid ${name}`];
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(i, i + 9);
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    lines.push(
      `facet normal ${nx} ${ny} ${nz}`,
      'outer loop',
      `vertex ${ax} ${ay} ${az}`,
      `vertex ${bx} ${by} ${bz}`,
      `vertex ${cx} ${cy} ${cz}`,
      'endloop',
      'endfacet',
    );
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}

// Triggers a browser download of an ASCII-STL Blob built from a flat
// triangle-position list (as returned by offToTrianglePositions).
export function downloadStl(positions: number[], filename: string): void {
  const stl = trianglesToStl(positions, filename.replace(/\.stl$/i, ''));
  const url = URL.createObjectURL(new Blob([stl], { type: 'model/stl' }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
