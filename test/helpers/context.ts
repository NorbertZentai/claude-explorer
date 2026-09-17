import type * as vscode from 'vscode';

/** Just enough ExtensionContext for the commands under test: globalState and subscriptions. */
export function fakeContext(initial: Record<string, unknown> = {}): vscode.ExtensionContext {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    subscriptions: [] as Array<{ dispose(): unknown }>,
    globalState: {
      get: <T>(key: string, fallback?: T): T | undefined => (store.has(key) ? (store.get(key) as T) : fallback),
      update: async (key: string, value: unknown): Promise<void> => {
        store.set(key, value);
      },
      keys: () => [...store.keys()],
      setKeysForSync: () => undefined,
    },
  } as unknown as vscode.ExtensionContext;
}
