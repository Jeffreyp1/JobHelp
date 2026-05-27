export type AlignedOp =
  | { readonly kind: 'equal'; readonly text: string; readonly prevIndex: number }
  | { readonly kind: 'remove'; readonly text: string; readonly prevIndex: number }
  | { readonly kind: 'add'; readonly text: string };

export function alignLineDiff(a: readonly string[], b: readonly string[]): AlignedOp[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: AlignedOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', text: a[i] ?? '', prevIndex: i });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: 'remove', text: a[i] ?? '', prevIndex: i });
      i += 1;
    } else {
      ops.push({ kind: 'add', text: b[j] ?? '' });
      j += 1;
    }
  }
  while (i < m) {
    ops.push({ kind: 'remove', text: a[i] ?? '', prevIndex: i });
    i += 1;
  }
  while (j < n) {
    ops.push({ kind: 'add', text: b[j] ?? '' });
    j += 1;
  }
  return ops;
}
