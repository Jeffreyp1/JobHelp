import { describe, it, expect, beforeAll } from 'vitest';
import { loadSkillsDict, findSkillsInText, SkillMatch } from '../../src/lib/skillsDict';

let dict: Map<string, string>;

describe('skillsDict', () => {
  beforeAll(async () => {
    dict = await loadSkillsDict();
  });

  it('T1: loadSkillsDict returns a Map with at least 3000 entries', () => {
    expect(dict.size).toBeGreaterThanOrEqual(3000);
  });

  it('T2: findSkillsInText finds obvious skills', () => {
    const result = findSkillsInText('Looking for a senior Python developer with React and AWS experience', dict);
    const canonical = result.map(s => s.canonical.toLowerCase());
    expect(canonical).toContain('python');
    expect(canonical).toContain('react');
    expect(canonical).toContain('aws');
  });

  it('T3: findSkillsInText returns canonical form (deduplicates synonyms)', () => {
    const result = findSkillsInText('I love React.js and React and ReactJS', dict);
    const reactMatches = result.filter(s => s.canonical.toLowerCase() === 'react');
    expect(reactMatches.length).toBe(1);
  });

  it('T4: findSkillsInText counts deduplicated occurrences', () => {
    const result = findSkillsInText('Python, python, PYTHON, python3', dict);
    const py = result.find(s => s.canonical.toLowerCase() === 'python');
    expect(py?.count).toBeGreaterThanOrEqual(2);
  });

  it('T5: findSkillsInText completes <100ms for 5KB JD', () => {
    const longJD = 'Senior Engineer with Python, Java, React, AWS, Kubernetes. '.repeat(150);
    const start = performance.now();
    findSkillsInText(longJD, dict);
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(100);
  });

  it('T6: findSkillsInText returns empty for skill-free text', () => {
    const result = findSkillsInText('the quick brown fox jumps over the lazy dog', dict);
    expect(result.length).toBe(0);
  });
});
