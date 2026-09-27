const captions = {
  voice: "Your Mumble channels. Same server. New digs.",
  chat: "Channel chat, one pane over. Collapse at will.",
  video: "Helltube gets the big screen. Your taste is on you.",
};
for (const button of document.querySelectorAll("[data-feature]")) {
  button.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[data-feature]"))
      other.setAttribute("aria-pressed", String(other === button));
    document.querySelector(".app-preview").dataset.highlight =
      button.dataset.feature;
    document.getElementById("preview-caption").textContent =
      captions[button.dataset.feature];
  });
}

const sourceUrl = "https://github.com/M-ax/strife";
function unavailable(option, message) {
  option.querySelector("[data-release-status]").textContent = message;
  const link = option.querySelector("[data-download]");
  link.href = sourceUrl;
  link.firstChild.textContent = "Get the source ";
  option.querySelector("[data-checksum-details]").hidden = true;
}

async function loadRelease() {
  const options = document.querySelectorAll("[data-release]");
  try {
    const response = await fetch("/api/release", {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Release lookup failed.");
    const release = await response.json();
    for (const option of options) {
      const item = release.downloads?.find(
        (item) => item.id === option.dataset.release,
      );
      if (!item?.available) {
        unavailable(
          option,
          "This build is temporarily unavailable. Grab the source or check back shortly.",
        );
        continue;
      }
      option.querySelector("[data-release-info]").textContent =
        "v" +
        release.version +
        " · " +
        item.platform +
        " · " +
        (item.bytes / 1_000_000).toFixed(1) +
        " MB";
      const checksum = option.querySelector("[data-checksum]");
      checksum.textContent = item.sha256;
      option.querySelector("[data-checksum-details]").hidden = false;
      option
        .querySelector("[data-copy-checksum]")
        .addEventListener("click", async (event) => {
          const button = event.currentTarget;
          const feedback = option.querySelector("[data-copy-status]");
          try {
            await navigator.clipboard.writeText(item.sha256);
            feedback.textContent = "Checksum copied.";
            button.firstChild.textContent = "Copied ";
          } catch {
            feedback.textContent =
              "Copy unavailable. Select the checksum above to copy it manually.";
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(checksum);
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
        });
    }
  } catch {
    for (const option of options) {
      option.querySelector("[data-release-status]").textContent =
        "Couldn't check this build. You can still try the download above.";
    }
  }
}
loadRelease();
