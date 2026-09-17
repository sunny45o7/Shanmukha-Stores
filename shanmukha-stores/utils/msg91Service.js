const process = require('process');

/**
 * Normalizes an Indian mobile number to include the 91 prefix if it's 10 digits.
 * @param {string} mobile 
 * @returns {string} Normalized mobile number
 */
const normalizeMobile = (mobile) => {
  let cleaned = mobile.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return '91' + cleaned;
  }
  return cleaned;
};

/**
 * Sends an OTP using MSG91
 * @param {string} mobile The mobile number to send the OTP to
 * @returns {Promise<Object>} The response from MSG91
 */
const sendOTP = async (mobile) => {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;

  if (!authKey || !templateId) {
    console.warn("MSG91_AUTH_KEY or MSG91_TEMPLATE_ID is missing. OTP not sent.");
    // Return a mock success response for local development if keys are missing
    if (process.env.NODE_ENV === 'development') {
        return { type: "success", message: "Mock OTP sent (Dev Mode: Enter 1234)" };
    }
    throw new Error("OTP Service configuration is missing.");
  }

  const normalizedMobile = normalizeMobile(mobile);
  const url = `https://control.msg91.com/api/v5/otp?template_id=${templateId}&mobile=${normalizedMobile}&authkey=${authKey}`;

  try {
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();
    
    if (data.type === 'error') {
      throw new Error(data.message || 'Failed to send OTP');
    }
    return data;
  } catch (error) {
    console.error("MSG91 sendOTP error:", error);
    throw error;
  }
};

/**
 * Verifies an OTP using MSG91
 * @param {string} mobile The mobile number
 * @param {string} otp The OTP entered by the user
 * @returns {Promise<Object>} The response from MSG91
 */
const verifyOTP = async (mobile, otp) => {
  const authKey = process.env.MSG91_AUTH_KEY;
  
  if (!authKey) {
    // Return a mock success response for local development if keys are missing
    if (process.env.NODE_ENV === 'development') {
        if (otp === '1234') {
            return { type: "success", message: "Mock OTP verified (Dev Mode)" };
        }
        throw new Error("Invalid OTP (In development mode, use 1234)");
    }
    throw new Error("OTP Service configuration is missing.");
  }

  const normalizedMobile = normalizeMobile(mobile);
  const url = `https://control.msg91.com/api/v5/otp/verify?otp=${otp}&mobile=${normalizedMobile}&authkey=${authKey}`;

  try {
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    if (data.type === 'error') {
      throw new Error(data.message || 'Invalid OTP');
    }
    return data;
  } catch (error) {
    console.error("MSG91 verifyOTP error:", error);
    throw error;
  }
};

module.exports = {
  sendOTP,
  verifyOTP
};
