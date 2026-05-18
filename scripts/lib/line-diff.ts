export interface DiffRegion {
  kind: 'equal' | 'change';
  removed: string[];
  added: string[];
}

export type AlignedOp =
  | { kind: 'equal'; text: string; prevIndex: number; nextIndex: number }
  | { kind: 'remove'; text: string; prevIndex: number }
  | { kind: 'add'; text: string; nextIndex: number };

export function lineDiff(a: string[], b: string[]): DiffRegion[] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const regions: DiffRegion[] = [];
  let i = 0, j = 0;
  let cur: DiffRegion | null = null;
  const flush = () => { if (cur) { regions.push(cur); cur = null; } };
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      if (cur?.kind !== 'equal') { flush(); cur = { kind: 'equal', removed: [], added: [] }; }
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      if (cur?.kind !== 'change') { flush(); cur = { kind: 'change', removed: [], added: [] }; }
      cur.removed.push(a[i]); i++;
    } else {
      if (cur?.kind !== 'change') { flush(); cur = { kind: 'change', removed: [], added: [] }; }
      cur.added.push(b[j]); j++;
    }
  }
  while (i < m) {
    if (cur?.kind !== 'change') { flush(); cur = { kind: 'change', removed: [], added: [] }; }
    cur.removed.push(a[i]); i++;
  }
  while (j < n) {
    if (cur?.kind !== 'change') { flush(); cur = { kind: 'change', removed: [], added: [] }; }
    cur.added.push(b[j]); j++;
  }
  flush();
  return regions;
}

export function alignLineDiff(a: string[], b: string[]): AlignedOp[] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: AlignedOp[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', text: a[i], prevIndex: i, nextIndex: j });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'remove', text: a[i], prevIndex: i });
      i++;
    } else {
      ops.push({ kind: 'add', text: b[j], nextIndex: j });
      j++;
    }
  }
  while (i < m) { ops.push({ kind: 'remove', text: a[i], prevIndex: i }); i++; }
  while (j < n) { ops.push({ kind: 'add', text: b[j], nextIndex: j }); j++; }
  return ops;
}
