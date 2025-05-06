/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";

// Track global state for inline completions
let completionModelName = "";
let manualCompletionCount = 0;
let completionSerialCounter = 6000;
let statusBarItem: vscode.StatusBarItem | undefined;
let lastCompletionData: any = null;

/**
 * Initialize the inline completions provider
 * @param context Extension context for registering disposables
 * @returns Disposable items that should be registered with the extension
 */
export function initializeInlineCompletions(
  context: vscode.ExtensionContext
): vscode.Disposable[] {
  console.log("Initializing Ollama inline completions");

  const disposables: vscode.Disposable[] = [];

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "$(sparkle) Ollama";
  statusBarItem.tooltip = "Moiz AI Completions";
  statusBarItem.show();
  disposables.push(statusBarItem);

  // Register configuration watcher
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("ollama")) {
      updateConfiguration();
    }
  });
  disposables.push(configWatcher);

  // Register commands
  const acceptedCommand = vscode.commands.registerCommand(
    "chat.completionAccepted",
    async (serialNumber: number) => {
      await inlineAccepted(serialNumber);
    }
  );
  disposables.push(acceptedCommand);

  const pauseCommand = vscode.commands.registerCommand(
    "chat.toggleCompletions",
    () => {
      const config = vscode.workspace.getConfiguration("ollama");
      const currentPause = config.get<boolean>("pauseCompletion", false);
      config.update("pauseCompletion", !currentPause, true);
      vscode.window.showInformationMessage(
        `Ollama completions ${!currentPause ? "paused" : "resumed"}`
      );
      updateStatusBar(!currentPause);
    }
  );
  disposables.push(pauseCommand);

  // Register editor event handlers
  const onCursorMoved = vscode.window.onDidChangeTextEditorSelection(() => {
    setTimeout(() => inlineRejected("moveaway"), 50);
  });
  disposables.push(onCursorMoved);

  const onTextEdited = vscode.workspace.onDidChangeTextDocument(() => {
    setTimeout(() => inlineRejected("moveaway"), 50);
  });
  disposables.push(onTextEdited);

  // Register completion provider
  const completionProvider = new OllamaInlineCompletionProvider();
  const provider = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    completionProvider
  );
  disposables.push(provider);

  // Initialize configuration
  updateConfiguration();

  return disposables;
}

/**
 * Update the status bar display based on configuration
 */
function updateStatusBar(isPaused: boolean = false): void {
  if (!statusBarItem) {
    return;
  }

  if (isPaused) {
    statusBarItem.text = "$(eye-closed) Ollama (Paused)";
    statusBarItem.tooltip = "Ollama AI Completions (Paused)";
    statusBarItem.command = "chat.toggleCompletions";
    return;
  }

  if (completionModelName) {
    statusBarItem.text = `$(sparkle) Ollama (${completionModelName})`;
    statusBarItem.tooltip = `Using Ollama with ${completionModelName} model`;
  } else {
    statusBarItem.text = "$(sparkle) Ollama";
    statusBarItem.tooltip = "Ollama AI Completions";
  }
  statusBarItem.command = "chat.toggleCompletions";
}

/**
 * Read and apply configuration settings
 */
function updateConfiguration(): void {
  const config = vscode.workspace.getConfiguration("ollama");
  const isPaused = config.get<boolean>("pauseCompletion", false);
  updateStatusBar(isPaused);
}

/**
 * Main inline completion provider class
 */
class OllamaInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    cancelToken: vscode.CancellationToken
  ): Promise<
    | vscode.InlineCompletionItem[]
    | vscode.InlineCompletionList
    | null
    | undefined
  > {
    // Skip special document types
    if (document.uri.scheme === "comment") {
      return [];
    }

    // Check if completions are paused in settings
    const pauseCompletion = vscode.workspace
      .getConfiguration("ollama")
      .get<boolean>("pauseCompletion", false);
    if (
      pauseCompletion &&
      context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic
    ) {
      return [];
    }

    // Check document size
    const wholeDoc = document.getText();
    if (wholeDoc.length > 180 * 1024) {
      // 180KB limit
      return [];
    }

    // Get current line and cursor context
    const currentLine = document.lineAt(position.line);
    const leftOfCursor = currentLine.text.substring(0, position.character);
    const rightOfCursor = currentLine.text.substring(position.character);

    // Check if right of cursor has only special characters
    const rightOfCursorHasOnlySpecialChars = Boolean(
      rightOfCursor.match(/^[:\s\t\n\r(){},."'\];]*$/)
    );
    if (!rightOfCursorHasOnlySpecialChars) {
      return [];
    }

    // Check if we're at an empty line (multiline completion)
    const multiline = leftOfCursor.replace(/\s/g, "").length === 0;

    // Handle emojis and special characters for cursor position
    let correctedCursorCharacter = position.character;
    if (!multiline) {
      // Replace emoji with spaces to get correct character count
      const replaceEmojiWithOneChar = leftOfCursor.replace(
        /[\uD800-\uDBFF][\uDC00-\uDFFF]/g,
        " "
      );
      correctedCursorCharacter -=
        leftOfCursor.length - replaceEmojiWithOneChar.length;
    }

    // Track if this was manually invoked
    const calledManually =
      context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    if (calledManually) {
      manualCompletionCount++;
    } else {
      manualCompletionCount = 0;
    }

    // Get completion with serial number for telemetry
    let completion = "";
    let thisCompletionSerialNumber = 0;
    try {
      [completion, thisCompletionSerialNumber] = await this.cachedRequest(
        cancelToken,
        document.fileName,
        wholeDoc,
        position.line,
        correctedCursorCharacter,
        multiline,
        calledManually
      );
    } catch (error) {
      console.error("Error getting completion:", error);
      return [];
    }

    // If no completion was returned, return empty
    if (!completion || completion === "") {
      return [];
    }

    // Create command to track when completion is accepted
    const command = {
      command: "chat.completionAccepted",
      title: "Completion Accepted",
      arguments: [thisCompletionSerialNumber],
    };

    // Create range for replacement
    let replaceRange0 = new vscode.Position(position.line, position.character);
    let replaceRange1 = new vscode.Position(
      position.line,
      currentLine.text.length
    );
    if (multiline) {
      replaceRange0 = new vscode.Position(position.line, 0);
    }

    // Create completion item
    const completionItem = new vscode.InlineCompletionItem(
      completion,
      new vscode.Range(replaceRange0, replaceRange1)
    );
    completionItem.command = command;

    return [completionItem];
  }

  /**
   * Request a completion from Ollama
   */
  async cachedRequest(
    cancelToken: vscode.CancellationToken,
    fileName: string,
    wholeDoc: string,
    cursorLine: number,
    cursorCharacter: number,
    multiline: boolean,
    calledManually: boolean
  ): Promise<[string, number]> {
    if (cancelToken.isCancellationRequested) {
      return ["", -1];
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration("ollama");
    const endpoint = config.get<string>(
      "endpoint",
      "http://74.225.223.193:11435"
    );
    const model = config.get<string>("model", "codellama");
    const maxTokens = config.get<number>("maxTokens", 50);

    // Adjust temperature based on repeated manual invocations
    let temperature = 0.2;
    if (manualCompletionCount > 1) {
      temperature = 0.6; // Increase randomness for repeated manual invocations
    }

    const t0 = Date.now();

    // Get context before cursor
    const maxContextLines = 50;
    let startLine = Math.max(0, cursorLine - maxContextLines);
    let contextLines = [];

    for (let i = startLine; i <= cursorLine; i++) {
      if (i === cursorLine) {
        // For the current line, only include up to the cursor
        const line =
          i < wholeDoc.split("\n").length ? wholeDoc.split("\n")[i] : "";
        contextLines.push(line.substring(0, cursorCharacter));
      } else {
        // Include full previous lines
        const line =
          i < wholeDoc.split("\n").length ? wholeDoc.split("\n")[i] : "";
        contextLines.push(line);
      }
    }

    const prefix = contextLines.join("\n");

    // Generate a file extension hint for the model
    const fileExtension = fileName.split(".").pop() || "";
    let languageHint = "";
    if (fileExtension) {
      languageHint = `// File type: ${fileExtension}\n`;
    }

    // Create prompt with file info and code context
    const promptText = `${languageHint}// Complete the following ${fileExtension} code:\n${prefix}`;

    // Call Ollama API
    try {
      const response = await this.callOllamaAPI(
        endpoint,
        model,
        promptText,
        maxTokens,
        temperature
      );

      const t1 = Date.now();
      const msInt = Math.round(t1 - t0);
      console.log(`API request completed in ${msInt}ms`);

      // Get unique ID for this completion
      completionSerialCounter++;
      const serialNumber = completionSerialCounter;

      // Update status bar with model info
      completionModelName = model;
      updateStatusBar();

      // Store completion data for telemetry
      lastCompletionData = {
        model: model,
        temperature: temperature,
        tokens: response.length,
        duration_ms: msInt,
      };

      return [response, serialNumber];
    } catch (error) {
      console.error("Error calling Ollama API:", error);
      return ["", -1];
    }
  }

  /**
   * Call the Ollama API directly using http/https
   */
  async callOllamaAPI(
    endpoint: string,
    model: string,
    prompt: string,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        if (statusBarItem) {
          statusBarItem.text = "$(sync~spin) Ollama";
        }

        const url = new URL(endpoint);
        const data = JSON.stringify({
          model: model,
          prompt: prompt,
          stream: false,
          max_tokens: maxTokens,
          temperature: temperature,
        });

        const options = {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: "/api/generate",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        };

        const client = url.protocol === "https:" ? https : http;

        const req = client.request(options, (res) => {
          let responseData = "";

          res.on("data", (chunk) => {
            responseData += chunk;
          });

          res.on("end", () => {
            if (statusBarItem) {
              statusBarItem.text = `$(sparkle) Ollama (${model})`;
            }

            try {
              if (res.statusCode && res.statusCode >= 400) {
                reject(
                  new Error(`HTTP error ${res.statusCode}: ${responseData}`)
                );
                return;
              }

              const parsedResponse = JSON.parse(responseData);

              if (!parsedResponse.response) {
                reject(new Error("No response from Ollama API"));
                return;
              }

              // Return just the completion text
              resolve(parsedResponse.response || "");
            } catch (error) {
              reject(error);
            }
          });
        });

        req.on("error", (error) => {
          if (statusBarItem) {
            statusBarItem.text = "$(error) Ollama";
          }
          reject(error);
        });

        req.write(data);
        req.end();
      } catch (error) {
        if (statusBarItem) {
          statusBarItem.text = "$(error) Ollama";
        }
        reject(error);
      }
    });
  }
}

/**
 * Handle when a completion is accepted
 */
async function inlineAccepted(serialNumber: number): Promise<void> {
  console.log(`Completion accepted: ${serialNumber}`);

  // Simple telemetry for accepted completions
  try {
    const config = vscode.workspace.getConfiguration("ollama");
    const shouldTrackTelemetry = config.get<boolean>("trackTelemetry", false);

    if (shouldTrackTelemetry && lastCompletionData) {
      // You could implement telemetry here if desired
      console.log("Telemetry data for accepted completion:", {
        serial_number: serialNumber,
        ...lastCompletionData,
        timestamp: new Date().toISOString(),
        user: "MahadMuhammad", // Current user from your information
      });
    }
  } catch (error) {
    console.error("Error logging acceptance:", error);
  }
}

/**
 * Handle when a completion is rejected
 */
function inlineRejected(reason: string): void {
  // Handle rejection silently
  console.log(`Completion rejected: ${reason}`);
}
