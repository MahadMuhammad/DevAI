import * as vscode from "vscode";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  const provider = new DevAIChatProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DevAIChatProvider.viewType,
      provider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(DevAIChatProvider.viewType, () => {
      const message = "Chat panel opened";
      vscode.window.showInformationMessage(message);
    })
  );

  let openWebView = vscode.commands.registerCommand("chat.refresh", () => {
    vscode.window.showInformationMessage('Command "Refresh" called.');
  });

  context.subscriptions.push(openWebView);

  context.subscriptions.push(
    vscode.commands.registerCommand("chat.refreshEntry", () =>
      provider.refresh()
    )
  );

  console.log("Extension activated");

  const disposable = vscode.commands.registerCommand("chat.helloWorld", () => {
    vscode.window.showInformationMessage("Hello World from chat!");
  });

  context.subscriptions.push(disposable);

  // Command to handle /fix
  context.subscriptions.push(
    vscode.commands.registerCommand("chat.fix", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor found");
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText) {
        vscode.window.showErrorMessage("No text selected");
        return;
      }

      // Send selected text to webview
      provider.sendSelectedCodeToWebview(selectedText, "/fix");
    })
  );

  // Command to handle /explain
  context.subscriptions.push(
    vscode.commands.registerCommand("chat.explain", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor found");
        return;
      }
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      if (!selectedText) {
        vscode.window.showErrorMessage("No text selected");
        return;
      }
      provider.sendSelectedCodeToWebview(selectedText, "/explain");
    })
  );

  // Command to handle /test
  context.subscriptions.push(
    vscode.commands.registerCommand("chat.test", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor found");
        return;
      }
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      if (!selectedText) {
        vscode.window.showErrorMessage("No text selected");
        return;
      }
      provider.sendSelectedCodeToWebview(selectedText, "/test");
    })
  );

  // Text selection handler
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const editor = event.textEditor;
      const selection = editor.selection;

      if (!selection.isEmpty) {
        const selectedText = editor.document.getText(selection);
        provider.sendSelectedCodeToWebview(selectedText);
      }
    })
  );

  // File change handler
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      provider.postActiveFileInfo();
    })
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}

class DevAIChatProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "chat.chat";
  private view?: vscode.WebviewView;
  private selectedCode: string = "";
  private activeCommand: string = "";

  constructor(private readonly extensionUri: vscode.Uri) {}

  private _onDidChange: vscode.EventEmitter<
    vscode.WebviewViewProvider | undefined | void
  > = new vscode.EventEmitter<undefined | void | vscode.WebviewViewProvider>();

  readonly onDidChange: vscode.Event<
    vscode.WebviewViewProvider | undefined | void
  > = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
    if (this.view) {
      this.view.webview.html = this.makeHTML(this.view.webview);
    }
  }

  public sendSelectedCodeToWebview(code: string, command: string = "") {
    this.selectedCode = code;
    if (command) {
      this.activeCommand = command;
    }

    if (this.view) {
      this.view.webview.postMessage({
        type: "storeCode",
        code: code,
        command: command,
      });
    }
  }

  public clearSelectedCode() {
    this.selectedCode = "";
    this.activeCommand = "";
  }

  public showError(message: string) {
    vscode.window.showErrorMessage(message);
  }

  public getActiveFileInfo() {
    if (
      !vscode.window.activeTextEditor ||
      (vscode.window.activeTextEditor.document.uri.scheme !== "file" &&
        vscode.window.activeTextEditor.document.uri.scheme !==
          "vscode-userdata")
    ) {
      return null;
    }

    const filePath = vscode.window.activeTextEditor.document.fileName || "";
    const fileName = path.basename(filePath);
    const selection = vscode.window.activeTextEditor.selection;
    const lineCount = vscode.window.activeTextEditor.document.lineCount;
    const cursor = vscode.window.activeTextEditor.selection.active.line;
    const canPaste =
      vscode.window.activeTextEditor.document.uri.scheme === "file";

    const lineInfo = !selection.isEmpty
      ? { line1: selection.start.line + 1, line2: selection.end.line + 1 }
      : { line1: 1, line2: lineCount };

    return {
      name: fileName,
      path: filePath,
      cursor,
      canPaste,
      ...lineInfo,
    };
  }

  public postActiveFileInfo() {
    const file = this.getActiveFileInfo();
    if (this.view) {
      this.view.webview.postMessage({
        type: "fileInfo",
        file: file,
      });
    }
  }

  private getColorTheme(): "light" | "dark" {
    switch (vscode.window.activeColorTheme.kind) {
      case vscode.ColorThemeKind.Light:
      case vscode.ColorThemeKind.HighContrastLight:
        return "light";
      default:
        return "dark";
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.makeHTML(webviewView.webview);
    this.postActiveFileInfo();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case "getSelectedCode":
          webviewView.webview.postMessage({
            type: "selectedCode",
            code: this.selectedCode,
            command: this.activeCommand,
          });
          break;
        case "clearStoredCode":
          this.clearSelectedCode();
          break;
        case "error":
          vscode.window.showErrorMessage(message.message);
          break;
        case "openFile":
          this.handleOpenFile(message.filePath, message.line);
          break;
        case "focusEditor":
          vscode.commands.executeCommand(
            "workbench.action.focusActiveEditorGroup"
          );
          break;
        case "newFile":
          this.createNewFile(message.content);
          break;
      }
    });
  }

  private async handleOpenFile(filePath: string, line?: number) {
    try {
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);

      const editor = await vscode.window.showTextDocument(document);

      if (line !== undefined) {
        const position = new vscode.Position(line, 0);
        const range = new vscode.Range(position, position);
        editor.revealRange(range);
        editor.selection = new vscode.Selection(position, position);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
    }
  }

  private createNewFile(content: string) {
    vscode.workspace.openTextDocument({ content }).then((document) => {
      vscode.window.showTextDocument(document);
    });
  }

  private makeHTML(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "app.js")
    );
    const markedUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "marked.js")
    );
    const resetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "reset.css")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "style.css")
    );

    const nonce = getNonce();
    const colorTheme = this.getColorTheme();
    const initialState = JSON.stringify({
      theme: colorTheme,
      file: this.getActiveFileInfo(),
    });

    return `<!DOCTYPE html>
      <html lang="en" class="${colorTheme}">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src http://74.225.223.193:11435 http://127.0.0.1:11434; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
        <link href="${resetUri}" rel="stylesheet">
        <link href="${styleUri}" rel="stylesheet">
        <title>Dev AI Chat</title>
        <style>
          :root {
            --app-background: var(--vscode-editor-background);
            --button-primary-bg: var(--vscode-button-background);
            --button-primary-fg: var(--vscode-button-foreground);
            --button-hover-bg: var(--vscode-button-hoverBackground);
            --panel-border: var(--vscode-panel-border);
            --panel-background: var(--vscode-panel-background);
          }
          
          body {
            background-color: var(--app-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            padding: 0;
            margin: 0;
          }
          
          #app-container {
            display: flex;
            flex-direction: column;
            height: 100vh;
          }
          
          #header {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            border-bottom: 1px solid var(--panel-border);
            background-color: var(--panel-background);
          }
          
          #header h3 {
            margin: 0;
            flex-grow: 1;
          }
          
          #file-info {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            padding: 4px 12px;
            border-bottom: 1px solid var(--panel-border);
            background-color: var(--panel-background);
            display: none;
          }
          
          #file-info.active {
            display: block;
          }
          
          #feed {
            flex-grow: 1;
            overflow-y: auto;
            padding: 12px;
          }
          
          .message {
            margin-bottom: 16px;
            padding: 10px;
            border-radius: 6px;
          }
          
          .message__user {
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textBlockQuote-border);
          }
          
          .message__assistant {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
          }
          
          .message__error {
            background-color: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
          }
          
          .message__info {
            background-color: var(--vscode-inputValidation-infoBackground);
            color: var(--vscode-inputValidation-infoForeground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
          }
          
          .message h4 {
            margin-top: 0;
            margin-bottom: 8px;
            font-weight: 600;
          }
          
          #chat {
            padding: 12px;
            border-top: 1px solid var(--panel-border);
            background-color: var(--panel-background);
          }
          
          #chat textarea {
            width: 100%;
            resize: vertical;
            min-height: 60px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px;
            border-radius: 3px;
            margin-bottom: 10px;
          }
          
          #button-container {
            display: flex;
            justify-content: space-between;
          }
          
          #chat button {
            width: 48%;
            height: 32px;
            cursor: pointer;
            border-radius: 3px;
          }
          
          #models {
            margin-top: 10px;
            width: 100%;
            height: 30px;
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
          }
          
          .code-block {
            margin: 10px 0;
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px 12px;
            border-radius: 3px;
            overflow-x: auto;
            position: relative;
          }
          
          .code-block pre {
            margin: 0;
          }
          
          .language-badge {
            position: absolute;
            top: 0;
            right: 0;
            font-size: 10px;
            padding: 2px 6px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 0 3px 0 3px;
          }
          
          .copy-button {
            position: absolute;
            top: 0;
            right: 60px;
            font-size: 10px;
            padding: 2px 6px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 0 0 0 3px;
            cursor: pointer;
          }
          
          .copy-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
          }
        </style>
      </head>
      <body>
        <div id="app-container">
          <div id="header">
            <h3>Dev AI Chat</h3>
          </div>
          
          <div id="file-info"></div>
          
          <section id="feed">
            <div class="message message__assistant">
              <h4>🤖 Assistant</h4>
              <p>Hello! I'm Dev AI and I'm here to help with your code. Select some code and try:</p>
              <ul>
                <li><code>/fix</code> - to get code fixes</li>
                <li><code>/explain</code> - to explain code</li>
                <li><code>/test</code> - to generate tests</li>
              </ul>
              <p>Or just ask me any coding question!</p>
            </div>
          </section>
          
          <form id="chat">
            <textarea placeholder="Type your message here... Use / commands with selected code" id="prompt" name="prompt"></textarea>
            <div id="button-container">
              <button type="submit">Send Message</button>
              <button type="button" id="clear-button">Clear Chat</button>
            </div>
            <select id="models" name="model">
              <option>Select Model</option>
            </select>
          </form>
        </div>
        
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const initialState = ${initialState};
          
          // Will be set by the extension
          let storedCode = "";
          let activeCommand = "";
          
          window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
              case 'storeCode':
                storedCode = message.code;
                if (message.command) {
                  activeCommand = message.command;
                  document.getElementById('prompt').value = message.command + ' ';
                  document.getElementById('prompt').focus();
                }
                updateFileInfo();
                break;
              case 'fileInfo':
                updateFileInfoPanel(message.file);
                break;
            }
          });
          
          function updateFileInfo() {
            const fileInfo = document.getElementById('file-info');
            if (storedCode) {
              const lines = storedCode.split('\\n').length;
              fileInfo.textContent = 'Selected: ' + lines + ' line' + (lines !== 1 ? 's' : '') + ' of code';
              fileInfo.classList.add('active');
            } else {
              fileInfo.classList.remove('active');
            }
          }
          
          function updateFileInfoPanel(fileInfo) {
            const fileInfoPanel = document.getElementById('file-info');
            if (fileInfo) {
              fileInfoPanel.textContent = 'Current File: ' + fileInfo.name;
              fileInfoPanel.classList.add('active');
            } else {
              fileInfoPanel.classList.remove('active');
            }
          }
          
          // Initialize with any existing file info
          if (initialState.file) {
            updateFileInfoPanel(initialState.file);
          }
        </script>
        <script src="${markedUri}"></script>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}