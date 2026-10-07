// ============================================
// IMAGE COMPRESSOR - Nén ảnh khung
// ============================================
const ImageCompressor = (() => {
  const MAX_WIDTH = 1200;
  const MAX_HEIGHT = 1600;
  const QUALITY = 0.85;

  async function compressFrame(file) {
    const originalDataUrl = await fileToDataUrl(file);
    const img = await loadImage(originalDataUrl);

    let newWidth = img.naturalWidth;
    let newHeight = img.naturalHeight;

    if (newWidth > MAX_WIDTH) {
      newHeight = Math.round(newHeight * (MAX_WIDTH / newWidth));
      newWidth = MAX_WIDTH;
    }
    if (newHeight > MAX_HEIGHT) {
      newWidth = Math.round(newWidth * (MAX_HEIGHT / newHeight));
      newHeight = MAX_HEIGHT;
    }

    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, newWidth, newHeight);

    let compressedDataUrl = canvas.toDataURL('image/webp', QUALITY);
    let mime = 'image/webp';

    if (!compressedDataUrl.startsWith('data:image/webp')) {
      compressedDataUrl = canvas.toDataURL('image/png');
      mime = 'image/png';
    }

    let attempts = 0;
    let quality = QUALITY;
    while (compressedDataUrl.length > 500 * 1024 * 1.37 && attempts < 5) {
      quality -= 0.1;
      if (quality < 0.5) break;
      compressedDataUrl = canvas.toDataURL('image/webp', quality);
      attempts++;
    }

    attempts = 0;
    while (compressedDataUrl.length > 1024 * 1024 * 1.37 && attempts < 3 && newWidth > 600) {
      newWidth = Math.round(newWidth * 0.8);
      newHeight = Math.round(newHeight * 0.8);
      canvas.width = newWidth;
      canvas.height = newHeight;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      compressedDataUrl = canvas.toDataURL('image/webp', quality);
      attempts++;
    }

    const originalSize = file.size;
    const compressedSize = Math.round((compressedDataUrl.length - 22) * 3 / 4);

    return {
      dataUrl: compressedDataUrl,
      originalSize,
      compressedSize,
      width: newWidth,
      height: newHeight,
      mime,
      ratio: ((1 - compressedSize / originalSize) * 100).toFixed(1),
    };
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không load được ảnh'));
      img.src = src;
    });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  return { compressFrame, formatSize };
})();

window.ImageCompressor = ImageCompressor;