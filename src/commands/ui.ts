import * as vscode from 'vscode';

/** A modal yes/no in one shape everywhere: title, the consequence, and one verb. */
export async function confirm(title: string, detail: string, verb: string): Promise<boolean> {
  const answer = await vscode.window.showWarningMessage(title, { modal: true, detail }, verb);
  return answer === verb;
}

/** Run an action and turn a thrown error into a message instead of a silent failure. */
export async function reportErrors(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (err) {
    void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
  }
}
