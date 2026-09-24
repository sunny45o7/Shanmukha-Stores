const QRCode = require('qrcode');

/**
 * Default merchant configurations
 */
const DEFAULT_UPI_ID = '6302603728-pc97@ybl';
const DEFAULT_MERCHANT_NAME = 'Shanmukha Stores';

/**
 * Generate standard UPI Payment Intent URI
 * Format conforms to NPCI UPI specifications
 */
function getUpiPaymentUri({ upiId = DEFAULT_UPI_ID, merchantName = DEFAULT_MERCHANT_NAME, amount, orderId }) {
  const cleanUpi = encodeURIComponent(String(upiId || DEFAULT_UPI_ID).trim());
  const cleanName = encodeURIComponent(String(merchantName || DEFAULT_MERCHANT_NAME).trim());
  const cleanAmount = Number(amount || 0).toFixed(2);
  const note = encodeURIComponent(`Order_ORD_${orderId || 'NEW'}`);

  return `upi://pay?pa=${cleanUpi}&pn=${cleanName}&am=${cleanAmount}&cu=INR&tn=${note}`;
}

/**
 * Generate Dynamic QR code as a Base64 Data URL (PNG)
 */
async function generateUpiQrCode({ upiId = DEFAULT_UPI_ID, merchantName = DEFAULT_MERCHANT_NAME, amount, orderId }) {
  try {
    const upiUri = getUpiPaymentUri({ upiId, merchantName, amount, orderId });

    const qrDataUrl = await QRCode.toDataURL(upiUri, {
      errorCorrectionLevel: 'H',
      margin: 2,
      scale: 8,
      color: {
        dark: '#111827',
        light: '#FFFFFF',
      },
    });

    return {
      upiUri,
      qrDataUrl,
    };
  } catch (err) {
    console.error('Failed to generate UPI QR code:', err);
    return {
      upiUri: getUpiPaymentUri({ upiId, merchantName, amount, orderId }),
      qrDataUrl: null,
    };
  }
}

/**
 * Generate Dynamic QR code as a PNG Buffer
 */
async function generateUpiQrBuffer({ upiId = DEFAULT_UPI_ID, merchantName = DEFAULT_MERCHANT_NAME, amount, orderId }) {
  try {
    const upiUri = getUpiPaymentUri({ upiId, merchantName, amount, orderId });
    const buffer = await QRCode.toBuffer(upiUri, {
      errorCorrectionLevel: 'H',
      type: 'png',
      margin: 2,
      scale: 8,
      color: {
        dark: '#111827',
        light: '#FFFFFF',
      },
    });
    return { upiUri, buffer };
  } catch (err) {
    console.error('Failed to generate UPI QR buffer:', err);
    return null;
  }
}

module.exports = {
  DEFAULT_UPI_ID,
  DEFAULT_MERCHANT_NAME,
  getUpiPaymentUri,
  generateUpiQrCode,
  generateUpiQrBuffer,
};
