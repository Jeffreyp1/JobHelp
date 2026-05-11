/**
 * Cost estimator card. Renders a small breakdown panel showing each enabled
 * step's estimated USD cost and the total.
 *
 * Driven by the CostEstimate produced by lib/costCalculator. Re-rendered each
 * time toggle state changes — the parent owns the update loop.
 */
import type { CostEstimate } from '../../lib/costCalculator.js';
import { formatCurrency } from '../../lib/tokenFormatter.js';

interface Row {
  key: keyof Omit<CostEstimate, 'total'>;
  label: string;
}

const ROWS: Row[] = [
  { key: 'generate', label: 'Generate' },
  { key: 'research', label: 'Research' },
  { key: 'benchmark', label: 'Benchmark' },
  { key: 'critique', label: 'Critique' },
  { key: 'autoRevise', label: 'Auto-revise' },
  { key: 'multiVersion', label: 'Multi-version' },
  { key: 'coverLetter', label: 'Cover letter' },
  { key: 'verifyHooks', label: 'Verify CL hooks' },
];

export function renderCostEstimator(cost: CostEstimate): HTMLElement {
  const card = document.createElement('section');
  card.className = 'cost-estimator';
  card.setAttribute('aria-label', 'Estimated cost');

  const heading = document.createElement('h3');
  heading.className = 'cost-estimator__title';
  heading.textContent = 'Estimated cost';
  card.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'cost-estimator__list';

  for (const row of ROWS) {
    const value = cost[row.key];
    if (!value || value <= 0) continue;
    const li = document.createElement('li');
    li.className = 'cost-estimator__row';
    const label = document.createElement('span');
    label.className = 'cost-estimator__label';
    label.textContent = row.label;
    const amount = document.createElement('span');
    amount.className = 'cost-estimator__amount';
    amount.textContent = formatCurrency(value);
    li.appendChild(label);
    li.appendChild(amount);
    list.appendChild(li);
  }
  card.appendChild(list);

  const totalRow = document.createElement('div');
  totalRow.className = 'cost-estimator__total';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'Total';
  const totalAmount = document.createElement('span');
  totalAmount.className = 'cost-estimator__total-amount';
  totalAmount.textContent = formatCurrency(cost.total);
  totalRow.appendChild(totalLabel);
  totalRow.appendChild(totalAmount);
  card.appendChild(totalRow);

  return card;
}
