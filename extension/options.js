const DEFAULTS = {
  showThumbnail: true,
};

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("showThumbnail").checked = Boolean(stored.showThumbnail);
}

async function save() {
  const showThumbnail = document.getElementById("showThumbnail").checked;
  await chrome.storage.sync.set({ showThumbnail });
  const status = document.getElementById("status");
  status.textContent = "保存しました。再生中なら少しシークすると反映されます。";
  setTimeout(() => {
    status.textContent = "";
  }, 2500);
}

document.getElementById("showThumbnail").addEventListener("change", save);
load();
