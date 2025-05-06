# DevAI Chat Extension

This VS Code extension provides AI-powered features including chat and inline code completions using the Ollama API.

## Features

### AI Chat
Access a powerful AI chat interface directly in VS Code for code-related questions, explanations, and assistance.

### AI Code Completions
Get real-time code suggestions as you type with AI-powered inline completions.

![Code Completions Demo](images/code-completions.png)

## Requirements

- VS Code 1.96.0 or newer
- Access to an Ollama server (local or remote)
- A compatible model installed on the Ollama server (e.g., gemma2:2b-instruct-q4_K_M, codellama, etc.)

## Extension Settings

This extension contributes the following settings:

### Ollama Configuration:

* `ollama.endpoint`: Ollama API endpoint URL (default: "http://74.225.223.193:11435")
* `ollama.model`: Model to use for completions (default: "gemma2:2b-instruct-q4_K_M")
* `ollama.maxTokens`: Maximum number of tokens to generate (default: 50)
* `ollama.pauseCompletion`: Pause automatic completions (default: false)
* `ollama.temperature`: Temperature for completions, 0 = deterministic, higher = more random (default: 0.2)
* `ollama.trackTelemetry`: Track telemetry for accepted completions - local only (default: false)

## Using Inline Completions

The extension provides AI-powered code completions as you type:

1. **Automatic Completions**: As you code, the extension will automatically suggest completions based on the context.
2. **Manual Trigger**: Press `Alt+\` to manually trigger a completion suggestion.
3. **Toggle Completions**: Use the command "Toggle AI Code Completions" to turn the feature on or off.

### Keyboard Shortcuts

- `Alt+\`: Manually trigger an AI code completion
- `Tab`: Accept the current suggestion (VS Code default)
- Arrow keys: Navigate through multiple suggestions (VS Code default)

## Troubleshooting Inline Completions

If inline completions aren't working:

1. **Check Connection**: Ensure you have access to the Ollama API endpoint specified in settings.
2. **Check Model**: Verify that the model specified in settings is available on your Ollama server.
3. **Manual Trigger**: Try manually triggering completions with `Alt+\`.
4. **View Logs**: Check the "DevAI" output channel for error messages.
5. **Toggle Feature**: Try turning the feature off and back on with the "Toggle AI Code Completions" command.

## Known Issues

- The Ollama API endpoint must be accessible from your VS Code environment.
- Large files (>180KB) may not receive completions to avoid performance issues.

## Release Notes

### 0.0.1

- Initial release with AI chat and code completion features

---

**Enjoy coding with DevAI!**
