import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('merges conditional classes', () => {
    const includeB = false;
    expect(cn('a', includeB && 'b', 'c')).toBe('a c');
    expect(cn('a', undefined, 'c')).toBe('a c');
  });
});
