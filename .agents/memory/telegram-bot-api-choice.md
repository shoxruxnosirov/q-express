---
name: Telegram bot API choice
description: How this project sends order notifications to Telegram.
---

The project uses the Telegram Bot API directly from the backend because no Replit Telegram connector is available. The bot token is a Replit Secret and the admin chat ID is a non-secret environment variable.

**Why:** Direct Bot API calls are the supported fallback when integration search returns no Telegram connector, while keeping the token out of source, client bundles, and logs.

**How to apply:** Keep Telegram calls server-only and treat webhook callbacks as a separate feature; do not expose or print the token.

Bot branding can be managed through the current Bot API; do not assume the owner must use BotFather for the profile photo.

**Why:** On 2026-09-17 the official API documented `setMyProfilePhoto`, and a static JPEG upload succeeded. Older Bot API knowledge may incorrectly rule this out.

**How to apply:** Check current https://core.telegram.org/bots/api before giving capability advice. Profile-photo uploads use a new multipart JPEG attachment, not a reusable photo ID.