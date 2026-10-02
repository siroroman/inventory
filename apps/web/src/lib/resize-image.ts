/** The longest side of an uploaded photo, in pixels: plenty to read a document, small enough to upload on mobile data. */
export const MAX_IMAGE_SIDE = 2048;

/**
 * Re-draws an image as a JPEG of at most 2048 px on its longest side. Drawing it again also drops
 * everything else in the file, including the EXIF block with the GPS position, and applies the
 * camera's rotation. Rejects when the browser cannot decode the image.
 */
export async function resizeImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    // JPEG has no transparency: a transparent PNG would turn black.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No image'))), 'image/jpeg', 0.85),
    );
  } finally {
    bitmap.close();
  }
}
