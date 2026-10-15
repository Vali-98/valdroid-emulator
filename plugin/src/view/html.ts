import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, bundle = 'webview'): string {
	const nonce = randomBytes(18).toString('base64');
	const resource = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', name));
	const csp = `default-src 'none'; img-src http://127.0.0.1:* data: blob:; connect-src http://127.0.0.1:* ws://127.0.0.1:*; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval';`;
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${resource(`${bundle}.css`)}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${resource(`${bundle}.js`)}"></script>
</body>
</html>`;
}
