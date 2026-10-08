# WainSim (seed tenant, draft)

Loaded from the platform scope as ordinary configuration. **Paused. Nothing here is live.**

Taken from the scope: a travel eSIM store, audience of travellers (especially to and from Saudi Arabia), the plan catalog module, and a wholesaler API as the source of plans.

Drafted by the platform and **needs your review**: tagline, personas, pillars, keywords, tracker prompts, the five general eSIM FAQs (basic facts only, no WainSim-specific claims), the coverage note, voice, banned phrases, colours, competitors (Airalo and Holafly, for the tracker only), the "WainSim" byline and the $20 budget placeholder.

## Plan catalog

The catalog module is switched on, but **no plans are published**: there is no plan data until the wholesaler is connected, and nothing is invented. Once the supplier details are known:

1. Fill in `integrations.feeds[0]` in `tenant.json`: the API `url`, the `mapping` from the supplier's fields to ours, and optionally `authHeader` / `authScheme`. See the plan catalog section of the main README.
2. Add the API key as the secret `WAINSIM_WHOLESALER_API_KEY` (repository secret for sync runs).
3. Run `pnpm avp feed sync esim`. It writes `data/catalog.json`, and the plan and destination pages appear on the next build.

Still needed before launch: the real domain (currently `wainsim.example`), the wholesaler details, 15 to 25 FAQs, pricing explanation, lead form destination, privacy and terms text, analytics id.
