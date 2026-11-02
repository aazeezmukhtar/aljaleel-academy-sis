/**
 * AcadMe browser-side image optimization.
 *
 * Runs before existing upload handlers so image files are resized/compressed
 * before they enter FormData or a native multipart form submission.
 * Documents and unsupported/animated image formats are left untouched.
 */
(() => {
    'use strict';

    const MAX_DIMENSION = 1600;
    const COMPRESS_ABOVE_BYTES = 350 * 1024;
    const JPEG_QUALITY = 0.82;
    const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const processing = new WeakSet();

    function decodeImage(file) {
        if (typeof createImageBitmap === 'function') {
            return createImageBitmap(file).then(bitmap => ({
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                cleanup: () => bitmap.close()
            }));
        }

        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => resolve({
                source: image,
                width: image.naturalWidth,
                height: image.naturalHeight,
                cleanup: () => URL.revokeObjectURL(url)
            });
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('The selected image could not be decoded.'));
            };
            image.src = url;
        });
    }

    function canvasBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('The browser could not encode the image.'));
            }, type, quality);
        });
    }

    async function optimizeImage(file) {
        if (!file || !SUPPORTED_TYPES.has(file.type)) return file;

        let decoded;
        try {
            decoded = await decodeImage(file);
            const { source, width, height } = decoded;
            if (!width || !height) return file;

            const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
            const needsResize = scale < 1;
            const needsCompression = file.size > COMPRESS_ABOVE_BYTES;
            if (!needsResize && !needsCompression) return file;

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const context = canvas.getContext('2d');
            if (!context) return file;

            context.drawImage(source, 0, 0, canvas.width, canvas.height);

            // Keep PNG as PNG so transparent logos and graphics remain transparent.
            // JPEG/WebP photos are normalized to JPEG for broad upload compatibility.
            const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
            const blob = await canvasBlob(
                canvas,
                outputType,
                outputType === 'image/jpeg' ? JPEG_QUALITY : undefined
            );

            // Never replace a file with a larger encoded result.
            if (!blob || blob.size >= file.size) return file;

            const extension = outputType === 'image/png' ? '.png' : '.jpg';
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
            return new File([blob], baseName + extension, {
                type: outputType,
                lastModified: Date.now()
            });
        } catch (error) {
            console.warn('[AcadMe image optimizer] Keeping original file:', error);
            return file;
        } finally {
            if (decoded && decoded.cleanup) decoded.cleanup();
        }
    }

    document.addEventListener('change', async event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files) return;
        if (input.dataset.imageOptimizerReplay === 'true') {
            delete input.dataset.imageOptimizerReplay;
            return;
        }

        const selectedFiles = Array.from(input.files);
        if (!selectedFiles.some(file => SUPPORTED_TYPES.has(file.type))) return;
        if (processing.has(input)) return;

        processing.add(input);
        // Pause downstream change handlers (including instant-submit profile forms)
        // until optimized files have replaced the originals.
        event.stopImmediatePropagation();

        try {
            const optimizedFiles = await Promise.all(selectedFiles.map(optimizeImage));
            const transfer = new DataTransfer();
            optimizedFiles.forEach(file => transfer.items.add(file));
            input.files = transfer.files;
        } catch (error) {
            console.warn('[AcadMe image optimizer] Could not replace selected files:', error);
            // If replacement is unsupported, existing handlers still receive the originals.
        } finally {
            processing.delete(input);
            input.dataset.imageOptimizerReplay = 'true';
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, true);
})();
