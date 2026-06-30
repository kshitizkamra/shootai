// Web stub — file operations handled by browser download in web version
export async function saveToOutput(base64, productName, modelType, shotType) {
  const filename = `${(productName||'product').replace(/[^a-zA-Z0-9]/g,'_')}_${(shotType||'shot').replace(/[^a-zA-Z0-9]/g,'_')}_${Date.now()}.png`;
  await window.electronAPI.saveFile(base64, filename);
  return `downloaded/${filename}`;
}
export function getExt() { return 'jpg'; }
export async function saveToLibrary() { return ''; }
export async function saveBase64ToLibrary() { return ''; }
