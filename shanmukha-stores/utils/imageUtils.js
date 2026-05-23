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

module.exports = { processImageToWebP };
