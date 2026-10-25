# Mana Kirana

A mobile-friendly grocery ordering app with two modes: entrance QR ordering and online pre-order. Customers and shopkeepers use one product catalogue, cart, order queue, and pickup schedule. Built with React, Vite, and Tailwind CSS.

## Run the browser demo

Requirements: Node.js 20.19+ (or 22.12+) and npm.

```bash
npm install
npm run dev
```

Open the local address printed by Vite. With no environment file, the app runs using sample data saved in this browser. Run `npm run build` to create a production bundle, or `npm run preview` to serve it locally.

## Connect a shared live backend

The app uses Supabase for phone accounts, shared catalogue and stock, order storage, database-enforced checkout rules, customer account messages, and live updates across devices.

1. Create a Supabase project.
2. In its SQL Editor, run [`supabase/migrations/202610250001_mana_kirana_realtime.sql`](supabase/migrations/202610250001_mana_kirana_realtime.sql).
3. Copy `.env.example` to `.env.local` in the project folder.
4. In Supabase Project Settings → API, copy the project URL and publishable key into `.env.local`:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

5. In **Authentication → Providers → Phone**, enable phone sign-in, select an SMS provider (such as Twilio or Vonage), enter that provider's required credentials, and save. Enabling the Phone toggle by itself is not enough to send real OTPs.
6. Restart the Vite server after changing environment values.
7. Sign in once using the shopkeeper's phone. The first account is a customer by default. Promote that verified account to shopkeeper in the Supabase SQL Editor, replacing the sample phone with the full verified number in E.164 format:

   ```sql
   update public.profiles
   set role = 'shopkeeper'
   where id = (select id from auth.users where phone = '+919876543210');
   ```

   Sign out and back in to refresh the account role. Shopkeeper actions are checked again by database policies and RPC functions.

Use only the publishable key in the browser app. Never put a Supabase `service_role` key in `VITE_` variables or client files. Row-level security is enabled by the migration; keep it enabled for exposed tables.

## Included workflows

- **Customer:** browse and search products, pick categories, choose loose weights from 10 g to 100 kg, add unlisted-item requests, review the confirmed subtotal, and submit an order after phone verification and re-entry.
- **Order rules:** the confirmed catalogue subtotal must exceed ₹200. Unpriced requests do not count until the shopkeeper sets their rate. The database reserves stock and assigns a queue-based ready estimate in 15-minute slots.
- **Pickup modes:** online pre-order and entrance QR ordering use the same cart, order system, and pickup queue. The entrance QR URL can use `/?mode=entrance`.
- **Shopkeeper:** add, remove, and update products; add and remove categories; accept or decline orders; set rates for requested items; and move orders through Preparing, Ready, and Collected.
- **Account updates:** order received, accepted, declined, newly priced, ready, and collected messages appear in the customer's account. These are in-app messages, not SMS notifications.

## Payment and storage limits

The live configuration shares data through Supabase, but payment options remain demonstrations: no UPI request or charge is sent. Customers need SMS OTP to sign in, while order status messages appear inside the account and are not sent as SMS. Without Supabase environment settings, all changes are browser-local demo data; with settings configured, the SQL migration and SMS provider must also be configured for live ordering.

Cart contents remain in the current page session. The QR URL opens the entrance ordering mode when encoded in a store QR; this app does not generate QR codes or scan them.

## Troubleshooting phone sign-in

If the sign-in window reports **Unsupported phone provider**, the app is reaching the configured Supabase project, but that project does not have a usable SMS provider configured. Open **Authentication → Providers → Phone**, enable the provider, complete its SMS credentials, and save. Then retry sign-in. See the [Supabase phone sign-in guide](https://supabase.com/docs/guides/auth/phone-login) for provider setup. SMS delivery to India may also require compliance with local messaging rules and sender registration.
