const nodemailer = require("nodemailer");
const pool = require("../config/db");

// ============================================================
// CREATE TRANSPORTER & HELPERS
// ============================================================

const createTransporter = () => {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const STORE_NAME = "Shanmukha Stores";

// ============================================================
// SEND EMAIL VERIFICATION
// ============================================================
const sendVerificationEmail = async (email, name, token) => {
  const transporter = createTransporter();
  const verifyUrl = `${BASE_URL}/auth/verify-email?token=${token}`;

  const mailOptions = {
    from: `"${STORE_NAME}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Verify your email – ${STORE_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c7a4b;">Welcome to ${STORE_NAME}!</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" 
             style="background-color: #2c7a4b; color: white; padding: 14px 28px; 
                    text-decoration: none; border-radius: 6px; font-size: 16px; display: inline-block;">
            Verify Email
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #2c7a4b;">${verifyUrl}</p>
        <p style="color: #666; font-size: 13px; margin-top: 30px;">
          This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;">
        <p style="color: #999; font-size: 12px; text-align: center;">${STORE_NAME} · Vijayawada</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
  console.log(`✅ Verification email sent to ${email}`);
};

// ============================================================
// SEND PASSWORD RESET EMAIL
// ============================================================
const sendPasswordResetEmail = async (email, name, token) => {
  const transporter = createTransporter();
  const resetUrl = `${BASE_URL}/auth/reset-password?token=${token}`;

  const mailOptions = {
    from: `"${STORE_NAME}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Reset your password – ${STORE_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #c0392b;">Password Reset Request</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>We received a request to reset your password. Click the button below to set a new password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" 
             style="background-color: #c0392b; color: white; padding: 14px 28px; 
                    text-decoration: none; border-radius: 6px; font-size: 16px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #c0392b;">${resetUrl}</p>
        <p style="color: #666; font-size: 13px; margin-top: 30px;">
          This link will expire in <strong>1 hour</strong>. If you did not request a password reset, 
          please ignore this email — your password will remain unchanged.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;">
        <p style="color: #999; font-size: 12px; text-align: center;">${STORE_NAME} · Vijayawada</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
  console.log(`✅ Password reset email sent to ${email}`);
};

// ============================================================
// SEND ORDER CONFIRMATION EMAIL
// ============================================================
const sendOrderConfirmationEmail = async (email, name, order, items) => {
  const transporter = createTransporter();

  const itemsHtml = items
    .map(
      (item) =>
        `<tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">₹${Number(item.price).toFixed(2)}</td>
        </tr>`
    )
    .join("");

  const mailOptions = {
    from: `"${STORE_NAME}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Order Confirmed #${order.id} – ${STORE_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c7a4b;">Order Confirmed! 🎉</h2>
        <p>Hi <strong>${name}</strong>, thank you for your order!</p>
        <p><strong>Order ID:</strong> #${order.id}</p>
        <p><strong>Status:</strong> ${order.status}</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f5f5f5;">
              <th style="padding: 8px; text-align: left;">Product</th>
              <th style="padding: 8px; text-align: center;">Qty</th>
              <th style="padding: 8px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding: 8px; font-weight: bold; text-align: right;">Total:</td>
              <td style="padding: 8px; font-weight: bold; text-align: right;">₹${Number(order.total_amount).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <p style="color: #666; font-size: 13px; margin-top: 30px;">We'll notify you when your order is shipped.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;">
        <p style="color: #999; font-size: 12px; text-align: center;">${STORE_NAME} · Vijayawada</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
  console.log(`✅ Order confirmation email sent to ${email}`);
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
};