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

async function loadRelease() {
  try {
    const response = await fetch("/api/release", {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Release lookup failed.");
    const release = await response.json();
    const status = document.getElementById("release-status");
    if (!release.available) {
      status.textContent =
        "The build is taking a breather. Grab the source or check back shortly.";
      for (const link of document.querySelectorAll("[data-download]")) {
        link.href = "https://github.com/M-ax/strife";
        link.firstChild.textContent = "Get the source ";
      }
      return;
    }
    document.getElementById("release-info").textContent =
      "v" +
      release.version +
      " · Windows x64 · " +
      (release.bytes / 1_000_000).toFixed(1) +
      " MB";
    const checksum = document.getElementById("checksum");
    checksum.textContent = release.sha256;
    document.getElementById("checksum-details").hidden = false;
    document
      .getElementById("copy-checksum")
      .addEventListener("click", async () => {
        const feedback = document.getElementById("copy-status");
        try {
          await navigator.clipboard.writeText(release.sha256);
          feedback.textContent = "Checksum copied.";
          document.getElementById("copy-checksum").firstChild.textContent =
            "Copied ";
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
  } catch {
    document.getElementById("release-status").textContent =
      "Couldn't check the latest build. You can still try the download above.";
  }
}
loadRelease();
