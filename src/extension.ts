import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const provider = new OllamaChatProvider(context.extensionUri);

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
      provider.sendSelectedCodeToWebview(selectedText);
    })
  );

  //Command to handle /explain
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
      provider.sendSelectedCodeToWebview(selectedText);
    })
  );

  //command to handle /test
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

  // Add method to show error message in VS Code
  public showError(message: string) {
    vscode.window.showErrorMessage(message);
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
        case 'error':
          vscode.window.showErrorMessage(message.message);
          break;
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
        <title>Ollama Chat</title>
        <style>
          #chat {
            display: flex;
            flex-direction: column;
          }
          #chat textarea {
            margin-bottom: 10px;
          }
          #button-container {
            display: flex;
            justify-content: space-between;
          }
          #chat button {
            width: 48%;
          }
          #chat select {
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <section id="feed">
          <h3>Hello World! 🤖</h3>
          <p>I am DevAI and all your chat remains private 🔐</p>
          <p>How cool is that?</p>
        </section>
        <form id="chat">
          <textarea placeholder="Type your message prompt here..." id="prompt" name="prompt"></textarea>
          <div id="button-container">
            <button type="submit">Send</button>
            <button type="button" id="clear-button">Clear</button>
          </div>
          <select id="models" name="model">
            <option> Select Model </option>
          </select>
        </form>    
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
