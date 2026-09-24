const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { generateUpiQrBuffer, DEFAULT_UPI_ID, DEFAULT_MERCHANT_NAME } = require('../utils/upiQrGenerator');

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

let sock = null;
let botStatus = {
  connected: false,
  status: isServerless ? 'serverless_disabled' : 'disconnected', // 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'serverless_disabled'
  qrCodeDataUrl: null,
  phoneNumber: null,
  lastUpdated: new Date(),
};

const AUTH_DIR = path.join(__dirname, '..', 'whatsapp_auth');

/**
 * Initialize Baileys WhatsApp Bot
 */
async function initWhatsAppBot() {
  if (isServerless) {
    console.log('[WhatsApp Bot] Serverless environment detected. WhatsApp bot daemon disabled.');
    botStatus.status = 'serverless_disabled';
    return;
  }

  try {
    let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, pino, QRCode, qrcodeTerminal;
    try {
      const baileys = require('@whiskeysockets/baileys');
      makeWASocket = baileys.default || baileys.makeWASocket;
      useMultiFileAuthState = baileys.useMultiFileAuthState;
      DisconnectReason = baileys.DisconnectReason;
      fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
      pino = require('pino');
      QRCode = require('qrcode');
      qrcodeTerminal = require('qrcode-terminal');
    } catch (importErr) {
      console.warn('[WhatsApp Bot] Baileys or QR dependencies could not be loaded in this environment:', importErr.message);
      botStatus.status = 'failed';
      return;
    }

    try {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
    } catch (fsErr) {
      console.warn('[WhatsApp Bot] Could not create auth directory:', fsErr.message);
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[WhatsApp Bot] Initializing with Baileys v${version.join('.')} (Latest: ${isLatest})`);

    botStatus.status = 'connecting';
    botStatus.lastUpdated = new Date();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Shanmukha Stores', 'Chrome', '1.0.0'],
      syncFullHistory: false,
    });

    // Save auth credentials whenever updated
    sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        botStatus.connected = false;
        botStatus.status = 'qr_ready';
        botStatus.lastUpdated = new Date();

        try {
          botStatus.qrCodeDataUrl = await QRCode.toDataURL(qr, { scale: 8, margin: 2 });
        } catch (e) {
          botStatus.qrCodeDataUrl = null;
        }

        console.log('\n======================================================');
        console.log('📲 SCAN THIS QR CODE IN WHATSAPP TO CONNECT THE BOT:');
        console.log('   (WhatsApp > Settings > Linked Devices > Link a Device)');
        console.log('======================================================\n');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('\n======================================================\n');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        botStatus.connected = false;
        botStatus.status = 'disconnected';
        botStatus.phoneNumber = null;
        botStatus.lastUpdated = new Date();

        console.log(`[WhatsApp Bot] Connection closed. Reason code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(initWhatsAppBot, 5000);
        } else {
          console.log('[WhatsApp Bot] Logged out. Clearing credentials to allow fresh QR scan...');
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch (err) {}
          setTimeout(initWhatsAppBot, 3000);
        }
      } else if (connection === 'open') {
        const userJid = sock.user?.id || '';
        const phone = userJid.split(':')[0] || userJid.split('@')[0];
        botStatus.connected = true;
        botStatus.status = 'connected';
        botStatus.qrCodeDataUrl = null;
        botStatus.phoneNumber = phone;
        botStatus.lastUpdated = new Date();

        console.log(`\n✅ [WhatsApp Bot] Connected successfully! Linked Phone: +${phone}\n`);
      }
    });

    // Listen for incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Skip messages sent by the bot itself or status broadcasts
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;

        const fromJid = msg.key.remoteJid;

        // Extract text content from message
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';

        if (!text) continue;

        // Detect Order ID in message (e.g. #ORD-1048 or Order ID: #1048)
        const orderMatch =
          text.match(/#ORD-(\d+)/i) ||
          text.match(/Invoice No:\*?\s*#?ORD?-?(\d+)/i) ||
          text.match(/Order ID:\*?\s*#?(\d+)/i);

        if (!orderMatch) continue;

        const orderId = orderMatch[1];
        console.log(`[WhatsApp Bot] Detected Order #${orderId} from ${fromJid}`);

        try {
          // Look up order in database
          const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
          if (orderRes.rows.length === 0) {
            console.log(`[WhatsApp Bot] Order #${orderId} not found in database.`);
            continue;
          }

          const order = orderRes.rows[0];
          const totalAmount = Number(order.total_amount);

          // Get merchant settings if available
          let upiId = DEFAULT_UPI_ID;
          let storeName = DEFAULT_MERCHANT_NAME;
          try {
            const settingsRes = await pool.query(
              "SELECT setting_key, setting_value FROM store_settings WHERE setting_key IN ('merchant_upi_id', 'store_name')"
            );
            settingsRes.rows.forEach((r) => {
              if (r.setting_key === 'merchant_upi_id' && r.setting_value) upiId = r.setting_value;
              if (r.setting_key === 'store_name' && r.setting_value) storeName = r.setting_value;
            });
          } catch (e) {}

          // Generate dynamic QR buffer with amount locked in
          const qrData = await generateUpiQrBuffer({
            upiId,
            merchantName: storeName,
            amount: totalAmount,
            orderId: order.id,
          });

          if (!qrData || !qrData.buffer) {
            console.error(`[WhatsApp Bot] Failed to generate QR buffer for Order #${order.id}`);
            continue;
          }

          const formattedAmount = totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 });

          // Build automated response
          const caption =
`🛍️ *${storeName.toUpperCase()}* | *Order #ORD-${order.id}*
💰 *Amount Due:* ₹${formattedAmount}

📲 *Pay via UPI:*
• Scan the dynamic QR code above, OR
👉 *Tap to Pay:* ${qrData.upiUri}
• UPI ID: \`${upiId}\`

📸 *Please reply with your payment screenshot / UTR to dispatch order.* 🚚✨`;

          // Send QR Code Image with caption directly into WhatsApp chat
          await sock.sendMessage(
            fromJid,
            {
              image: qrData.buffer,
              caption,
            },
            { quoted: msg }
          );

          console.log(`[WhatsApp Bot] ✅ Sent Dynamic UPI QR Code to ${fromJid} for Order #${order.id}!`);
        } catch (botErr) {
          console.error(`[WhatsApp Bot] Error replying to Order #${orderId}:`, botErr);
        }
      }
    });
  } catch (err) {
    console.error('[WhatsApp Bot] Initialization error:', err);
    botStatus.status = 'disconnected';
    botStatus.connected = false;
  }
}

/**
 * Get current bot status
 */
function getBotStatus() {
  return botStatus;
}

module.exports = {
  initWhatsAppBot,
  getBotStatus,
};
