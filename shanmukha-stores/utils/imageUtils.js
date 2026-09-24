let sharp;
try {
    sharp = require('sharp');
} catch (e) {
    console.warn('Notice: sharp native module not loaded in this environment, using raw image fallback');
}
const path = require('path');
const fs = require('fs');

/**
 * Processes an image buffer into a compressed WebP file (or direct image if sharp is unavailable).
 * @param {Buffer} buffer - The image data as a buffer.
 * @param {string} uploadDir - The directory to save the file in.
 * @param {string} filenameBase - The base filename (without extension).
 * @returns {Promise<string>} - The relative path to the saved image file.
 */
async function processImageToWebP(buffer, uploadDir, filenameBase) {
    if (!fs.existsSync(uploadDir)) {
        try {
            fs.mkdirSync(uploadDir, { recursive: true });
        } catch (e) {}
    }

    if (sharp) {
        const filename = `${filenameBase}.webp`;
        const outputPath = path.join(uploadDir, filename);

        await sharp(buffer)
            .webp({ quality: 80 }) // 80 is a good balance for e-commerce
            .toFile(outputPath);

        const relativePath = outputPath.split(path.join('public', path.sep)).pop().replace(/\\/g, '/');
        return `/${relativePath}`;
    } else {
        const filename = `${filenameBase}.jpg`;
        const outputPath = path.join(uploadDir, filename);
        await fs.promises.writeFile(outputPath, buffer);
        const relativePath = outputPath.split(path.join('public', path.sep)).pop().replace(/\\/g, '/');
        return `/${relativePath}`;
    }
}

/**
 * Processes a media file. If it's an image, converts to WebP. If video, saves it directly.
 * @param {Object} file - The multer file object.
 * @param {string} uploadDir - The directory to save the file in.
 * @param {string} filenameBase - The base filename (without extension).
 * @returns {Promise<string>} - The relative path to the saved media file.
 */
async function processMediaFile(file, uploadDir, filenameBase) {
    if (!fs.existsSync(uploadDir)) {
        try {
            fs.mkdirSync(uploadDir, { recursive: true });
        } catch (e) {}
    }

    const isVideo = file.mimetype && file.mimetype.startsWith('video/');
    
    if (isVideo) {
        // Extract extension from originalname or default to mp4
        const ext = path.extname(file.originalname) || '.mp4';
        const filename = `${filenameBase}${ext}`;
        const outputPath = path.join(uploadDir, filename);
        
        await fs.promises.writeFile(outputPath, file.buffer);
        
        const relativePath = outputPath.split(path.join('public', path.sep)).pop().replace(/\\/g, '/');
        return `/${relativePath}`;
    } else {
        // Fallback to image processing
        return await processImageToWebP(file.buffer, uploadDir, filenameBase);
    }
}

module.exports = { processImageToWebP, processMediaFile };
