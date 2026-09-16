import * as vscode from 'vscode';

/**
 * Open a JSON settings file (creating `{}` when it does not exist yet), let `compute`
 * produce the new text, and apply it as a WorkspaceEdit so it behaves like any other edit:
 * visible in the editor if open, and undoable with Cmd+Z. `compute` throws to refuse.
 */
export async function applyJsonEdit(file: string, compute: (text: string) => string): Promise<boolean> {
  const uri = vscode.Uri.file(file);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    await vscode.workspace.fs.writeFile(uri, Buffer.from('{}\n', 'utf8'));
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const original = doc.getText();
  const text = compute(original);
  if (text === original) {
    return false;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(original.length)), text);
  if (!(await vscode.workspace.applyEdit(edit)) || !(await doc.save())) {
    throw new Error(`Could not save ${file}.`);
  }
  return true;
}
