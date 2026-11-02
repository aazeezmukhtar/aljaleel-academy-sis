/**
 * AcadMe browser-side photo cropping and image optimization.
 *
 * Photo inputs marked data-crop="square" open a crop editor first.
 * The crop is then resized/compressed before existing upload handlers run.
 * Other supported image attachments are optimized without forcing a crop.
 */
(() => {
    'use strict';

    const MAX_DIMENSION = 1600;
    const CROP_OUTPUT_SIZE = 1200;
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

    function makeFile(blob, original, type) {
        const extension = type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg';
        const baseName = original.name.replace(/\.[^.]+$/, '') || 'photo';
        return new File([blob], baseName + extension, {
            type,
            lastModified: Date.now()
        });
    }

    function ensureCropStyles() {
        if (document.getElementById('acadme-cropper-styles')) return;
        const style = document.createElement('style');
        style.id = 'acadme-cropper-styles';
        style.textContent = `
            .acm-crop-backdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,20,30,.72)}
            .acm-crop-dialog{width:min(100%,440px);padding:20px;background:#fff;color:#172033;border-radius:16px;box-shadow:0 20px 70px rgba(0,0,0,.3);font:inherit}
            .acm-crop-dialog h2{margin:0 0 6px;font-size:1.2rem}
            .acm-crop-help{margin:0 0 14px;color:#64748b;font-size:.9rem}
            .acm-crop-stage{width:min(100%,360px);aspect-ratio:1/1;margin:0 auto 16px;overflow:hidden;border-radius:10px;background:#e2e8f0;touch-action:none;cursor:grab}
            .acm-crop-stage:active{cursor:grabbing}
            .acm-crop-stage canvas{display:block;width:100%;height:100%}
            .acm-crop-zoom{display:flex;align-items:center;gap:12px;margin:0 0 18px;font-size:.9rem}
            .acm-crop-zoom input{flex:1;min-width:0}
            .acm-crop-actions{display:flex;justify-content:flex-end;gap:10px}
            .acm-crop-actions button{border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}
            .acm-crop-cancel{background:#e2e8f0;color:#1e293b}
            .acm-crop-confirm{background:#1d4ed8;color:#fff}
            @media(max-width:420px){.acm-crop-dialog{padding:16px}.acm-crop-actions button{flex:1}}
        `;
        document.head.appendChild(style);
    }

    function cropImage(file) {
        return new Promise(async (resolve, reject) => {
            let decoded;
            let settled = false;
            try {
                decoded = await decodeImage(file);
                const { source, width, height } = decoded;
                const size = 360;
                const baseScale = Math.max(size / width, size / height);
                let zoom = 1;
                let offsetX = (size - width * baseScale) / 2;
                let offsetY = (size - height * baseScale) / 2;

                ensureCropStyles();
                const backdrop = document.createElement('div');
                backdrop.className = 'acm-crop-backdrop';
                backdrop.innerHTML = `
                    <section class="acm-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="acm-crop-title">
                        <h2 id="acm-crop-title">Crop photograph</h2>
                        <p class="acm-crop-help">Move the image to position it. Use the slider to zoom in or out.</p>
                        <div class="acm-crop-stage"><canvas width="360" height="360" aria-label="Square crop preview"></canvas></div>
                        <label class="acm-crop-zoom">Zoom <input type="range" min="1" max="3" step="0.01" value="1"></label>
                        <div class="acm-crop-actions">
                            <button type="button" class="acm-crop-cancel">Cancel</button>
                            <button type="button" class="acm-crop-confirm">Use this photo</button>
                        </div>
                    </section>`;
                document.body.appendChild(backdrop);

                const canvas = backdrop.querySelector('canvas');
                const context = canvas.getContext('2d');
                const stage = backdrop.querySelector('.acm-crop-stage');
                const zoomInput = backdrop.querySelector('input[type="range"]');
                let pointer = null;

                function clampOffsets() {
                    const renderedWidth = width * baseScale * zoom;
                    const renderedHeight = height * baseScale * zoom;
                    offsetX = Math.min(0, Math.max(size - renderedWidth, offsetX));
                    offsetY = Math.min(0, Math.max(size - renderedHeight, offsetY));
                }

                function drawPreview() {
                    clampOffsets();
                    context.clearRect(0, 0, size, size);
                    context.fillStyle = '#e2e8f0';
                    context.fillRect(0, 0, size, size);
                    context.drawImage(source, offsetX, offsetY, width * baseScale * zoom, height * baseScale * zoom);
                }

                function finish(result) {
                    if (settled) return;
                    settled = true;
                    backdrop.remove();
                    if (decoded && decoded.cleanup) decoded.cleanup();
                    resolve(result);
                }

                stage.addEventListener('pointerdown', event => {
                    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
                    stage.setPointerCapture(event.pointerId);
                });
                stage.addEventListener('pointermove', event => {
                    if (!pointer || pointer.id !== event.pointerId) return;
                    const rect = stage.getBoundingClientRect();
                    offsetX += (event.clientX - pointer.x) * size / rect.width;
                    offsetY += (event.clientY - pointer.y) * size / rect.height;
                    pointer.x = event.clientX;
                    pointer.y = event.clientY;
                    drawPreview();
                });
                stage.addEventListener('pointerup', () => { pointer = null; });
                stage.addEventListener('pointercancel', () => { pointer = null; });
                zoomInput.addEventListener('input', () => {
                    const previousZoom = zoom;
                    zoom = Number(zoomInput.value);
                    const factor = zoom / previousZoom;
                    offsetX = size / 2 - (size / 2 - offsetX) * factor;
                    offsetY = size / 2 - (size / 2 - offsetY) * factor;
                    drawPreview();
                });
                backdrop.querySelector('.acm-crop-cancel').addEventListener('click', () => finish(null));
                backdrop.querySelector('.acm-crop-confirm').addEventListener('click', async () => {
                    try {
                        const sourceScale = baseScale * zoom;
                        const sx = Math.max(0, -offsetX / sourceScale);
                        const sy = Math.max(0, -offsetY / sourceScale);
                        const sourceSize = Math.min(size / sourceScale, width - sx, height - sy);
                        const output = document.createElement('canvas');
                        output.width = CROP_OUTPUT_SIZE;
                        output.height = CROP_OUTPUT_SIZE;
                        const outputContext = output.getContext('2d');
                        if (!outputContext || sourceSize <= 0) throw new Error('Invalid crop area.');
                        outputContext.drawImage(
                            source, sx, sy, sourceSize, sourceSize,
                            0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE
                        );
                        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                        const blob = await canvasBlob(
                            output, outputType,
                            outputType === 'image/jpeg' ? 0.9 : undefined
                        );
                        finish(makeFile(blob, file, outputType));
                    } catch (error) {
                        console.warn('[AcadMe image cropper] Could not create crop:', error);
                        finish(null);
                    }
                });

                drawPreview();
                backdrop.querySelector('.acm-crop-confirm').focus();
            } catch (error) {
                if (decoded && decoded.cleanup) decoded.cleanup();
                reject(error);
            }
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
            const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
            const blob = await canvasBlob(
                canvas, outputType,
                outputType === 'image/jpeg' ? JPEG_QUALITY : undefined
            );
            if (!blob || blob.size >= file.size) return file;
            return makeFile(blob, file, outputType);
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
        // Delay existing upload handlers until crop/optimization has finished.
        event.stopImmediatePropagation();

        try {
            let preparedFiles = selectedFiles;
            if (input.dataset.crop === 'square') {
                preparedFiles = [];
                for (const file of selectedFiles) {
                    if (!SUPPORTED_TYPES.has(file.type)) {
                        preparedFiles.push(file);
                        continue;
                    }
                    const cropped = await cropImage(file);
                    // Cancel means cancel this selection; never silently upload the uncropped original.
                    if (!cropped) {
                        input.value = '';
                        return;
                    }
                    preparedFiles.push(cropped);
                }
            }

            const optimizedFiles = await Promise.all(preparedFiles.map(optimizeImage));
            const transfer = new DataTransfer();
            optimizedFiles.forEach(file => transfer.items.add(file));
            input.files = transfer.files;
        } catch (error) {
            console.warn('[AcadMe image optimizer] Keeping original selection:', error);
            // Cropper errors fail safely; keep the selected original files.
        } finally {
            processing.delete(input);
            if (input.files && input.files.length) {
                input.dataset.imageOptimizerReplay = 'true';
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }, true);
})();
