/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";

// Track global state for inline completions
let completionModelName = "gemma2:2b-instruct-q4_K_M";
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

    // Apply additional cleaning to remove unwanted patterns
    completion = this.cleanCompletionText(completion);
    
    // Special handling for Python code blocks that may have survived the cleaning
    const pythonBlockMatch = /^```python\s*\n([\s\S]+?)```\s*$/m.exec(completion);
    if (pythonBlockMatch && pythonBlockMatch[1]) {
      console.log("Found Python code block after cleaning, extracting content");
      completion = pythonBlockMatch[1].trim();
    }
    
    // Final check to remove any stray backticks
    completion = completion.replace(/^`+|`+$/g, "");

    console.log("Final completion after all cleaning:", completion);

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
    const model = config.get<string>("model", "gemma2:2b-instruct-q4_K_M");
    const maxTokens = config.get<number>("maxTokens", 50);
    const baseTemperature = config.get<number>("temperature", 0.2);

    // Test the endpoint connection first
    try {
      await this.testEndpointConnection(endpoint);
      
      // Check if the model exists on the server
      const modelExists = await this.checkModelExists(endpoint, model);
      if (!modelExists) {
        vscode.window.showErrorMessage(`Model '${model}' is not available on the Ollama server. Please check your configuration.`);
        return ["", -1];
      }
    } catch (error) {
      console.error("Endpoint connection test failed:", error);
      vscode.window.showErrorMessage(`Cannot connect to Ollama API at ${endpoint}: ${error}`);
      return ["", -1];
    }

    // Adjust temperature based on repeated manual invocations
    let temperature = baseTemperature;
    if (manualCompletionCount > 1) {
      // Increase randomness for repeated manual invocations, but cap at 2.0
      temperature = Math.min(baseTemperature + 0.4, 2.0);
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

    // Check if we're dealing with Python code
    const isPythonFile = fileExtension === "py" || fileExtension === "python";

    // Create a better structured prompt
    const promptText = isPythonFile 
      ? this.createPythonPrompt(languageHint, prefix)
      : this.createGenericPrompt(languageHint, fileExtension, prefix);

    console.log("Prompt text:", promptText);
    console.log("Model:", model);
    console.log("Max tokens:", maxTokens);
    console.log("Temperature:", temperature);
    console.log("Endpoint:", endpoint);
    console.log("File name:", fileName);
    console.log("Cursor line:", cursorLine);
    console.log("Cursor character:", cursorCharacter);
    console.log("Multiline:", multiline);
    console.log("Called manually:", calledManually);
    console.log("Manual completion count:", manualCompletionCount);

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
      console.log(`API response: "${response}"`);

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
   * Test connection to endpoint
   */
  private async testEndpointConnection(endpoint: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const url = new URL(endpoint);
        const options = {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: "/api/version",
          method: "GET",
          timeout: 30000
        };

        const client = url.protocol === "https:" ? https : http;
        const req = client.request(options, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP error ${res.statusCode}`));
            return;
          }
          
          // Consume response data to free up memory
          res.on('data', () => {});
          res.on('end', () => {
            resolve();
          });
        });

        req.on("error", (error) => {
          reject(error);
        });

        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Connection timed out"));
        });

        req.end();
      } catch (error) {
        reject(error);
      }
    });
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
          statusBarItem.tooltip = "Fetching completion...";
        }

        const url = new URL(endpoint);
        const data = JSON.stringify({
          model: model,
          prompt: prompt,
          stream: false,
          max_tokens: maxTokens,
          temperature: temperature,
        });

        console.log(`Sending request to ${url.toString()}`);

        const options = {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: "/api/generate",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
          timeout: 30000 // Add timeout to prevent hanging requests
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
              statusBarItem.tooltip = `Using Ollama with ${model} model`;
            }

            try {
              if (res.statusCode && res.statusCode >= 400) {
                const errorMsg = `HTTP error ${res.statusCode}: ${responseData}`;
                console.error(errorMsg);
                vscode.window.showErrorMessage(`Ollama API error: ${errorMsg}`);
                reject(new Error(errorMsg));
                return;
              }

              const parsedResponse = JSON.parse(responseData);

              if (!parsedResponse.response) {
                const errorMsg = "No response from Ollama API";
                console.error(errorMsg);
                vscode.window.showErrorMessage(`Ollama API error: ${errorMsg}`);
                reject(new Error(errorMsg));
                return;
              }

              // Get the response text
              let responseText = parsedResponse.response || "";
              
              // Strip markdown code blocks if present
              responseText = this.stripMarkdownCodeBlocks(responseText);

              // Return just the cleaned completion text
              resolve(responseText);
            } catch (error) {
              console.error("Error parsing Ollama API response:", error);
              vscode.window.showErrorMessage(`Failed to parse Ollama API response: ${error}`);
              reject(error);
            }
          });
        });

        req.on("error", (error) => {
          if (statusBarItem) {
            statusBarItem.text = "$(error) Ollama";
            statusBarItem.tooltip = `Error: ${error.message}`;
          }
          console.error("Ollama API request error:", error);
          vscode.window.showErrorMessage(`Ollama API request failed: ${error.message}`);
          reject(error);
        });

        // Add timeout handling
        req.on("timeout", () => {
          if (statusBarItem) {
            statusBarItem.text = "$(error) Ollama (Timeout)";
            statusBarItem.tooltip = "Request timed out";
          }
          console.error("Ollama API request timed out");
          vscode.window.showErrorMessage("Ollama API request timed out");
          req.destroy();
          reject(new Error("Request timed out"));
        });

        req.write(data);
        req.end();
      } catch (error) {
        if (statusBarItem) {
          statusBarItem.text = "$(error) Ollama";
          statusBarItem.tooltip = `Error: ${error}`;
        }
        console.error("Exception in Ollama API call:", error);
        vscode.window.showErrorMessage(`Failed to call Ollama API: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Check if the specified model exists on the server
   */
  private async checkModelExists(endpoint: string, modelName: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        const url = new URL(endpoint);
        const options = {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: "/api/tags",
          method: "GET",
          timeout: 5000
        };

        const client = url.protocol === "https:" ? https : http;
        const req = client.request(options, (res) => {
          let responseData = "";
          
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              console.error(`Error checking model existence: HTTP ${res.statusCode}`);
              resolve(false);
              return;
            }
            
            try {
              const response = JSON.parse(responseData);
              if (response.models) {
                const models = response.models;
                const modelExists = models.some((m: any) => 
                  m.name === modelName || 
                  `${m.name}:${m.tag}` === modelName
                );
                resolve(modelExists);
              } else {
                console.error("Invalid response format from /api/tags");
                resolve(false);
              }
            } catch (error) {
              console.error("Error parsing model list:", error);
              resolve(false);
            }
          });
        });

        req.on("error", (error) => {
          console.error("Error checking model existence:", error);
          resolve(false);
        });

        req.on("timeout", () => {
          req.destroy();
          console.error("Timeout checking model existence");
          resolve(false);
        });

        req.end();
      } catch (error) {
        console.error("Exception checking model existence:", error);
        resolve(false);
      }
    });
  }

  /**
   * Strip markdown code block formatting from a string
   */
  private stripMarkdownCodeBlocks(text: string): string {
    // First check if the text is wrapped in a complete code block
    const fullCodeBlockRegex = /^```[\w]*\n?([\s\S]*?)\n?```$/;
    const fullMatch = fullCodeBlockRegex.exec(text);
    if (fullMatch && fullMatch[1]) {
      return fullMatch[1].trim();
    }
    
    // If not a complete wrapper, handle partial code blocks
    // Remove opening code block markers like ```python, ```javascript, ```ts, etc.
    let cleaned = text.replace(/^```[\w]*\n?/m, "");
    
    // Remove closing code block markers
    cleaned = cleaned.replace(/\n?```$/m, "");
    
    // If we still have code blocks in the text, extract just the code
    const codeBlockRegex = /```[\w]*\n?([\s\S]*?)\n?```/gm;
    const match = codeBlockRegex.exec(text);
    if (match && match[1]) {
      // If we matched a code block, just return the content inside it
      cleaned = match[1].trim();
    }
    
    console.log("Original response:", text);
    console.log("Cleaned response:", cleaned);
    
    return cleaned;
  }

  /**
   * Apply additional cleaning to remove unwanted patterns from completions
   */
  private cleanCompletionText(text: string): string {
    // Remove any remaining markdown formatting elements that might have been missed
    let cleaned = text;
    
    // Handle markdown code blocks with language specifiers
    // This will match ```python, ```javascript, etc. at the beginning of the text
    cleaned = cleaned.replace(/^```[\w]*\s*\n?/m, "");
    
    // Handle closing code block markers at the end of the text
    cleaned = cleaned.replace(/\n?```\s*$/m, "");
    
    // Also remove any complete code blocks that might be in the middle of the text
    const codeBlockRegex = /```[\w]*\n?([\s\S]*?)\n?```/g;
    let match;
    while ((match = codeBlockRegex.exec(cleaned)) !== null) {
      // Replace the entire match with just the content inside the code block
      const fullMatch = match[0];
      const codeContent = match[1];
      cleaned = cleaned.replace(fullMatch, codeContent);
    }
    
    // Remove trailing/leading backticks if they exist on their own line
    cleaned = cleaned.replace(/^`+\s*$/gm, "").replace(/^\s*`+$/gm, "");
    
    // Remove standalone backticks
    cleaned = cleaned.replace(/^`+$/gm, "");
    
    // Remove markdown language specifiers like "python" or "javascript:" that might appear at the start
    cleaned = cleaned.replace(/^(python|javascript|typescript|java|c#|cpp|js|ts|html|css|ruby|go|rust|php|swift|bash|shell|powershell|sql)[:]*\s*$/im, "");
    
    // Remove any lines that only contain comments about "code completion" or similar
    cleaned = cleaned.replace(/^\s*\/\/\s*(code|completion|output|result|response).*$/gim, "");
    cleaned = cleaned.replace(/^\s*#\s*(code|completion|output|result|response).*$/gim, ""); // For Python comments
    
    // Clean up any Python docstring style comments
    cleaned = cleaned.replace(/^"""\s*(code completion|completion|suggestion)[\s\S]*?"""\s*$/gim, "");
    
    // Trim leading and trailing whitespace
    cleaned = cleaned.trim();
    
    console.log("Additional cleaning - before:", text);
    console.log("Additional cleaning - after:", cleaned);
    
    return cleaned;
  }

  /**
   * Create a prompt specifically for Python code completions
   */
  private createPythonPrompt(languageHint: string, prefix: string): string {
    return `${languageHint}# You are a helpful Python coding assistant that provides inline completions.
# CRITICAL INSTRUCTIONS:
# 1. Provide ONLY raw Python code that directly follows from the last line provided.
# 2. NEVER use markdown formatting like \`\`\`python or \`\`\`.
# 3. DO NOT include any explanations, docstrings, or comments that aren't part of the code.
# 4. DO NOT include any "Here's the completion" text or similar phrases.
# 5. Respond ONLY with the exact Python code that would logically follow.

${prefix}`;
  }

  /**
   * Create a prompt for generic code completions
   */
  private createGenericPrompt(languageHint: string, fileExtension: string, prefix: string): string {
    return `${languageHint}// You are a helpful coding assistant that provides inline code completions. Complete the following ${fileExtension} code with the most logical continuation.

// CRITICAL INSTRUCTIONS:
// 1. Only provide raw code. DO NOT wrap in markdown code blocks.
// 2. DO NOT use \`\`\`python, \`\`\`javascript, or any other language markers.
// 3. DO NOT include any explanation, comments about the code, or closing \`\`\` markers.
// 4. DO NOT start your response with "Here's the completion:" or any similar phrase.
// 5. Respond ONLY with the exact code that would logically follow.

${prefix}`;
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
