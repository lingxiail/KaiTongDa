import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { readFileTool } from './fileTools';
import { extractPdfText } from '../helpers/toolHelpers';

vi.mock('../helpers/toolHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/toolHelpers')>();
  return {
    ...actual,
    extractPdfText: vi.fn(),
  };
});

// Regression coverage for the shell-injection fixes in the PDF branch of
// readFileTool. These tests prove the *interface contract* — the migrated
// call sites must dispatch to `run_argv_command` with the raw filePath as
// an argv element, never to `run_shell_command` with an interpolated
// command string. If anyone regresses this (e.g. by going back to
// `pdftotext "${filePath}" -`), these tests fail immediately.
//
// Verified-exploitable payloads (see T1 verification in the fix commit):
//   - `/tmp/x"; touch /tmp/PWN; y=".pdf`  — double-quote breakout
//   - `/tmp/x$(touch /tmp/PWN)y.pdf`       — command substitution
//   - `` /tmp/x`touch /tmp/PWN`y.pdf ``    — backtick substitution

const EVIL_PDF_QUOTE = '/tmp/x"; touch /tmp/ABU_PWN; y=".pdf';
const EVIL_PDF_DOLLAR = '/tmp/x$(touch /tmp/ABU_PWN)y.pdf';
const EVIL_PDF_BACKTICK = '/tmp/x`touch /tmp/ABU_PWN`y.pdf';

type InvokePayload = { program: string; args: string[]; timeout?: number };

function firstCall() {
  return vi.mocked(invoke).mock.calls[0] as unknown as [string, InvokePayload];
}

function nthCall(n: number) {
  return vi.mocked(invoke).mock.calls[n] as unknown as [string, InvokePayload];
}

describe('readFileTool — PDF shell injection regression', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(extractPdfText).mockReset();
    vi.mocked(extractPdfText).mockRejectedValue(new Error('pdfjs unavailable'));
  });

  it('PDF.js strategy: returns formatted text and skips native fallbacks', async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce('[PDF: /tmp/readable.pdf | Pages: 2]\n--- Page 1 ---\nhello\n--- Page 2 ---\nworld');

    const result = await readFileTool.execute({ path: '/tmp/readable.pdf' });

    expect(result).toContain('[PDF: /tmp/readable.pdf | Pages: 2]');
    expect(result).toContain('--- Page 1 ---');
    expect(result).toContain('--- Page 2 ---');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('pdftotext strategy: dispatches run_argv_command with filePath as a raw argv element', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      code: 0,
      stdout: 'extracted text',
      stderr: '',
    });

    const result = await readFileTool.execute({ path: EVIL_PDF_QUOTE });

    expect(result).toBe('extracted text');
    expect(invoke).toHaveBeenCalledTimes(1);

    const [cmdName, payload] = firstCall();
    expect(cmdName).toBe('run_argv_command');
    expect(payload.program).toBe('pdftotext');
    // Critical: the evil path is the first argv element, unescaped, untouched.
    expect(payload.args).toEqual([EVIL_PDF_QUOTE, '-']);
  });

  it('falls back to pdfplumber when pdftotext fails — still argv, still verbatim', async () => {
    // Strategy 1 (pdftotext) returns empty stdout → strategy 2 (pdfplumber) fires
    vi.mocked(invoke)
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'pdftotext not installed' })
      .mockResolvedValueOnce({ code: 0, stdout: 'plumber text', stderr: '' });

    const result = await readFileTool.execute({ path: EVIL_PDF_DOLLAR });

    expect(result).toBe('plumber text');
    expect(invoke).toHaveBeenCalledTimes(2);

    // First call: pdftotext with argv
    const [cmd1, payload1] = firstCall();
    expect(cmd1).toBe('run_argv_command');
    expect(payload1.program).toBe('pdftotext');
    expect(payload1.args).toEqual([EVIL_PDF_DOLLAR, '-']);

    // Second call: python3 with pdfplumber, file path is sys.argv[1]
    const [cmd2, payload2] = nthCall(1);
    expect(cmd2).toBe('run_argv_command');
    expect(payload2.program).toBe('python3');
    expect(payload2.args[0]).toBe('-c');
    // The Python source is the second element — it must NOT contain the
    // file path (that would mean string interpolation is back)
    expect(payload2.args[1]).not.toContain(EVIL_PDF_DOLLAR);
    expect(payload2.args[1]).not.toContain('$(');
    expect(payload2.args[1]).toContain('sys.argv[1]');
    // File path must be passed as a separate argv element
    expect(payload2.args[2]).toBe(EVIL_PDF_DOLLAR);
  });

  it('never dispatches run_shell_command when reading a PDF', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ code: 0, stdout: 'x', stderr: '' });
    await readFileTool.execute({ path: EVIL_PDF_BACKTICK });

    const shellCalls = vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === 'run_shell_command');
    expect(shellCalls).toHaveLength(0);
  });

  it('PDFPLUMBER_SCRIPT does not contain any shell metacharacter interpolation', async () => {
    // Observe the script by triggering the fallback branch
    vi.mocked(invoke)
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'ok', stderr: '' });

    await readFileTool.execute({ path: '/tmp/benign.pdf' });

    const [, payload] = nthCall(1);
    const script = payload.args[1];
    // Defensive: script must not contain template-literal escape holes
    expect(script).not.toContain('${');
    expect(script).not.toContain('$(');
    expect(script).not.toMatch(/`[^`]*`/);
    // Script must actually read from argv
    expect(script).toContain('sys.argv[1]');
  });

  it('returns an OCR hint when all text extraction strategies are empty', async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce('[PDF: /tmp/scanned.pdf | Pages: 1]\n--- Page 1 ---\n');
    vi.mocked(invoke)
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });

    const result = await readFileTool.execute({ path: '/tmp/scanned.pdf' });

    expect(result).toBe('Error: Cannot read PDF as text. This may be a scanned PDF and OCR is required; OCR is not supported by read_file.');
  });
});
