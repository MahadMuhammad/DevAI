import * as vscode from "vscode";
import { initializeInlineCompletions } from './inlineCompletions';

export function activate(context: vscode.ExtensionContext) {
  const provider = new OllamaChatProvider(context.extensionUri);

  // Initialize inline completions from the separate file
  const inlineCompletionDisposables = initializeInlineCompletions(context);
  inlineCompletionDisposables.forEach(d => context.subscriptions.push(d));

  // Register command to manually trigger inline completions
  context.subscriptions.push(
    vscode.commands.registerCommand("chat.triggerCompletion", async () => {
      try {
        // Trigger inline completion via the built-in command
        await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
        console.log("Manually triggered inline completions");
      } catch (error) {
        console.error("Failed to trigger inline completions:", error);
        // Silent failure - log to console only
      }
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      OllamaChatProvider.viewType,
      provider
    )
  );

  //////////////////////////////////////////////////////////

  context.subscriptions.push(
    vscode.commands.registerCommand(OllamaChatProvider.viewType, () => {
      const message = "Menu/Title of extension is clicked !";
      vscode.window.showInformationMessage(message);
    })
  );

  // Command has been defined in the package.json file
  // Provide the implementation of the command with registerCommand
  // CommandId parameter must match the command field in package.json
  let openWebView = vscode.commands.registerCommand("chat.refresh", () => {
    // Display a message box to the user
    vscode.window.showInformationMessage(
      'Command " Sidebar View [vscodeSidebar.openview] " called.'
    );
  });

  context.subscriptions.push(openWebView);

  context.subscriptions.push(
    vscode.commands.registerCommand("chat.refreshEntry", () =>
      provider.refresh()
    )
  );

  //////////////////////////////////////////////////////////

  console.log("activated");

  console.log('Congratulations, your extension "chat" is now active!');

  const disposable = vscode.commands.registerCommand("chat.helloWorld", () => {
    vscode.window.showInformationMessage("Hello World from chat!");
  });

  context.subscriptions.push(disposable);

  // Add command to handle /fix
  context.subscriptions.push(
    vscode.commands.registerCommand("chat.fix", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        // Silent operation - log to console only
        console.error("No active editor found");
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      
      if (!selectedText) {
        // Silent operation - log to console only
        console.error("No text selected");
        return;
      }

      // Send selected text to webview
      provider.sendSelectedCodeToWebview(selectedText);
    })
  );

  //Command to handle /explain
  context.subscriptions.push(
    vscode.commands.registerCommand("chat.explain", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        // Silent operation - log to console only
        console.error("No active editor found");
        return;
      }
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      if (!selectedText) {
        // Silent operation - log to console only
        console.error("No text selected");
        return;
      }
      provider.sendSelectedCodeToWebview(selectedText);
    })
  );

  //command to handle /test
  context.subscriptions.push(
    vscode.commands.registerCommand("chat.test", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        // Silent operation - log to console only
        console.error("No active editor found");
        return;
      }
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      if (!selectedText) {
        // Silent operation - log to console only
        console.error("No text selected");
        return;
      }
      provider.sendSelectedCodeToWebview(selectedText);
    })
  );

  // Modify the text selection handler
  vscode.window.onDidChangeTextEditorSelection((event) => {
    const editor = event.textEditor;
    const selection = editor.selection;
    
    if (!selection.isEmpty) {
      const selectedText = editor.document.getText(selection);
      provider.sendSelectedCodeToWebview(selectedText); // This now just stores the code
    }
  });
}

// This method is called when your extension is deactivated
export function deactivate() {}

class OllamaChatProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "chat.chat";
  private view?: vscode.WebviewView;
  private selectedCode: string = '';

  constructor(private readonly extensionUri: vscode.Uri) {}

  private _onDidChange: vscode.EventEmitter<
    vscode.WebviewViewProvider | undefined | void
  > = new vscode.EventEmitter<undefined | void | vscode.WebviewViewProvider>();

  readonly onDidChange: vscode.Event<
    vscode.WebviewViewProvider | undefined | void
  > = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  public sendSelectedCodeToWebview(code: string) {
    this.selectedCode = code;
    if (this.view) {
      this.view.webview.postMessage({
        type: 'storeCode',
        code: code
      });
    }
  }

  public clearSelectedCode() {
    this.selectedCode = '';
  }

  // Add method to log error to console without showing a message
  public showError(message: string) {
    console.error(`DevAI Chat Error: ${message}`);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.makeHTML(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.type) {
        case 'getSelectedCode':
          webviewView.webview.postMessage({
            type: 'selectedCode',
            code: this.selectedCode
          });
          break;
        case 'clearStoredCode':
          this.clearSelectedCode();
          break;
        case 'insertAtCursor':
          this.insertCodeAtCursor(message.code);
          break;
        case 'error':
          // Log error to console instead of showing notification
          console.error(`Webview Error: ${message.message}`);
          break;
      }
    });
  }

  /**
   * Insert code at the current cursor position in the active editor
   * @param code The code to insert
   */
  private insertCodeAtCursor(code: string): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      console.error('No active editor found when trying to insert code');
      
      // Inform the webview that insertion failed
      if (this.view) {
        this.view.webview.postMessage({
          type: 'insertError',
          message: 'No active editor found. Open a file first and try again.'
        });
      }
      return;
    }

    editor.edit((editBuilder) => {
      // Insert at each cursor position (supports multi-cursor)
      editor.selections.forEach(selection => {
        // If there's a selection, replace it
        if (!selection.isEmpty) {
          editBuilder.replace(selection, code);
        } else {
          // Otherwise insert at cursor position
          editBuilder.insert(selection.active, code);
        }
      });
    }).then(success => {
      if (!success) {
        console.error('Failed to insert code at cursor');
        // Inform the webview that insertion failed
        if (this.view) {
          this.view.webview.postMessage({
            type: 'insertError',
            message: 'Failed to insert code'
          });
        }
      } else {
        // If success, inform the webview
        if (this.view) {
          this.view.webview.postMessage({
            type: 'insertSuccess'
          });
        }
      }
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

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
            background-color: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
            border-left: 3px solid var(--vscode-errorForeground, #f14c4c);
            color: var(--vscode-errorForeground, #f14c4c);
            font-size: 12px;
            padding: 8px;
            margin-top: 8px;
          }
          
          #chat {
            display: flex;
            flex-direction: column;
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
            background-color: var(--button-primary-bg);
            color: var(--button-primary-fg);
            border: none;
          }
          
          #chat button:hover {
            background-color: var(--button-hover-bg);
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
            border: 1px solid var(--vscode-panel-border);
          }
          
          .code-block pre {
            margin: 0;
            font-family: var(--vscode-editor-font-family, 'Consolas, monospace');
            font-size: var(--vscode-editor-font-size, 14px);
          }
          
          .code-block-header {
            display: flex;
            justify-content: flex-end;
            padding: 4px;
            background-color: rgba(0, 0, 0, 0.1);
            margin: -8px -12px 8px -12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 6px;
          }
          
          .copy-button, .insert-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            padding: 2px 8px;
            font-size: 11px;
            cursor: pointer;
            opacity: 0.8;
            transition: opacity 0.2s, background-color 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .copy-button:hover, .insert-button:hover {
            opacity: 1;
            background-color: var(--vscode-button-hoverBackground);
          }
          
          .copy-button:before {
            content: "";
            display: inline-block;
            width: 12px;
            height: 12px;
            margin-right: 3px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='white'%3E%3Cpath d='M4 4v8h8V4H4zm7 7H5V5h6v6zM3 3v9h9V3H3zm1-1h8v1H4V2zm9 1v10H3V2h1V1h8v1h1z'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-size: contain;
          }
          
          .insert-button:before {
            content: "";
            display: inline-block;
            width: 12px;
            height: 12px;
            margin-right: 3px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='white'%3E%3Cpath d='M3.5 7h9L8 11.5 3.5 7z'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-size: contain;
          }
          
          .copy-success {
            background-color: var(--vscode-editorGutter-addedBackground, #587c0c);
          }
          
          .insert-success {
            background-color: var(--vscode-gitDecoration-addedResourceForeground, #4d9375);
          }
          
          .copy-success:before {
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='white'%3E%3Cpath d='M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z'/%3E%3C/svg%3E");
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
              <p>Hello! I'm Dev AI and I'm here to help with your code.</p>
              <p>Select some code and try:</p>
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