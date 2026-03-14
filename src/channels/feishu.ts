/**
 * Feishu (Lark) Channel for NanoClaw
 *
 * Uses @larksuiteoapi/node-sdk for bot messaging.
 * Uses WebSocket long-connection for receiving events (no public URL needed).
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import {
  Channel,
  NewMessage,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';
import { registerChannel } from './registry.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  baseDomain: string;
}

// Message event data type (from SDK inline type)
interface FeishuMessageEvent {
  event_id?: string;
  token?: string;
  create_time?: string;
  event_type?: string;
  tenant_key?: string;
  ts?: string;
  uuid?: string;
  type?: string;
  app_id?: string;
  sender: {
    sender_id?: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    update_time?: string;
    chat_id: string;
    thread_id?: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: {
        union_id?: string;
        user_id?: string;
        open_id?: string;
      };
      name: string;
      tenant_key?: string;
    }>;
    user_agent?: string;
  };
}

class FeishuChannel implements Channel {
  name = 'feishu';
  private config: FeishuConfig;
  private client: Lark.Client;
  private wsClient: Lark.WSClient;
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;
  private registeredGroups: () => Record<string, RegisteredGroup>;
  private connected = false;

  constructor(
    config: FeishuConfig,
    opts: {
      onMessage: OnInboundMessage;
      onChatMetadata: OnChatMetadata;
      registeredGroups: () => Record<string, RegisteredGroup>;
    },
  ) {
    this.config = config;

    // Initialize Lark client for sending messages
    this.client = new Lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: config.baseDomain,
    });

    // Initialize WebSocket client for receiving events
    this.wsClient = new Lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: config.baseDomain,
    });

    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
    this.registeredGroups = opts.registeredGroups;
  }

  async connect(): Promise<void> {
    try {
      // Create event dispatcher
      const eventDispatcher = new Lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: FeishuMessageEvent) => {
          await this.handleMessage(data);
        },
      });

      // Start WebSocket connection
      this.wsClient.start({ eventDispatcher });
      this.connected = true;
      logger.info({ channel: 'feishu' }, 'Feishu channel connected via WebSocket');
    } catch (err) {
      logger.error({ err, channel: 'feishu' }, 'Failed to connect Feishu channel');
      throw err;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('feishu:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info({ channel: 'feishu' }, 'Feishu channel disconnected');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Feishu channel not connected');
    }

    const chatId = jid.replace('feishu:', '');

    try {
      await this.client.im.v1.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
    } catch (err) {
      logger.error({ err, jid }, 'Failed to send Feishu message');
      throw err;
    }
  }

  private async handleMessage(data: FeishuMessageEvent): Promise<void> {
    const { message, sender } = data;

    // Parse message content
    let content = '';
    try {
      if (message.message_type === 'text') {
        content = JSON.parse(message.content || '{}').text || '';
      } else if (message.message_type === 'post') {
        // Rich text message - extract text content
        const parsed = JSON.parse(message.content || '{}');
        const sections = parsed.zh_cn?.content || parsed.en_us?.content || [];
        content = sections
          .flatMap((section: Array<{ text?: string }>) => section.map((el) => el.text || ''))
          .join('');
      }
    } catch {
      logger.warn({ messageType: message.message_type }, 'Failed to parse Feishu message content');
      return;
    }

    if (!content) return;

    // Get sender info
    const senderId = sender?.sender_id?.open_id ||
      sender?.sender_id?.union_id ||
      sender?.sender_id?.user_id ||
      'unknown';

    const chatJid = `feishu:${message.chat_id}`;
    const isGroup = message.chat_type === 'group';

    // Create NewMessage
    const newMessage: NewMessage = {
      id: message.message_id || '',
      chat_jid: chatJid,
      sender: senderId,
      sender_name: senderId,
      content,
      timestamp: new Date(parseInt(message.create_time || Date.now().toString())).toISOString(),
      is_from_me: false,
      is_bot_message: false,
    };

    // Store chat metadata FIRST (required for foreign key constraint on messages table)
    this.onChatMetadata(
      chatJid,
      newMessage.timestamp,
      undefined,
      'feishu',
      isGroup,
    );

    // Then pass to message handler
    this.onMessage(chatJid, newMessage);
  }
}

// Factory function for channel registration
export function createFeishuChannel(opts: {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}): Channel | null {
  // Read secrets directly from .env (not process.env for security)
  const secrets = readEnvFile([
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_BASE_DOMAIN',
  ]);

  const appId = secrets.FEISHU_APP_ID;
  const appSecret = secrets.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    logger.debug('Feishu credentials not configured, skipping channel');
    return null;
  }

  return new FeishuChannel(
    {
      appId,
      appSecret,
      baseDomain: secrets.FEISHU_BASE_DOMAIN || 'https://open.feishu.cn',
    },
    opts,
  );
}

// Self-register the channel
registerChannel('feishu', createFeishuChannel);