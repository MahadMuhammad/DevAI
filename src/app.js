const LOCAL_OLLAMA = "http://127.0.0.1:11434";
// const LOCAL_OLLAMA = "http://192.168.192.128:11435";
const HISTORY_LENGTH = 100;
// prevent overdrawing while streaming the content
const throttledDrawFeed = throttle(drawFeed, 120);

const state = {
  model: null,
  models: [],
  messages: [],
};

const $body = document.body;
let $chat;
let $feed;
let $prompt;
let $submit;
let $models;
const vscode = acquireVsCodeApi();
let storedCode = '';

window.addEventListener("DOMContentLoaded", () => {
  $chat = document.getElementById("chat");
  $feed = document.getElementById("feed");
  $prompt = document.getElementById("prompt");
  $submit = $chat.querySelector('[type="submit"]');
  $models = document.getElementById("models");

  // Submit with Ctrl/Cmd+Enter
  $body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  });

  $chat.addEventListener("submit", async (event) => {
    event.preventDefault();

    await submit();
  });

  $models.addEventListener("change", (e) => {
    state.model = e.target.value;
  });

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
    const $body = document.createElement("p");
    $body.innerHTML = marked.parse(message.content, { gfm: false });
    $message.appendChild($title);
    $message.appendChild($body);
    $feed.appendChild($message);
  }
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
window.addEventListener('message', event => {
  const message = event.data;
  switch (message.type) {
    case 'storeCode':
      storedCode = message.code;
      break;
  }
});

// Modify the submit function to handle commands with stored code
async function submit() {
  if (!state.model) {
    console.error("No model selected");
    return;
  }

  const prompt = $prompt.value.trim();
  
  if (!prompt) {
    console.error("No prompt provided");
    return;
  }

  console.log("Submitting prompt:", prompt);
  console.log("Using model:", state.model);

  let finalPrompt = prompt;
  
  // Handle commands that need selected code
  if (prompt.startsWith('/fix') || prompt.startsWith('/explain') || prompt.startsWith('/test')) {
    if (!storedCode) {
      vscode.postMessage({
        type: 'error',
        message: 'No code selected. Please select code first.'
      });
      return;
    }

    if (prompt.startsWith('/fix')) {
      finalPrompt = `Please fix this code and explain the changes:\n\n${storedCode}`;
    } else if (prompt.startsWith('/explain')) {
      finalPrompt = `Please explain this code:\n\n${storedCode}`;
    } else if (prompt.startsWith('/test')) {
      finalPrompt = `Please write test cases for this code:\n\n${storedCode}`;
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
    const res = await fetch(LOCAL_OLLAMA + `/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: state.model,
        messages: state.messages,
        stream: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    // Clear the stored code after sending
    storedCode = '';
    vscode.postMessage({
      type: 'clearStoredCode'
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
      if (done){ 
        break;
      }
      const text = new TextDecoder().decode(value);
      const lines = text.split('\n');

      for (const line of lines) {
        if (!line.trim()){ 
          continue;
        }
        try {
          const chunk = JSON.parse(line);
          if (chunk.message && chunk.message.content) {
            responseMessage.content += chunk.message.content;
            throttledDrawFeed();
          }
        } catch (parseError) {
          console.warn('Failed to parse chunk:', parseError);
          continue;
        }
      }
    }
  } catch (error) {
    console.error("Error:", error);
    const errorMessage = document.createElement("div");
    errorMessage.classList.add("message", "message__error");
    errorMessage.textContent = `Error: ${error.message}`;
    $feed.appendChild(errorMessage);
  } finally {
    setLoading(false);
  }
}

// Draws the model picker with models from the state
function drawModelPicker() {
  $models.innerHTML = "";

  for (const model of state.models) {
    const $opt = document.createElement("option");
    $opt.innerText = model;
    $opt.value = model;
    $models.appendChild($opt);
  }
}

// Retrieves a list of locally isntalled models and updates the state
async function getModels() {
  setLoading(true);
  const res = await fetch(LOCAL_OLLAMA + `/api/tags`);
  const body = await res.json();
  console.log(res, body);
  state.models = body.models.map((m) => m.name);
  state.model = state.model ?? state.models[0];
  drawModelPicker();
  setLoading(false);
}

// Add this at the top with other event listeners
document.getElementById("clear-button").addEventListener("click", function() {
  // Clear chat history
  state.messages = [];
  // Clear stored code
  storedCode = '';

  // Clear the prompt input
  document.getElementById("prompt").value = '';
  // Inform extension to clear stored code
  vscode.postMessage({
    type: 'clearStoredCode'
  });
});
