import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreate = vi.fn();

// Mock OpenAI before importing judge
vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.responses = { create: mockCreate };
    }
  },
}));

const { judgeCastles } = await import('../lib/judge.js');

describe('judgeCastles', () => {
  const fakePng = Buffer.from('fake-png-data');

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    mockCreate.mockReset();
  });

  it('returns tie when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await judgeCastles(fakePng, fakePng);
    expect(result.winner).toBe('tie');
    expect(result.reasoning).toContain('OPENAI_API_KEY');
  });

  it('returns parsed result on successful API call', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValue({
      output_text: '{"winner":"player1","reasoning":"More creative design"}',
    });

    const result = await judgeCastles(fakePng, fakePng);
    expect(result.winner).toBe('player1');
    expect(result.reasoning).toBe('More creative design');
  });

  it('returns tie on API error', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockCreate.mockRejectedValue(new Error('API down'));

    const result = await judgeCastles(fakePng, fakePng);
    expect(result.winner).toBe('tie');
    expect(result.reasoning).toContain('API down');
  });

  it('returns tie when winner value is invalid', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValue({
      output_text: '{"winner":"nobody","reasoning":"Both are bad"}',
    });

    const result = await judgeCastles(fakePng, fakePng);
    expect(result.winner).toBe('tie');
    expect(result.reasoning).toContain('Invalid winner');
  });

  it('handles malformed JSON gracefully', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValue({
      output_text: 'not json at all',
    });

    const result = await judgeCastles(fakePng, fakePng);
    expect(result.winner).toBe('tie');
    expect(result.reasoning).toContain('Judge error');
  });
});
