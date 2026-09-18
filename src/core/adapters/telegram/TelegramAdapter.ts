import fs from 'fs';
import path from 'path';

export interface OutgoingTelegramMessage {
  chatId: number | string;
  text: string;
  photo?: string | Buffer;
  imageRef?: string | Buffer;
  imageMimeType?: string;
  parseMode?: 'Markdown' | 'HTML';
  replyToMessageId?: number;
  pin?: boolean;
  replyMarkup?: any;
}

export interface TelegramAdapter {
  sendMessage(msg: OutgoingTelegramMessage): Promise<{ messageId: number; success: boolean; pinned?: boolean; pinError?: string }>;
  sendReaction(chatId: number | string, messageId: number, emoji: string): Promise<boolean>;
  /** Clears all reactions on a message (or sets ❌ if clearToX is true). Silently no-ops on permission errors. */
  clearReaction(chatId: number | string, messageId: number, clearToX?: boolean): Promise<boolean>;
  forwardOrCopyMessage(toChatId: number | string, fromChatId: number | string, messageId: number): Promise<{ messageId: number; success: boolean }>;
  sendPhoto?(chatId: number | string, fileId: string | Buffer, caption?: string, replyMarkup?: any, parseMode?: 'Markdown' | 'HTML'): Promise<{ messageId: number; success: boolean }>;
  editMessageCaption?(chatId: number | string, messageId: number, caption: string, replyMarkup?: any, parseMode?: 'Markdown' | 'HTML'): Promise<boolean>;
  editMessageText?(chatId: number | string, messageId: number, text: string, replyMarkup?: any, parseMode?: 'Markdown' | 'HTML'): Promise<boolean>;
  answerCallbackQuery?(callbackQueryId: string, text?: string, showAlert?: boolean): Promise<boolean>;
  setMessageReaction?(params: { chatId: number | string; messageId: number; reaction: Array<{ type: string; emoji: string }> }): Promise<boolean>;
  pinChatMessage?(chatId: number | string, messageId: number): Promise<boolean>;
}

export class MockTelegramAdapter implements TelegramAdapter {
  public sentMessages: Array<OutgoingTelegramMessage & { messageId: number; timestamp: Date }> = [];
  public pinnedMessages: Array<{ chatId: number | string; messageId: number }> = [];
  public sentReactions: Array<{ chatId: string | number; messageId: number; emoji: string }> = [];
  public forwardedMessages: Array<{ toChatId: number | string; fromChatId: number | string; messageId: number }> = [];
  public sentPhotos: Array<{ chatId: number | string; fileId: string | Buffer; caption?: string; replyMarkup?: any; parseMode?: 'Markdown' | 'HTML' }> = [];
  public editedCaptions: Array<{ chatId: number | string; messageId: number; caption: string; replyMarkup?: any; parseMode?: 'Markdown' | 'HTML' }> = [];
  public editedMessages: Array<{ chatId: number | string; messageId: number; text: string; replyMarkup?: any; parseMode?: 'Markdown' | 'HTML' }> = [];
  public answeredCallbackQueries: Array<{ callbackQueryId: string; text?: string; showAlert?: boolean }> = [];
  public mockPinError?: string;
  private messageCounter: number = 1000;


  async sendMessage(msg: OutgoingTelegramMessage): Promise<{ messageId: number; success: boolean; pinned?: boolean; pinError?: string }> {
    this.messageCounter++;
    const messageId = this.messageCounter;
    this.sentMessages.push({
      ...msg,
      messageId,
      timestamp: new Date(),
    });

    if (msg.photo || msg.imageRef) {
      this.sentPhotos.push({
        chatId: msg.chatId,
        fileId: typeof msg.photo === 'string' ? msg.photo : (typeof msg.imageRef === 'string' ? msg.imageRef : 'buffer'),
        caption: msg.text,
        replyMarkup: msg.replyMarkup,
        parseMode: msg.parseMode,
      });
    }

    const shouldPin = Boolean(msg.pin);
    const pinned = shouldPin && !this.mockPinError;
    const pinError = shouldPin && this.mockPinError ? this.mockPinError : undefined;

    return {
      messageId,
      success: true,
      pinned,
      pinError,
    };
  }

  async sendReaction(chatId: number | string, messageId: number, emoji: string): Promise<boolean> {
    this.sentReactions.push({ chatId, messageId, emoji });
    return true;
  }

  public clearedReactions: Array<{ chatId: string | number; messageId: number; clearToX: boolean }> = [];

  async clearReaction(chatId: number | string, messageId: number, clearToX = false): Promise<boolean> {
    this.clearedReactions.push({ chatId, messageId, clearToX });
    return true;
  }

  async setMessageReaction(params: { chatId: number | string; messageId: number; reaction: Array<{ type: string; emoji: string }> }): Promise<boolean> {
    for (const r of params.reaction) {
      this.sentReactions.push({ chatId: params.chatId, messageId: params.messageId, emoji: r.emoji });
    }
    return true;
  }

  async pinChatMessage(chatId: number | string, messageId: number): Promise<boolean> {
    this.pinnedMessages.push({ chatId, messageId });
    return true;
  }

  async forwardOrCopyMessage(
    toChatId: number | string,
    fromChatId: number | string,
    messageId: number
  ): Promise<{ messageId: number; success: boolean }> {
    this.forwardedMessages.push({ toChatId, fromChatId, messageId });
    this.messageCounter++;
    return { messageId: this.messageCounter, success: true };
  }

  async sendPhoto(
    chatId: number | string,
    fileId: string | Buffer,
    caption?: string,
    replyMarkup?: any,
    parseMode?: 'Markdown' | 'HTML'
  ): Promise<{ messageId: number; success: boolean }> {
    this.sentPhotos.push({ chatId, fileId, caption, replyMarkup, parseMode });
    const isOptions = replyMarkup && typeof replyMarkup === 'object' && (
      'replyToMessageId' in replyMarkup || 'reply_to_message_id' in replyMarkup ||
      'parseMode' in replyMarkup || 'parse_mode' in replyMarkup ||
      'replyMarkup' in replyMarkup || 'reply_markup' in replyMarkup
    );
    const replyToMessageId = isOptions ? (replyMarkup.replyToMessageId ?? replyMarkup.reply_to_message_id) : undefined;
    const finalParseMode = isOptions ? (replyMarkup.parseMode ?? replyMarkup.parse_mode ?? parseMode) : parseMode;
    const finalMarkup = isOptions ? (replyMarkup.replyMarkup ?? replyMarkup.reply_markup ?? (('inline_keyboard' in replyMarkup) ? replyMarkup : undefined)) : replyMarkup;
    this.messageCounter++;
    this.sentMessages.push({
      chatId,
      text: caption || '',
      photo: fileId,
      replyToMessageId,
      replyMarkup: finalMarkup,
      parseMode: finalParseMode,
      messageId: this.messageCounter,
      timestamp: new Date(),
    });
    return { messageId: this.messageCounter, success: true };
  }

  async editMessageCaption(
    chatId: number | string,
    messageId: number,
    caption: string,
    replyMarkup?: any,
    parseMode?: 'Markdown' | 'HTML'
  ): Promise<boolean> {
    this.editedCaptions.push({ chatId, messageId, caption, replyMarkup, parseMode });
    return true;
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    replyMarkup?: any,
    parseMode?: 'Markdown' | 'HTML'
  ): Promise<boolean> {
    this.editedMessages.push({ chatId, messageId, text, replyMarkup, parseMode });
    return true;
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert?: boolean
  ): Promise<boolean> {
    this.answeredCallbackQueries.push({ callbackQueryId, text, showAlert });
    return true;
  }

  clear(): void {
    this.sentMessages = [];
    this.sentReactions = [];
    this.forwardedMessages = [];
    this.sentPhotos = [];
    this.editedCaptions = [];
    this.editedMessages = [];
    this.answeredCallbackQueries = [];
  }
}


export class LiveTelegramAdapter implements TelegramAdapter {
  private botToken: string;

  constructor(botToken?: string) {
    this.botToken = botToken || process.env.TELEGRAM_BOT_TOKEN || '';
  }

  async sendMessage(msg: OutgoingTelegramMessage): Promise<{ messageId: number; success: boolean; pinned?: boolean; pinError?: string }> {
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    const photoSource = msg.photo || msg.imageRef;
    if (photoSource) {
      try {
        const caption = msg.text ? (msg.text.length > 1024 ? msg.text.slice(0, 1021) + '...' : msg.text) : undefined;
        const parseMode = msg.parseMode || 'HTML';
        let res: Response;

        if (Buffer.isBuffer(photoSource)) {
          const formData = new FormData();
          formData.append('chat_id', String(msg.chatId));
          if (caption) formData.append('caption', caption);
          if (parseMode) formData.append('parse_mode', parseMode);
          if (msg.replyToMessageId) formData.append('reply_to_message_id', String(msg.replyToMessageId));
          if (msg.replyMarkup) {
            formData.append('reply_markup', typeof msg.replyMarkup === 'string' ? msg.replyMarkup : JSON.stringify(msg.replyMarkup));
          }
          const ext = msg.imageMimeType?.includes('png') ? 'png' : msg.imageMimeType?.includes('webp') ? 'webp' : 'jpg';
          formData.append('photo', new Blob([new Uint8Array(photoSource)], { type: msg.imageMimeType || 'image/jpeg' }), `promotion.${ext}`);

          res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
            method: 'POST',
            body: formData,
          });
        } else if (typeof photoSource === 'string' && (photoSource.startsWith('http://') || photoSource.startsWith('https://'))) {
          const payload: any = {
            chat_id: msg.chatId,
            photo: photoSource,
            caption,
            parse_mode: parseMode,
            reply_to_message_id: msg.replyToMessageId,
          };
          if (msg.replyMarkup) {
            payload.reply_markup = typeof msg.replyMarkup === 'string' ? msg.replyMarkup : JSON.stringify(msg.replyMarkup);
          }
          res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else if (typeof photoSource === 'string' && fs.existsSync(photoSource)) {
          const fileBuf = fs.readFileSync(photoSource);
          const formData = new FormData();
          formData.append('chat_id', String(msg.chatId));
          if (caption) formData.append('caption', caption);
          if (parseMode) formData.append('parse_mode', parseMode);
          if (msg.replyToMessageId) formData.append('reply_to_message_id', String(msg.replyToMessageId));
          if (msg.replyMarkup) {
            formData.append('reply_markup', typeof msg.replyMarkup === 'string' ? msg.replyMarkup : JSON.stringify(msg.replyMarkup));
          }
          const ext = path.extname(photoSource).replace('.', '') || 'jpg';
          formData.append('photo', new Blob([new Uint8Array(fileBuf)]), `promotion.${ext}`);

          res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
            method: 'POST',
            body: formData,
          });
        } else if (typeof photoSource === 'string' && photoSource.startsWith('data:')) {
          const base64Data = photoSource.replace(/^data:[^;]+;base64,/, '');
          const fileBuf = Buffer.from(base64Data, 'base64');
          const formData = new FormData();
          formData.append('chat_id', String(msg.chatId));
          if (caption) formData.append('caption', caption);
          if (parseMode) formData.append('parse_mode', parseMode);
          if (msg.replyToMessageId) formData.append('reply_to_message_id', String(msg.replyToMessageId));
          if (msg.replyMarkup) {
            formData.append('reply_markup', typeof msg.replyMarkup === 'string' ? msg.replyMarkup : JSON.stringify(msg.replyMarkup));
          }
          formData.append('photo', new Blob([new Uint8Array(fileBuf)]), 'promotion.jpg');

          res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
            method: 'POST',
            body: formData,
          });
        } else {
          const payload: any = {
            chat_id: msg.chatId,
            photo: photoSource,
            caption,
            parse_mode: parseMode,
            reply_to_message_id: msg.replyToMessageId,
          };
          if (msg.replyMarkup) {
            payload.reply_markup = typeof msg.replyMarkup === 'string' ? msg.replyMarkup : JSON.stringify(msg.replyMarkup);
          }
          res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        let data: any = await res.json();
        if (!data.ok && data.description?.includes("can't parse entities")) {
          console.warn(`[LiveTelegramAdapter] sendPhoto parse_mode error (${data.description}), retrying without parse_mode`);
          const retryPayload: any = {
            chat_id: msg.chatId,
            photo: typeof photoSource === 'string' ? photoSource : undefined,
            caption,
            reply_to_message_id: msg.replyToMessageId,
          };
          if (msg.replyMarkup) {
            retryPayload.reply_markup = typeof msg.replyMarkup === 'string' ? msg.replyMarkup : JSON.stringify(msg.replyMarkup);
          }
          if (Buffer.isBuffer(photoSource)) {
            const formData = new FormData();
            formData.append('chat_id', String(msg.chatId));
            if (caption) formData.append('caption', caption);
            if (msg.replyToMessageId) formData.append('reply_to_message_id', String(msg.replyToMessageId));
            if (msg.replyMarkup) {
              formData.append('reply_markup', typeof msg.replyMarkup === 'string' ? msg.replyMarkup : JSON.stringify(msg.replyMarkup));
            }
            formData.append('photo', new Blob([new Uint8Array(photoSource)]), 'promotion.jpg');
            const retryRes = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
              method: 'POST',
              body: formData,
            });
            data = await retryRes.json();
          } else {
            const retryRes = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(retryPayload),
            });
            data = await retryRes.json();
          }
        }

        if (data.ok && data.result?.message_id) {
          const messageId = data.result.message_id;
          let pinned = false;
          let pinError: string | undefined = undefined;

          if (msg.pin) {
            try {
              const pinRes = await fetch(`https://api.telegram.org/bot${this.botToken}/pinChatMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: msg.chatId,
                  message_id: messageId,
                  disable_notification: true,
                }),
              });
              const pinData: any = await pinRes.json();
              pinned = Boolean(pinData.ok);
              if (!pinData.ok) {
                pinError = pinData.description || 'Pin message failed';
                console.warn(`[LiveTelegramAdapter] pinChatMessage failed for chat ${msg.chatId} msg ${messageId}:`, pinData.description);
              }
            } catch (err: any) {
              pinned = false;
              pinError = err.message || 'Network error during pin';
              console.warn(`[LiveTelegramAdapter] pinChatMessage network error:`, err.message);
            }
          }

          return { messageId, success: true, pinned, pinError };
        } else {
          console.warn(`[LiveTelegramAdapter] sendPhoto failed (${data.description}), falling back to text sendMessage`);
        }
      } catch (photoErr: any) {
        console.warn(`[LiveTelegramAdapter] sendPhoto error (${photoErr.message}), falling back to text sendMessage`);
      }
    }

    const payload: any = {
      chat_id: msg.chatId,
      text: msg.text,
      parse_mode: msg.parseMode || 'Markdown',
      reply_to_message_id: msg.replyToMessageId,
    };
    if (msg.replyMarkup) {
      payload.reply_markup = typeof msg.replyMarkup === 'string' ? msg.replyMarkup : JSON.stringify(msg.replyMarkup);
    }

    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data: any = await res.json();
    if (!data.ok && data.description?.includes("can't parse entities")) {
      console.warn(`[LiveTelegramAdapter] parse_mode entity failure (${data.description}), retrying as plain text without parse_mode`);
      const retryPayload: any = {
        chat_id: msg.chatId,
        text: msg.text,
        reply_to_message_id: msg.replyToMessageId,
      };
      if (msg.replyMarkup) {
        retryPayload.reply_markup = typeof msg.replyMarkup === 'string' ? msg.replyMarkup : JSON.stringify(msg.replyMarkup);
      }
      const retryRes = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryPayload),
      });
      data = await retryRes.json();
    }
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }

    const messageId = data.result.message_id;
    let pinned = false;
    let pinError: string | undefined = undefined;

    if (msg.pin) {
      try {
        const pinRes = await fetch(`https://api.telegram.org/bot${this.botToken}/pinChatMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: msg.chatId,
            message_id: messageId,
            disable_notification: true,
          }),
        });
        const pinData: any = await pinRes.json();
        pinned = Boolean(pinData.ok);
        if (!pinData.ok) {
          pinError = pinData.description || 'Pin message failed';
          console.warn(`[LiveTelegramAdapter] pinChatMessage failed for chat ${msg.chatId} msg ${messageId}:`, pinData.description);
        }
      } catch (err: any) {
        pinned = false;
        pinError = err.message || 'Network error during pin';
        console.warn(`[LiveTelegramAdapter] pinChatMessage network error:`, err.message);
      }
    }

    return { messageId, success: true, pinned, pinError };
  }

  async sendReaction(chatId: number | string, messageId: number, emoji: string): Promise<boolean> {
    if (!this.botToken) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reaction: [{ type: 'emoji', emoji }],
        }),
      });
      const data: any = await res.json();
      if (!data.ok) {
        console.warn(`[LiveTelegramAdapter] setMessageReaction failed for chat ${chatId} msg ${messageId}:`, data.description);
      }
      return Boolean(data.ok);
    } catch (err: any) {
      console.warn(`[LiveTelegramAdapter] setMessageReaction network error:`, err.message);
      return false;
    }
  }

  /** Clears all reactions on a message, or replaces with ❌ if clearToX=true. Never throws. */
  async clearReaction(chatId: number | string, messageId: number, clearToX = false): Promise<boolean> {
    if (!this.botToken) return false;
    try {
      const reaction = clearToX ? [{ type: 'emoji', emoji: '❌' }] : [];
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, reaction }),
      });
      const data: any = await res.json();
      if (!data.ok) {
        console.warn(`[LiveTelegramAdapter] clearReaction failed for chat ${chatId} msg ${messageId}:`, data.description);
      }
      return Boolean(data.ok);
    } catch (err: any) {
      console.warn(`[LiveTelegramAdapter] clearReaction network error:`, err.message);
      return false;
    }
  }

  async setMessageReaction(params: { chatId: number | string; messageId: number; reaction: Array<{ type: string; emoji: string }> }): Promise<boolean> {
    if (!this.botToken) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: params.chatId,
          message_id: params.messageId,
          reaction: params.reaction,
        }),
      });
      const data: any = await res.json();
      if (!data.ok) {
        console.warn(`[LiveTelegramAdapter] setMessageReaction failed for chat ${params.chatId} msg ${params.messageId}:`, data.description);
      }
      return Boolean(data.ok);
    } catch (err: any) {
      console.warn(`[LiveTelegramAdapter] setMessageReaction network error:`, err.message);
      return false;
    }
  }

  async forwardOrCopyMessage(
    toChatId: number | string,
    fromChatId: number | string,
    messageId: number
  ): Promise<{ messageId: number; success: boolean }> {
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    // Try forwardMessage first
    try {
      const fwdRes = await fetch(`https://api.telegram.org/bot${this.botToken}/forwardMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: toChatId,
          from_chat_id: fromChatId,
          message_id: messageId,
        }),
      });
      const fwdData: any = await fwdRes.json();
      if (fwdData.ok && fwdData.result?.message_id) {
        return { messageId: fwdData.result.message_id, success: true };
      }
      console.warn(`[LiveTelegramAdapter] forwardMessage failed: ${fwdData.description}, falling back to copyMessage`);
    } catch (fwdErr: any) {
      console.warn(`[LiveTelegramAdapter] forwardMessage network error: ${fwdErr.message}, falling back to copyMessage`);
    }

    // Fallback to copyMessage
    const copyRes = await fetch(`https://api.telegram.org/bot${this.botToken}/copyMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: toChatId,
        from_chat_id: fromChatId,
        message_id: messageId,
      }),
    });
    const copyData: any = await copyRes.json();
    if (!copyData.ok) {
      throw new Error(`Telegram forward/copy failed: ${copyData.description}`);
    }
    return { messageId: copyData.result.message_id, success: true };
  }

  async sendPhoto(
    chatId: number | string,
    fileId: string | Buffer,
    caption?: string,
    replyMarkup?: any,
    parseMode?: 'Markdown' | 'HTML'
  ): Promise<{ messageId: number; success: boolean }> {
    const isOptions = replyMarkup && typeof replyMarkup === 'object' && (
      'replyToMessageId' in replyMarkup || 'reply_to_message_id' in replyMarkup ||
      'parseMode' in replyMarkup || 'parse_mode' in replyMarkup ||
      'replyMarkup' in replyMarkup || 'reply_markup' in replyMarkup
    );
    const replyToMessageId = isOptions ? (replyMarkup.replyToMessageId ?? replyMarkup.reply_to_message_id) : undefined;
    const finalParseMode = isOptions ? (replyMarkup.parseMode ?? replyMarkup.parse_mode ?? parseMode) : parseMode;
    const finalMarkup = isOptions ? (replyMarkup.replyMarkup ?? replyMarkup.reply_markup ?? (('inline_keyboard' in replyMarkup) ? replyMarkup : undefined)) : replyMarkup;
    const res = await this.sendMessage({
      chatId,
      text: caption || '',
      photo: fileId,
      replyToMessageId,
      replyMarkup: finalMarkup,
      parseMode: finalParseMode,
    });
    return { messageId: res.messageId, success: res.success };
  }

  async editMessageCaption(
    chatId: number | string,
    messageId: number,
    caption: string,
    replyMarkup?: any,
    parseMode?: 'Markdown' | 'HTML'
  ): Promise<boolean> {
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: parseMode || 'HTML',
    };
    if (replyMarkup) {
      payload.reply_markup = typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup);
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/editMessageCaption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: any = await res.json();
      if (!data.ok && data.description?.includes("can't parse entities")) {
        console.warn(`[LiveTelegramAdapter] editMessageCaption parse_mode error (${data.description}), retrying without parse_mode`);
        const retryPayload: any = {
          chat_id: chatId,
          message_id: messageId,
          caption,
        };
        if (replyMarkup) {
          retryPayload.reply_markup = typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup);
        }
        const retryRes = await fetch(`https://api.telegram.org/bot${this.botToken}/editMessageCaption`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retryPayload),
        });
        const retryData: any = await retryRes.json();
        return Boolean(retryData.ok);
      }
      return Boolean(data.ok);
    } catch (err: any) {
      console.warn(`[LiveTelegramAdapter] editMessageCaption network error:`, err.message);
      return false;
    }
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    replyMarkup?: any,
    parseMode?: 'Markdown' | 'HTML'
  ): Promise<boolean> {
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode || 'HTML',
    };
    if (replyMarkup) {
      payload.reply_markup = typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup);
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: any = await res.json();
      if (!data.ok && data.description?.includes("can't parse entities")) {
        console.warn(`[LiveTelegramAdapter] editMessageText parse_mode error (${data.description}), retrying without parse_mode`);
        const retryPayload: any = {
          chat_id: chatId,
          message_id: messageId,
          text,
        };
        if (replyMarkup) {
          retryPayload.reply_markup = typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup);
        }
        const retryRes = await fetch(`https://api.telegram.org/bot${this.botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retryPayload),
        });
        const retryData: any = await retryRes.json();
        return Boolean(retryData.ok);
      }
      return Boolean(data.ok);
    } catch (err: any) {
      console.warn(`[LiveTelegramAdapter] editMessageText network error:`, err.message);
      return false;
    }
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert?: boolean
  ): Promise<boolean> {
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    const payload: any = {
      callback_query_id: callbackQueryId,
      text: text || undefined,
      show_alert: Boolean(showAlert),
    };
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: any = await res.json();
      return Boolean(data.ok);
    } catch (err: any) {
      console.warn(`[LiveTelegramAdapter] answerCallbackQuery network error:`, err.message);
      return false;
    }
  }

  async pinChatMessage(chatId: number | string, messageId: number): Promise<boolean> {
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/pinChatMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      });
      const data: any = await res.json();
      return Boolean(data.ok);
    } catch (err: any) {
      console.warn(`[LiveTelegramAdapter] pinChatMessage failed for chat ${chatId} msg ${messageId}:`, err.message);
      return false;
    }
  }
}

