---
name: add-feishu
description: Add Feishu (Lark) as a channel. Uses WebSocket long-connection for receiving events and SDK for sending messages.
---

# Add Feishu Channel

This skill adds Feishu (Lark) support to NanoClaw using the official `@larksuiteoapi/node-sdk`.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/feishu.ts` exists. If it does, skip to Phase 3 (Setup). The code changes are already in place.

### Ask the user

Use `AskUserQuestion` to collect configuration:

1. Do you have Feishu app credentials (APP_ID and APP_SECRET)?
2. If yes, collect them now. If not, guide them to create a Feishu app.

## Phase 2: Apply Code Changes

### Create the Feishu channel

Create `src/channels/feishu.ts` with the FeishuChannel class implementing the Channel interface.

The implementation uses:
- `@larksuiteoapi/node-sdk` - Official Lark SDK
- `WSClient` - WebSocket long-connection for receiving events (no public URL needed)
- `EventDispatcher` - Event handling for `im.message.receive_v1`
- `client.im.v1.message.create` - Send messages to P2P chats
- `client.im.v1.message.reply` - Reply to messages in group chats

### Add import to barrel file

Add `import './feishu.js'` to `src/channels/index.ts`.

### Install dependencies

```bash
npm install @larksuiteoapi/node-sdk
```

### Validate code changes

```bash
npm run build
```

## Phase 3: Setup

### Create Feishu App (if needed)

If the user doesn't have an app, tell them:

> 1. Go to https://open.feishu.cn/app
> 2. Click "Create Enterprise Self-built App" (创建企业自建应用)
> 3. Fill in app name and description
> 4. Go to "Credentials & Basic Info" (凭证与基础信息) to get APP_ID and APP_SECRET
> 5. In "Bot" (机器人) settings, enable bot capability
> 6. In "Event Subscriptions" (事件订阅), add `im.message.receive_v1` event

### Configure environment

Add to `.env`:

```
FEISHU_APP_ID=<app-id>
FEISHU_APP_SECRET=<app-secret>
FEISHU_BASE_DOMAIN=https://open.feishu.cn
```

Channels auto-enable when their credentials are present.

### Sync to container environment

```bash
mkdir -p data/env && cp .env data/env/env
```

### Build and restart

```bash
npm run build
systemctl restart nanoclaw  # Linux
```

## Phase 4: Registration

### Get Chat ID

Tell the user:

> 1. Open your bot in Feishu (search by app name)
> 2. Send a message to the bot
> 3. Check logs: `tail -f logs/nanoclaw.log` to see the chat_id

Wait for the user to provide the chat ID.

### JID Format

- User (P2P) chats: `feishu:ou_xxx` or `feishu:<chat_id>`
- Group chats: `feishu:oc_xxx` or `feishu:<chat_id>`

### Register the chat

For a main chat (responds to all messages):

```bash
npx tsx setup/index.ts --step register -- --jid "feishu:<chat-id>" --name "<chat-name>" --folder "feishu_main" --trigger "@${ASSISTANT_NAME}" --channel feishu --no-trigger-required --is-main
```

For additional chats (trigger-only):

```bash
npx tsx setup/index.ts --step register -- --jid "feishu:<chat-id>" --name "<chat-name>" --folder "feishu_<group-name>" --trigger "@${ASSISTANT_NAME}" --channel feishu
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message to your registered Feishu chat:
> - For main chat: Any message works
> - For non-main: @mention the bot or use the trigger pattern
>
> The bot should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

## Troubleshooting

### Bot not responding

Check:
1. `FEISHU_APP_ID` and `FEISHU_APP_SECRET` are set in `.env`
2. Event subscription is enabled in Feishu admin console
3. Chat is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'feishu:%'"`
4. Service is running: `systemctl status nanoclaw` (Linux)

### WebSocket connection issues

The SDK uses WebSocket long-connection which doesn't require a public URL. If connection fails:
1. Check network connectivity to `open.feishu.cn`
2. Verify credentials are correct
3. Check logs for specific error messages

## Removal

To remove Feishu integration:

1. Delete `src/channels/feishu.ts`
2. Remove `import './feishu.js'` from `src/channels/index.ts`
3. Remove Feishu credentials from `.env`
4. Remove Feishu registrations: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'feishu:%'"`
5. Uninstall: `npm uninstall @larksuiteoapi/node-sdk`
6. Rebuild and restart