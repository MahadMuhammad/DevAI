// const LOCAL_OLLAMA = "http://127.0.0.1:11434";
const LOCAL_OLLAMA = "http://74.225.223.193:11435";
const HISTORY_LENGTH = 100;
// prevent overdrawing while streaming the content
const throttledDrawFeed = throttle(drawFeed, 120);

const state = {
  model: null,
  models: [],
  messages: [],
  fileInfo: null,
};

const $body = document.body;
let $chat;
let $feed;
let $prompt;
let $submit;
let $models;
let $fileInfo;
const vscode = acquireVsCodeApi();
let storedCode = "";

window.addEventListener("DOMContentLoaded", () => {
  $chat = document.getElementById("chat");
  $feed = document.getElementById("feed");
  $prompt = document.getElementById("prompt");
  $submit = $chat.querySelector('[type="submit"]');
  $models = document.getElementById("models");
  $fileInfo = document.getElementById("file-info");

  // Submit with Ctrl/Cmd+Enter
  $body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  });

  // Add Tab key handling for textarea
  $prompt.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = $prompt.selectionStart;
      const end = $prompt.selectionEnd;

      // Insert tab at cursor position
      $prompt.value =
        $prompt.value.substring(0, start) + "  " + $prompt.value.substring(end);

      // Move cursor after tab
      $prompt.selectionStart = $prompt.selectionEnd = start + 2;
    }
  });

  $chat.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submit();
  });

  $models.addEventListener("change", (e) => {
    console.log("Model selected:", e.target.value);
    state.model = e.target.value;
  });

  document
    .getElementById("clear-button")
    .addEventListener("click", function () {
      // Clear chat history
      state.messages = [];
      // Clear stored code
      storedCode = "";
      // Clear the prompt input
      document.getElementById("prompt").value = "";
      // Inform extension to clear stored code
      vscode.postMessage({
        type: "clearStoredCode",
      });
      // Redraw the feed
      drawFeed();
      // Reset file info panel
      $fileInfo.classList.remove("active");
    });

  // Log the initialization state
  console.log("DOM content loaded, elements initialized:");
  console.log("$chat:", $chat);
  console.log("$feed:", $feed);
  console.log("$prompt:", $prompt);
  console.log("$submit:", $submit);
  console.log("$models:", $models);
  console.log("$fileInfo:", $fileInfo);
  console.log("Getting models...");

  getModels();
});

// Let a function run at most once every `limit` ms
function throttle(func, limit) {
  let lastFunc;
  let lastRan;
  return function () {
    const context = this;
    const args = arguments;
    if (!lastRan) {
      func.apply(context, args);
      lastRan = Date.now();
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(function () {
        if (Date.now() - lastRan >= limit) {
          // Only execute the function if enough time has passed since it was last run
          func.apply(context, args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - lastRan));
    }
  };
}

// Helper function to create code blocks with language badge and copy button
function createCodeBlock(code, language) {
  const codeBlock = document.createElement("div");
  codeBlock.className = "code-block";

  // Create language badge if available
  if (language) {
    const langBadge = document.createElement("span");
    langBadge.className = "language-badge";
    langBadge.textContent = language;
    codeBlock.appendChild(langBadge);
  }

  // Create copy button
  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-button";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy code: ", err);
      });
  });
  codeBlock.appendChild(copyBtn);

  // Create pre and code elements
  const pre = document.createElement("pre");
  const codeElem = document.createElement("code");
  if (language) {
    codeElem.className = `language-${language}`;
  }
  codeElem.textContent = code;
  pre.appendChild(codeElem);
  codeBlock.appendChild(pre);

  return codeBlock;
}

// Helper to extract code blocks from markdown content
function processMarkdownContent(element) {
  // Find all code blocks
  const preElements = element.querySelectorAll("pre code");

  preElements.forEach((codeElem) => {
    const pre = codeElem.parentNode;
    const code = codeElem.textContent;

    // Try to determine language from class
    let language = "";
    for (const className of codeElem.classList) {
      if (className.startsWith("language-")) {
        language = className.substring(9);
        break;
      }
    }

    // Replace the pre element with our enhanced code block
    const codeBlock = createCodeBlock(code, language);
    pre.parentNode.replaceChild(codeBlock, pre);
  });
}

// Display error message in the chat
function showErrorInChat(message) {
  const errorMessage = document.createElement("div");
  errorMessage.classList.add("message", "message__error");
  errorMessage.innerHTML = `<h4>Error</h4><p>${message}</p>`;
  $feed.appendChild(errorMessage);

  // Scroll to the error message
  $feed.scrollTop = $feed.scrollHeight;
}

// Draws the chat feed reading from the state
function drawFeed() {
  $feed.innerHTML = "";

  for (const message of state.messages) {
    const $message = document.createElement("div");
    $message.classList.add("message");
    $message.classList.add(
      message.role == "user" ? "message__user" : "message__assistant"
    );
    const $title = document.createElement("h4");
    $title.innerHTML =
      message.role == "user" ? "You" : `🤖 Assistant <i>(${message.model})</i>`;

    const $body = document.createElement("div");
    $body.innerHTML = marked.parse(message.content, { gfm: true });

    // Process code blocks for syntax highlighting and copy buttons
    processMarkdownContent($body);

    // Make file paths clickable
    const filePathRegex = /`([^`]*\.(js|ts|py|cpp|java|html|css|json|md))`/g;
    $body.innerHTML = $body.innerHTML.replace(
      filePathRegex,
      (_, filePath) =>
        `<a href="#" class="file-link" data-path="${filePath}">${filePath}</a>`
    );

    // Add event listeners to file links
    setTimeout(() => {
      const fileLinks = $body.querySelectorAll(".file-link");
      fileLinks.forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const filePath = e.target.getAttribute("data-path");
          vscode.postMessage({
            type: "openFile",
            filePath,
          });
        });
      });
    }, 0);

    $message.appendChild($title);
    $message.appendChild($body);
    $feed.appendChild($message);
  }

  // Scroll to bottom of feed
  $feed.scrollTop = $feed.scrollHeight;
}

// Clears the chatbox
function clearPrompt() {
  $prompt.value = "";
}

// Starts/stops the loading state
function setLoading(value = true) {
  if (value) {
    $prompt.setAttribute("disabled", true);
    $prompt.value = "Loading...";
    $submit.setAttribute("disabled", true);
  } else {
    $prompt.removeAttribute("disabled");
    $submit.removeAttribute("disabled");
    $prompt.value = "";
    $prompt.focus();
  }
}

// Add event listener for messages from extension
window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.type) {
    case "storeCode":
      storedCode = message.code;
      if (message.command) {
        $prompt.value = message.command + " ";
        $prompt.focus();
      }
      updateSelectedCodeInfo();
      break;
    case "fileInfo":
      state.fileInfo = message.file;
      updateFileInfoDisplay();
      break;
  }
});

function updateSelectedCodeInfo() {
  if (!storedCode) {
    return;
  }

  const lines = storedCode.split("\n").length;
  if (lines > 0) {
    showInfoMessage(`Selected ${lines} line${lines !== 1 ? "s" : ""} of code`);
  }
}

function showInfoMessage(message) {
  const infoMsg = document.createElement("div");
  infoMsg.classList.add("message", "message__info");
  infoMsg.innerHTML = `<p>${message}</p>`;
  $feed.appendChild(infoMsg);

  // Remove the message after 3 seconds
  setTimeout(() => {
    if (infoMsg.parentNode === $feed) {
      $feed.removeChild(infoMsg);
    }
  }, 3000);
}

function updateFileInfoDisplay() {
  if (!state.fileInfo) {
    $fileInfo.classList.remove("active");
    return;
  }

  $fileInfo.textContent = `File: ${state.fileInfo.name}`;
  if (
    state.fileInfo.line1 &&
    state.fileInfo.line2 &&
    state.fileInfo.line1 !== state.fileInfo.line2
  ) {
    $fileInfo.textContent += ` (Lines ${state.fileInfo.line1}-${state.fileInfo.line2})`;
  }
  $fileInfo.classList.add("active");
}

// Modify the submit function to handle commands with stored code
async function submit() {
  // Force console logging for debugging
  console.log("Submit called");
  console.log("Current state model:", state.model);
  console.log("Available models:", state.models);

  if (!state.model) {
    console.error("No model selected");
    showErrorInChat("Please select a model first");
    vscode.postMessage({
      type: "error",
      message: "Please select a model first",
    });
    return;
  }

  const prompt = $prompt.value.trim();

  if (!prompt) {
    console.error("No prompt provided");
    showErrorInChat("Please enter a message");
    vscode.postMessage({
      type: "error",
      message: "Please enter a message",
    });
    return;
  }

  console.log("Submitting prompt:", prompt);
  console.log("Using model:", state.model);

  let finalPrompt = prompt;

  // Handle commands that need selected code
  if (
    prompt.startsWith("/fix") ||
    prompt.startsWith("/explain") ||
    prompt.startsWith("/test")
  ) {
    if (!storedCode) {
      showErrorInChat("No code selected. Please select code first.");
      vscode.postMessage({
        type: "error",
        message: "No code selected. Please select code first.",
      });
      return;
    }

    // Include file context if available
    const fileContext = state.fileInfo ? `\nFile: ${state.fileInfo.name}` : "";

    if (prompt.startsWith("/fix")) {
      finalPrompt = `Please fix this code and explain the changes:${fileContext}\n\n\`\`\`\n${storedCode}\n\`\`\``;
    } else if (prompt.startsWith("/explain")) {
      finalPrompt = `Please explain this code:${fileContext}\n\n\`\`\`\n${storedCode}\n\`\`\``;
    } else if (prompt.startsWith("/test")) {
      finalPrompt = `Please write test cases for this code:${fileContext}\n\n\`\`\`\n${storedCode}\n\`\`\``;
    }
  }

  const message = {
    role: "user",
    content: finalPrompt,
  };

  state.messages.push(message);
  if (state.messages.length > HISTORY_LENGTH) {
    state.messages.shift();
  }

  drawFeed();
  clearPrompt();
  setLoading(true);

  try {
    console.log("Sending request to:", LOCAL_OLLAMA + "/api/chat");
    console.log(
      "Request body:",
      JSON.stringify({
        model: state.model,
        messages: state.messages,
        stream: true,
      })
    );

    const res = await fetch(LOCAL_OLLAMA + `/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: state.model,
        messages: state.messages,
        stream: true,
      }),
    });

    console.log("Response status:", res.status);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    // Clear the stored code after sending
    storedCode = "";
    vscode.postMessage({
      type: "clearStoredCode",
    });

    const reader = res.body.getReader();
    const responseMessage = {
      role: "assistant",
      content: "",
      model: state.model,
    };
    state.messages.push(responseMessage);

    // Fix the JSON parsing of streamed chunks
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const text = new TextDecoder().decode(value);
      console.log("Received chunk:", text);

      const lines = text.split("\n");

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const chunk = JSON.parse(line);
          if (chunk.message && chunk.message.content) {
            responseMessage.content += chunk.message.content;
            throttledDrawFeed();
          }
        } catch (parseError) {
          console.warn("Failed to parse chunk:", parseError, "Line:", line);
          continue;
        }
      }
    }
  } catch (error) {
    console.error("Error:", error);
    showErrorInChat(`Error: ${error.message}`);
    vscode.postMessage({
      type: "error",
      message: error.message,
    });
  } finally {
    setLoading(false);
  }
}

// Draws the model picker with models from the state
function drawModelPicker() {
  console.log("Drawing model picker with models:", state.models);
  $models.innerHTML = "";

  if (state.models.length === 0) {
    console.log("No models available, adding dummy option");
    const $opt = document.createElement("option");
    $opt.innerText = "No models available - try llama2";
    $opt.value = "llama2";
    $models.appendChild($opt);
    state.model = "llama2";
    return;
  }

  for (const model of state.models) {
    const $opt = document.createElement("option");
    $opt.innerText = model;
    $opt.value = model;
    $models.appendChild($opt);
  }

  // Make sure a model is selected
  if (state.model && state.models.includes(state.model)) {
    $models.value = state.model;
  } else {
    state.model = state.models[0];
    $models.value = state.model;
  }

  console.log("Model dropdown populated, selected model:", state.model);
}

// Retrieves a list of locally installed models and updates the state
async function getModels() {
  setLoading(true);
  try {
    console.log("Fetching models from:", LOCAL_OLLAMA + "/api/tags");
    const res = await fetch(LOCAL_OLLAMA + `/api/tags`);

    // Log the raw response for debugging
    console.log("API response status:", res.status);

    const body = await res.json();
    console.log("Models response:", body);

    if (!body.models || !Array.isArray(body.models)) {
      throw new Error("Invalid response format - models array missing");
    }

    state.models = body.models.map((m) => m.name);
    console.log("Available models:", state.models);

    // Make sure we select the first model by default
    state.model = state.model ?? state.models[0];
    console.log("Selected model:", state.model);

    drawModelPicker();
  } catch (error) {
    console.error("Error loading models:", error);

    // Add placeholder models but also set a default model
    $models.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.innerText = "Error loading models - try llama2";
    placeholder.value = "llama2";
    placeholder.selected = true;
    $models.appendChild(placeholder);

    // Set a fallback model
    state.model = "llama2";

    showErrorInChat(`Failed to load models: ${error.message}`);
    vscode.postMessage({
      type: "error",
      message: "Failed to load models: " + error.message,
    });
  } finally {
    setLoading(false);
  }
}
