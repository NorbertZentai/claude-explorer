import { spawn } from 'child_process';

/**
 * Start a stdio MCP server, ask it for its tools, and stop it. The only place this
 * extension starts a process, and only after the user confirms.
 *
 * Protocol: newline-delimited JSON-RPC 2.0 over stdin/stdout -- `initialize`, the
 * `notifications/initialized` notification, then `tools/list`, following `nextCursor`.
 */

export interface ProbeTool {
  name: string;
  description?: string;
}

export interface ProbeResult {
  serverName?: string;
  serverVersion?: string;
  tools: ProbeTool[];
  /** Length of the tool definitions as JSON, the basis of the token estimate. */
  chars: number;
}

export interface ProbeOptions {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
  /** Aborts the probe and kills the server. */
  signal?: AbortSignal;
}

export class ProbeError extends Error {
  constructor(
    message: string,
    /** The last lines the server wrote to stderr. Not redacted: callers must. */
    readonly stderrTail: string,
    readonly exitCode?: number | null,
  ) {
    super(message);
  }
}

const PROTOCOL_VERSION = '2025-06-18';

export function probeStdioServer(options: ProbeOptions): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // `npx` is `npx.cmd` on Windows, which only a shell resolves.
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let nextId = 1;
    let settled = false;
    const pending = new Map<number, (message: RpcResponse) => void>();

    const finish = (error: ProbeError | undefined, result?: ProbeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      child.stdin.end();
      child.kill();
      if (error) {
        reject(error);
      } else {
        resolve(result!);
      }
    };
    const tail = (): string => stderr.trim().split('\n').slice(-5).join('\n');

    const timer = setTimeout(
      () => finish(new ProbeError(`No answer within ${Math.round((options.timeoutMs ?? 20000) / 1000)} seconds.`, tail())),
      options.timeoutMs ?? 20000,
    );
    const onAbort = (): void => finish(new ProbeError('Cancelled.', tail()));
    options.signal?.addEventListener('abort', onAbort);

    // Writing to a server that already exited raises EPIPE here; the exit handler reports it.
    child.stdin.on('error', () => undefined);
    child.on('error', (err) => finish(new ProbeError(`Could not start "${options.command}": ${err.message}`, tail())));
    child.on('exit', (code) => finish(new ProbeError(`The server exited (code ${code ?? 'unknown'}) before listing its tools.`, tail(), code)));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      let newline: number;
      while ((newline = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) {
          continue;
        }
        let message: RpcResponse;
        try {
          message = JSON.parse(line) as RpcResponse;
        } catch {
          continue; // servers sometimes log to stdout; skip anything that is not JSON
        }
        if (typeof message.id === 'number' && pending.has(message.id)) {
          const handler = pending.get(message.id)!;
          pending.delete(message.id);
          handler(message);
        }
      }
    });

    const request = (method: string, params: unknown): Promise<RpcResponse> =>
      new Promise((done) => {
        const id = nextId++;
        pending.set(id, done);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });

    void (async () => {
      const init = await request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'explorer-for-claude-code', version: '0.1.0' },
      });
      if (init.error) {
        return finish(new ProbeError(`initialize failed: ${init.error.message ?? 'unknown error'}`, tail()));
      }
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

      const tools: unknown[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 50; page++) {
        const response = await request('tools/list', cursor ? { cursor } : {});
        if (response.error) {
          return finish(new ProbeError(`tools/list failed: ${response.error.message ?? 'unknown error'}`, tail()));
        }
        const result = response.result as { tools?: unknown[]; nextCursor?: string } | undefined;
        tools.push(...(result?.tools ?? []));
        cursor = result?.nextCursor;
        if (!cursor) {
          break;
        }
      }
      const info = (init.result as { serverInfo?: { name?: string; version?: string } } | undefined)?.serverInfo;
      finish(undefined, {
        serverName: info?.name,
        serverVersion: info?.version,
        tools: tools.map((t) => {
          const tool = t as { name?: unknown; description?: unknown };
          return {
            name: typeof tool.name === 'string' ? tool.name : '(unnamed)',
            description: typeof tool.description === 'string' ? tool.description : undefined,
          };
        }),
        chars: JSON.stringify(tools).length,
      });
    })();
  });
}

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}
