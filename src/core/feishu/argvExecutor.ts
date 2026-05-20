import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isWindows } from '../../utils/platform';
import type { FeishuCommandRawResult } from './connectorAdapter';

interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number;
}

interface CommandOutputLine {
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface ArgvCommand {
  program: string;
  args: string[];
  command: string;
}

function getProgramName(program: string): string {
  return program.split(/[\\/]/).pop()?.toLowerCase() ?? program.toLowerCase();
}

export function formatArgvCommand(program: string, args: string[]): string {
  return [program, ...args].join(' ').trim();
}

export function buildArgvCommand(program: string, args: string[]): ArgvCommand {
  return {
    program,
    args,
    command: formatArgvCommand(program, args),
  };
}

export function buildArgvInvocation(program: string, args: string[]): { program: string; args: string[] } {
  const programName = getProgramName(program);
  if (isWindows() && (programName === 'npx' || programName === 'npx.cmd' || programName === 'npm' || programName === 'npm.cmd')) {
    return {
      program: 'cmd.exe',
      args: ['/D', '/C', program, ...args],
    };
  }
  return { program, args };
}

export async function runArgvCommand(command: ArgvCommand, timeout = 60): Promise<FeishuCommandRawResult> {
  const invocation = buildArgvInvocation(command.program, command.args);
  const output = await invoke<CommandOutput>('run_argv_command', {
    program: invocation.program,
    args: invocation.args,
    cwd: null,
    timeout,
    sandboxEnabled: false,
    networkIsolation: false,
  });
  return {
    command: command.command,
    stdout: output.stdout,
    stderr: output.stderr,
    code: output.code,
  };
}

function generateEventId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function runArgvCommandStreaming(
  command: ArgvCommand,
  timeout = 240,
  onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<FeishuCommandRawResult> {
  const invocation = buildArgvInvocation(command.program, command.args);
  const eventId = generateEventId();
  const eventName = `abu://command-output-${eventId}`;
  const unlisten = await listen<CommandOutputLine>(eventName, (event) => {
    onOutput?.(event.payload.line, event.payload.stream);
  });

  try {
    const output = await invoke<CommandOutput>('run_argv_command_streaming', {
      program: invocation.program,
      args: invocation.args,
      cwd: null,
      timeout,
      eventId,
      sandboxEnabled: false,
      networkIsolation: false,
    });
    return {
      command: command.command,
      stdout: output.stdout,
      stderr: output.stderr,
      code: output.code,
    };
  } finally {
    await unlisten();
  }
}
