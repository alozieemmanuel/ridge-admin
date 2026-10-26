# WhatsApp setup

This turns on WhatsApp for your company once. After that, each event can switch it on from its own settings.
You need five values for the `.env` file. The steps below show where each one comes from.

Meta changes its screens now and then. If a button has moved, search the Meta help pages for the name in quotes.

## What you need first

- A Facebook account that will own the setup.
- A phone number for WhatsApp that is **not** already on a WhatsApp account. A SIM that only receives calls or SMS is fine. If the number is on the normal WhatsApp app, delete that WhatsApp account first.
- A payment card for Meta. Message charges go on it.

## Step 1. Make a Meta Business portfolio

1. Go to business.facebook.com and create a business portfolio for Pertinence Group. Skip this if you already have one.
2. Open Business Settings, then Security Center, then start **Business verification**. Upload your company papers. This takes a few days. You can carry on without it, but you can only message a small number of people a day until it is approved.

## Step 2. Create the app

1. Go to developers.facebook.com and sign in.
2. My Apps, then Create App. Choose the **Business** type. Name it, for example "Pertinence Events".
3. Choose your business portfolio when asked.
4. On the app dashboard, find **WhatsApp** and click Set up. This creates your WhatsApp Business Account.

## Step 3. Add your phone number

1. In the app, open WhatsApp, then **API Setup**.
2. Under "Send and receive messages", add your phone number. Meta sends a code by SMS or call. Enter it.
3. Pick the display name guests will see. Meta reviews it. Use your real brand name.
4. On the same API Setup page, copy:
   - **Phone number ID**. This is `WHATSAPP_PHONE_NUMBER_ID`.
   - **WhatsApp Business Account ID**. This is `WHATSAPP_BUSINESS_ACCOUNT_ID`.

## Step 4. Make a permanent access token

The token on the API Setup page expires in 24 hours. Do not use it. Make one that does not expire:

1. Business Settings, then Users, then **System users**, then Add. Name it "Events dashboard" and give it the Admin role.
2. Click Add assets. Under Apps, pick your app and turn on Full control. Under WhatsApp accounts, pick your account and turn on Full control.
3. Click **Generate token**. Choose your app. Set the expiry to **Never**.
4. Tick these two permissions: `whatsapp_business_management` and `whatsapp_business_messaging`.
5. Copy the token now. Meta shows it once. This is `WHATSAPP_ACCESS_TOKEN`.

## Step 5. Get the app secret

App settings, then Basic. Click Show next to **App secret** and copy it. This is `WHATSAPP_APP_SECRET`. The dashboard uses it to check that incoming messages really come from Meta.

## Step 6. Choose a verify token

Make up any long random text, for example the output of `openssl rand -hex 24`. This is `WHATSAPP_VERIFY_TOKEN`. You will paste the same text into Meta in step 8.

## Step 7. Add the values and publish

Put these in your `.env` file and in your host's environment settings, then deploy again:

```
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
# Optional. Numbers typed without a country code get this one. Default is 234 (Nigeria).
WHATSAPP_DEFAULT_COUNTRY_CODE=234
```

The site must be live on a public address before step 8, because Meta calls it.

## Step 8. Connect the webhook

The webhook is how replies reach the dashboard.

1. In the app, open WhatsApp, then **Configuration**.
2. Next to Webhook click Edit.
3. Callback URL: `https://pertinencegroup.com/event/api/webhooks/whatsapp`
4. Verify token: the text from step 6.
5. Click Verify and save. If it fails, check that the deploy finished and the token matches exactly.
6. Under Webhook fields, click Manage and subscribe to **messages**.

If replies do not show up later, link the app to your account once. Run this with your own values:

```
curl -X POST "https://graph.facebook.com/v21.0/YOUR_BUSINESS_ACCOUNT_ID/subscribed_apps" -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Step 9. Add a payment method

Open WhatsApp Manager (business.facebook.com, then WhatsApp accounts), then Payment settings, and add your card. Without it, template messages stop after the free allowance.

Meta charges per message, by message type and by country. Rates change, so read Meta's current pricing page before a large send. Replies you type within 24 hours of the person's last message are free of charge at the time of writing.

## Step 10. Create message templates

WhatsApp only lets a business start a chat with an approved template. You write the template, Meta approves it.

1. WhatsApp Manager, then **Message templates**, then Create template.
2. Choose a category: Utility for things like reminders and directions, Marketing for promotions. Pick the language.
3. Write the body. Use `{{1}}`, `{{2}}` for the parts that change. Example:

   `Hello {{1}}, this is a reminder that {{2}} holds on {{3}} at {{4}}. Reply to this message if you have a question.`

4. Submit. Approval takes from a few minutes to a day.

The dashboard shows approved templates that have a text body and text variables. Templates with a header image or buttons are listed as not supported. When you broadcast, type `{{first_name}}` or `{{full_name}}` in a variable box and the dashboard fills in each person's name.

## Step 11. Switch it on for an event

1. Open the event, then Settings, then **Edit event**.
2. Tick **WhatsApp messages** and save. A WhatsApp item appears in the menu.
3. Inbox is for one-to-one chats and replies. Broadcast sends one template to a group.

## Step 12. Test

1. Open WhatsApp in the event, then New chat, and type your own number with the country code.
2. The 24-hour window is closed, so send an approved template.
3. Reply from your phone. Your reply shows in the Inbox within a few seconds.
4. Now type a reply in the dashboard. Free text works while the window is open.

## Good to know

- One WhatsApp number serves every event. Each event's Inbox only shows chats that belong to that event. If you message someone from a second event, their chat moves to that event.
- A new number can message a limited number of people each day. The limit rises as Meta sees good quality and after business verification.
- People can block you or report messages. Too many reports lowers your quality rating and your limit. Only message people who expect it.
- Messages you send before the setup is finished are saved as Failed in the chat.
