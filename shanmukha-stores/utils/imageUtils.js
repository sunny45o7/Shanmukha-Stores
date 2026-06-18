const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

/**
 * Processes an image buffer into a compressed WebP file.
 * @param {Buffer} buffer - The image data as a buffer.
 * @param {string} uploadDir - The directory to save the file in.
 * @param {string} filenameBase - The base filename (without extension).
 * @returns {Promise<string>} - The relative path to the saved WebP file.
 */
async function processImageToWebP(buffer, uploadDir, filenameBase) {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `${filenameBase}.webp`;
    const outputPath = path.join(uploadDir, filename);

    await sharp(buffer)
        .webp({ quality: 80 }) // 80 is a good balance for e-commerce
        .toFile(outputPath);

    // Return the relative path from the 'public' directory
    // Existing code uses /uploads/... format
    const relativePath = outputPath.split(path.join('public', path.sep)).pop().replace(/\\/g, '/');
    return `/${relativePath}`;
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
        fs.mkdirSync(uploadDir, { recursive: true });
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
