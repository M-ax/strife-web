// Progressive enhancement: instructions and downloads remain usable without JS.
for (const [index, block] of [
  ...document.querySelectorAll("pre[data-copy]"),
].entries()) {
  const tools = document.createElement("div");
  tools.className = "code-tools";
  const feedback = document.createElement("span");
  feedback.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Copy commands";
  button.setAttribute("aria-label", `Copy command block ${index + 1}`);
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(block.textContent.trim() + "\n");
      feedback.textContent = "Copied.";
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(block);
      selection?.removeAllRanges();
      selection?.addRange(range);
      feedback.textContent = "Commands selected. Copy them manually.";
    }
  });
  tools.append(feedback, button);
  block.after(tools);
}
