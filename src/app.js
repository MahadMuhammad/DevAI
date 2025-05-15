// const LOCAL_OLLAMA = "http://127.0.0.1:11434";
const LOCAL_OLLAMA = "http://74.225.223.193:11435";
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
let storedCode = "";

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
    
    // Parse the message content with marked
    $body.innerHTML = marked.parse(message.content, { gfm: false });
    
    $message.appendChild($title);
    $message.appendChild($body);
    $feed.appendChild($message);
    
    // Add copy buttons to all code blocks if this is an assistant message
    if (message.role === "assistant") {
      // First, properly handle pre blocks which contain actual code blocks
      const preBlocks = $message.querySelectorAll('pre');
      preBlocks.forEach((preBlock, index) => {
        // Create a wrapper if it's not already in one
        let wrapper;
        if (preBlock.parentElement.classList.contains('code-block')) {
          wrapper = preBlock.parentElement;
        } else {
          wrapper = document.createElement('div');
          wrapper.classList.add('code-block');
          preBlock.parentNode.insertBefore(wrapper, preBlock);
          wrapper.appendChild(preBlock);
        }
        
        // Create header with copy and insert buttons
        const header = document.createElement('div');
        header.classList.add('code-block-header');
        
        // Add copy button
        const copyButton = document.createElement('button');
        copyButton.classList.add('copy-button');
        copyButton.textContent = 'Copy';
        copyButton.dataset.index = index;
        copyButton.addEventListener('click', function() {
          const code = this.parentElement.nextElementSibling.textContent;
          copyToClipboard(code, this);
        });
        
        // Add insert button
        const insertButton = document.createElement('button');
        insertButton.classList.add('insert-button');
        insertButton.textContent = 'Insert';
        insertButton.dataset.index = index;
        insertButton.addEventListener('click', function() {
          const code = this.parentElement.nextElementSibling.textContent;
          insertAtCursor(code, this);
        });
        
        header.appendChild(copyButton);
        header.appendChild(insertButton);
        wrapper.insertBefore(header, preBlock);
      });
      
      // Then handle standalone code blocks (code elements that are not inside pre)
      const standaloneCodeBlocks = $message.querySelectorAll('code:not(pre code)');
      standaloneCodeBlocks.forEach((codeBlock, index) => {
        // Only wrap code blocks that are not inline (have their own paragraph)
        if (codeBlock.parentElement.tagName === 'P' && 
            codeBlock.parentElement.childNodes.length === 1 &&
            codeBlock.textContent.length > 20) { // Only add for substantial code blocks
        
          // Create a wrapper if it's not already in one
          let wrapper;
          if (codeBlock.parentElement.classList.contains('code-block')) {
            wrapper = codeBlock.parentElement;
          } else {
            wrapper = document.createElement('div');
            wrapper.classList.add('code-block');
            codeBlock.parentNode.insertBefore(wrapper, codeBlock);
            wrapper.appendChild(codeBlock);
          }
          
          // Create header with copy and insert buttons
          const header = document.createElement('div');
          header.classList.add('code-block-header');
          
          // Add copy button
          const copyButton = document.createElement('button');
          copyButton.classList.add('copy-button');
          copyButton.textContent = 'Copy';
          copyButton.dataset.index = index;
          copyButton.addEventListener('click', function() {
            const code = this.parentElement.nextElementSibling.textContent;
            copyToClipboard(code, this);
          });
          
          // Add insert button
          const insertButton = document.createElement('button');
          insertButton.classList.add('insert-button');
          insertButton.textContent = 'Insert';
          insertButton.dataset.index = index;
          insertButton.addEventListener('click', function() {
            const code = this.parentElement.nextElementSibling.textContent;
            insertAtCursor(code, this);
          });
          
          header.appendChild(copyButton);
          header.appendChild(insertButton);
          wrapper.insertBefore(header, codeBlock);
        }
      });
    }
  }
  
  // Scroll to the bottom of the feed
  $feed.scrollTop = $feed.scrollHeight;
}

// Function to copy text to clipboard
function copyToClipboard(text, button) {
  // Trim any extra whitespace
  const codeToCopy = text.trim();
  
  // Copy to clipboard using the Clipboard API
  navigator.clipboard.writeText(codeToCopy).then(
    function() {
      // Success feedback
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      button.classList.add('copy-success');
      
      // Reset after 1.5 seconds
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('copy-success');
      }, 1500);
    }, 
    function(err) {
      console.error('Could not copy text: ', err);
      
      // Fallback for browsers that don't support clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = codeToCopy;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      
      try {
        textarea.select();
        const successful = document.execCommand('copy');
        
        if (successful) {
          const originalText = button.textContent;
          button.textContent = 'Copied!';
          button.classList.add('copy-success');
          
          setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('copy-success');
          }, 1500);
        } else {
          button.textContent = 'Failed';
          setTimeout(() => {
            button.textContent = 'Copy';
          }, 1500);
        }
      } catch (err) {
        console.error('Fallback: Could not copy text: ', err);
        button.textContent = 'Failed';
        setTimeout(() => {
          button.textContent = 'Copy';
        }, 1500);
      }
      
      document.body.removeChild(textarea);
    }
  );
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
      break;
    case "insertError":
      // Show error in feed if provided
      if (message.message) {
        const errorMessage = document.createElement("div");
        errorMessage.classList.add("message", "message__error");
        errorMessage.textContent = `Error: ${message.message}`;
        $feed.appendChild(errorMessage);
        
        // Scroll to the bottom to show the error
        $feed.scrollTop = $feed.scrollHeight;
      }
      break;
    case "insertSuccess":
      // Optional: Could add a quick success toast/notification here
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
  if (
    prompt.startsWith("/fix") ||
    prompt.startsWith("/explain") ||
    prompt.startsWith("/test")
  ) {
    if (!storedCode) {
      vscode.postMessage({
        type: "error",
        message: "No code selected. Please select code first.",
      });
      return;
    }

    if (prompt.startsWith("/fix")) {
      finalPrompt = `Identify and correct only syntax and logical errors in the following code.
      Rules:
      Focus solely on fixing syntax errors, incorrect variables, and logical mistakes.
      Ensure there are no remaining errors after your fix.
      Return only the corrected code without any explanations.
      Provide a list of the errors you found before presenting the corrected code.
      Code:\n\n${storedCode}`;
    } else if (prompt.startsWith("/explain")) {
      finalPrompt = `Please explain this code:\n\n${storedCode}`;
    } else if (prompt.startsWith("/test")) {
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
          console.warn("Failed to parse chunk:", parseError);
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
document.getElementById("clear-button").addEventListener("click", function () {
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
});

// Function to insert code at the current cursor position in the editor
function insertAtCursor(text, button) {
  // Trim any extra whitespace
  const codeToInsert = text.trim();
  
  // Show loading state
  const originalText = button.textContent;
  button.textContent = 'Inserting...';
  
  // Send message to extension to insert code at cursor
  vscode.postMessage({
    type: 'insertAtCursor',
    code: codeToInsert
  });
  
  // Set up a listener for the response, but only for this specific insertion
  const messageHandler = (event) => {
    const message = event.data;
    if (message.type === 'insertSuccess') {
      // Show success feedback
      button.textContent = 'Inserted!';
      button.classList.add('insert-success');
      
      // Remove this specific listener after handling the response
      window.removeEventListener('message', messageHandler);
      
      // Reset after 1.5 seconds
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('insert-success');
      }, 1500);
    } 
    else if (message.type === 'insertError') {
      // Show error feedback on the button
      button.textContent = 'Failed';
      
      // Remove this specific listener after handling the response
      window.removeEventListener('message', messageHandler);
      
      // Reset after 1.5 seconds
      setTimeout(() => {
        button.textContent = originalText;
      }, 1500);
    }
  };
  
  window.addEventListener('message', messageHandler);
  
  // Set a timeout to remove the listener and reset the button if no response
  setTimeout(() => {
    window.removeEventListener('message', messageHandler);
    if (button.textContent === 'Inserting...') {
      button.textContent = originalText;
    }
  }, 3000);
}
