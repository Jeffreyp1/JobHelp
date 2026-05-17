import { describe, it, expect } from 'vitest';
import { tokenize } from '../../core/pipeline/tokenize.js';

describe('tokenize', () => {
  it('lowercases and splits on whitespace and punctuation', () => {
    const toks = tokenize('Hello, World! How are you?');
    expect(toks).toEqual(['hello', 'world', 'how', 'are', 'you']);
  });

  it('preserves domain tokens c++, c#, .net, node.js', () => {
    const toks = tokenize('We use C++, C#, .NET, and Node.js.');
    expect(toks).toContain('c++');
    expect(toks).toContain('c#');
    expect(toks).toContain('.net');
    expect(toks).toContain('node.js');
  });

  it('drops length-1 tokens', () => {
    const toks = tokenize('a b cd ef g');
    expect(toks).toEqual(['cd', 'ef']);
  });

  it('joins multi-word phrases with `_` when in phrase list', () => {
    const toks = tokenize('We use Amazon Web Services for hosting', ['amazon web services']);
    expect(toks).toContain('amazon_web_services');
    expect(toks).not.toContain('amazon');
    expect(toks).not.toContain('web');
  });

  it('keeps hyphenated word as one token: forward-deployed', () => {
    const toks = tokenize('forward-deployed engineer role');
    expect(toks).toContain('forward-deployed');
  });

  it('empty string yields empty array', () => {
    expect(tokenize('')).toEqual([]);
  });
});
