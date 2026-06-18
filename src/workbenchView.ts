/**
 * workbenchView.ts — the Markr Workbench launcher (sidebar webview view).
 *
 * A compact button grid pinned at the top of the Markr sidebar that launches
 * every workbench tool (Agent Map, Config Lab, Config Health, Context Bridge,
 * Scoreboard, …). Read-only glue: a tile click runs the matching command, or
 * focuses a view for 'focus:<viewId>'. The HTML is set once and never reloaded.
 */
import * as vscode from 'vscode';
import { buildWorkbenchHtml } from './webview/workbenchHtml';

export class WorkbenchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'markrWorkbench';

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = buildWorkbenchHtml();
    webviewView.webview.onDidReceiveMessage((msg: Record<string, unknown>) => {
      if (msg.type !== 'cmd' || typeof msg.id !== 'string') return;
      if (msg.id.startsWith('focus:')) {
        vscode.commands.executeCommand(`${msg.id.slice('focus:'.length)}.focus`);
      } else {
        vscode.commands.executeCommand(msg.id);
      }
    });
  }
}
