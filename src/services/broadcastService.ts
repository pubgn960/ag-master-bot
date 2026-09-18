import fs from 'fs';
import path from 'path';
import { LiveTelegramAdapter } from '../core/adapters/telegram/TelegramAdapter.js';

export interface PromotionBroadcastPayload {
  name: string;
  sale_price: number | string;
  bundle_name?: string;
  expiry_date?: string | Date;
  image_url?: string;
  image_path?: string;
  image_ref?: string;
}

/**
 * Dispatches a promotional photo broadcast to a target Telegram chat.
 * Correctly embeds the promotional details as a photo caption,
 * handles local file streams, public HTTPS URLs, and pins the message if requested.
 */
export async function sendPromotionBroadcast(
  chatId: string | number,
  promo: PromotionBroadcastPayload,
  shouldPin: boolean = false,
  botOrAdapter?: any
) {
  // 1. Build the Caption (Keep under 1024 characters for Telegram photo captions)
  const packageLine = promo.bundle_name ? `• <b>Package:</b> ${promo.bundle_name}\n` : '';
  const expiryLine = promo.expiry_date ? `• <b>Valid Until:</b> ${new Date(promo.expiry_date).toLocaleDateString()}\n` : '';

  const caption = 
`🔥 <b>SPECIAL PROMOTION: ${promo.name}</b> 🔥

${packageLine}• <b>Price:</b> <code>${Number(promo.sale_price).toFixed(2)} USDT</code>
${expiryLine}<i>Send your order details now to claim this rate!</i>`;

  let sentMessage: any;

  // 2. Check if a valid image source exists (URL or local upload path or image_ref)
  const imageSource = promo.image_path || promo.image_url || promo.image_ref;
  const bot = botOrAdapter || (global as any).bot;

  if (bot && bot.telegram) {
    if (imageSource) {
      try {
        if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
          // Send via Public HTTPS URL
          sentMessage = await bot.telegram.sendPhoto(chatId.toString(), imageSource, {
            caption: caption,
            parse_mode: 'HTML'
          });
        } else if (fs.existsSync(imageSource)) {
          // Send via Local File Stream (Disk upload)
          sentMessage = await bot.telegram.sendPhoto(chatId.toString(), {
            source: fs.createReadStream(imageSource)
          }, {
            caption: caption,
            parse_mode: 'HTML'
          });
        } else {
          // Fallback: If image file not found on disk, send as text
          console.warn(`[Broadcast] Image source not found: ${imageSource}. Falling back to text.`);
          sentMessage = await bot.telegram.sendMessage(chatId.toString(), caption, {
            parse_mode: 'HTML'
          });
        }
      } catch (err) {
        console.error(`[Broadcast] Failed to send photo broadcast to ${chatId}, falling back to text:`, err);
        sentMessage = await bot.telegram.sendMessage(chatId.toString(), caption, {
          parse_mode: 'HTML'
        });
      }
    } else {
      // Send text announcement directly
      sentMessage = await bot.telegram.sendMessage(chatId.toString(), caption, {
        parse_mode: 'HTML'
      });
    }

    // 3. Pin message if requested
    if (shouldPin && sentMessage && sentMessage.message_id) {
      try {
        await bot.telegram.pinChatMessage(chatId.toString(), sentMessage.message_id, {
          disable_notification: false
        });
      } catch (pinErr) {
        console.warn(`[Broadcast] Failed to pin message in ${chatId}:`, pinErr);
      }
    }
  } else {
    // If using LiveTelegramAdapter or mock
    const adapter = botOrAdapter || new LiveTelegramAdapter();
    sentMessage = await adapter.sendMessage(chatId.toString(), caption, {
      parse_mode: 'HTML'
    });
  }

  return sentMessage;
}
