import { describe, it, expect } from 'vitest';
import { extractBlockedPath } from './recovery';

describe('sandbox recovery', () => {
  describe('extractBlockedPath', () => {
    it('extracts dest from cp command', () => {
      expect(extractBlockedPath('cp "/tmp/Hello world.docx" "/Users/didi/Desktop/Hello world.docx"'))
        .toBe('/Users/didi/Desktop');
    });

    it('extracts dest from mv command', () => {
      expect(extractBlockedPath('mv /tmp/output.pdf /Users/didi/Documents/output.pdf'))
        .toBe('/Users/didi/Documents');
    });

    it('extracts path from Python save()', () => {
      expect(extractBlockedPath("python3 -c \"doc.save('/Users/didi/Desktop/Hello world.docx')\""))
        .toBe('/Users/didi/Desktop');
    });

    it('extracts path from writeFileSync', () => {
      expect(extractBlockedPath("node -e \"fs.writeFileSync('/Users/didi/Desktop/doc.txt', 'hi')\""))
        .toBe('/Users/didi/Desktop');
    });

    it('extracts path from tee command', () => {
      expect(extractBlockedPath('echo hello | tee /Users/didi/Desktop/out.txt'))
        .toBe('/Users/didi/Desktop');
    });

    it('returns null for unrecognizable command', () => {
      expect(extractBlockedPath('ls -la /tmp')).toBeNull();
    });

    it('handles cp with flags', () => {
      expect(extractBlockedPath('cp -r /tmp/dir /Users/didi/Desktop/dir'))
        .toBe('/Users/didi/Desktop');
    });
  });
});
