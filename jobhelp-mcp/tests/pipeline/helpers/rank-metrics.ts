export interface TierRankRow {
  readonly id: string;
  readonly tier: number;
  readonly rank: number;
}

export function averageRanks(vals: readonly number[]): number[] {
  const n = vals.length;
  const sorted = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    const cur = sorted[i];
    if (cur === undefined) break;
    let j = i;
    while (j + 1 < n) {
      const next = sorted[j + 1];
      if (next === undefined || next.v !== cur.v) break;
      j++;
    }
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) {
      const entry = sorted[k];
      if (entry !== undefined) out[entry.i] = avg;
    }
    i = j + 1;
  }
  return out;
}

export function spearman(rows: readonly TierRankRow[]): number {
  const n = rows.length;
  const rx = averageRanks(rows.map((r) => r.tier));
  const ry = averageRanks(rows.map((r) => r.rank));
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const x = (rx[i] ?? 0) - mx;
    const y = (ry[i] ?? 0) - my;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  return num / Math.sqrt(dx * dy);
}

export function pairwiseAccuracy(rows: readonly TierRankRow[]): number {
  let ok = 0;
  let total = 0;
  for (const a of rows) {
    for (const b of rows) {
      if (a.tier < b.tier) {
        total++;
        if (a.rank < b.rank) ok++;
      }
    }
  }
  return ok / total;
}

export function hardViolations(rows: readonly TierRankRow[]): string[] {
  const out: string[] = [];
  for (const bad of rows.filter((r) => r.tier >= 4)) {
    for (const good of rows.filter((r) => r.tier <= 2)) {
      if (bad.rank < good.rank) {
        out.push(`${bad.id}(T${bad.tier})#${bad.rank} above ${good.id}(T${good.tier})#${good.rank}`);
      }
    }
  }
  return out;
}
