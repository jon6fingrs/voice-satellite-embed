# voice-satellite-embed

Run the [Voice Satellite integration](https://github.com/jxlarrea/voice-satellite-card-integration)'s
browser voice assistant on **any web page**, not just inside Home Assistant's own frontend.

The Voice Satellite integration turns a browser into a full Assist satellite: wake word on the
device, your pipeline, timers, announcements, a media player, skins. It runs inside Home Assistant's
frontend. That leaves out custom wall-tablet dashboards, kiosk pages and photo frames, which don't
load that frontend.

This is one small module (no build step) that makes such a page look enough like Home Assistant's
frontend for the integration's own script to run there. The integration is installed and configured
as usual and isn't modified: its script is loaded from your Home Assistant, and its satellite
entity, settings, pipeline, skins, announcements and timers work as they do inside Home Assistant.

It also helps with **older or weaker tablets**: the page doesn't load Home Assistant's whole frontend,
and only the satellite's own entities are streamed to the device.

## Requirements

- The Voice Satellite integration, with one entry for each device that should be a satellite
  (Settings → Devices & services → Add integration → Voice Satellite). Note its
  `assist_satellite.…` entity.
- A long-lived access token (your profile → Security), or an existing
  [home-assistant-js-websocket](https://github.com/home-assistant/home-assistant-js-websocket)
  connection.
- **HTTPS.** Browsers only allow the microphone on secure pages.
- Simplest and tested: serve the page **from Home Assistant itself**, from the `www` folder
  (`/config/www/…` is served at `https://<your HA>/local/…`). The page, the integration's script and
  the websocket then share one origin. Other origins may run into the browser's cross-origin rules
  for the script and its files.

## Use

Copy `voice-satellite-embed.js` next to your page:

```html
<script type="module">
import { startVoiceSatellite } from './voice-satellite-embed.js';

const sat = await startVoiceSatellite({
  token: '<long-lived access token>',          // or connection: <haws Connection>
  entity: 'assist_satellite.kitchen_tablet',   // this device's satellite
  // hassUrl: 'https://ha.example.com',        // default: the page's own origin
  // debug: true,
});

sat.busy();        // true while listening, thinking or answering (e.g. keep a screensaver off)
sat.hold(true);    // let go of the microphone (e.g. during a video or intercom call) ...
sat.hold(false);   // ... and take it back
sat.stop();        // stop updating (the integration's script stays until the page reloads)
</script>
```

`example.html` is a complete page that keeps the token out of the file (open it once with
`#token=…` after the address; it's saved in that browser).

The integration's debug logging works as usual: add `?vs_debug=true` to the page address.

## How it works

The integration's script waits for a `<home-assistant>` element and uses its `hass` object. This
module:

- connects with home-assistant-js-websocket (loaded from jsDelivr, version pinned);
- reads the entity registry's compact display list (the satellite finds its settings entities by
  their `platform` and `translation_key`, through its device);
- subscribes to the states of the satellite, the other entities on its device, and the player its
  text-to-speech output select names, and nothing else;
- creates a hidden `<home-assistant>` element and gives it a new `hass` object whenever something
  changes (the script checks the element once a second and reacts to a new object):
  `states`, `entities`, `connection` (the haws connection: messages, subscriptions, the socket for
  audio, the `ready` event on reconnect), `config`, `callService`, `callWS`, `hassUrl`, `locale`;
- sets `localStorage['vs-satellite-entity']` to the entity you pass, so the script uses that
  satellite;
- loads `/voice_satellite/voice-satellite-card.js` from your Home Assistant, versioned with the
  satellite's `integration_version` attribute so an update of the integration is picked up.

On a page that already has Home Assistant's frontend (`<home-assistant>` exists) it does nothing,
since the integration runs there by itself.

### Caveat: this relies on internals

None of the above is a published API of the integration. It is how its script finds Home Assistant
today. An update of the integration could change it; if the satellite stops starting after an
update, check the browser console and open an issue here. `hold()` uses the integration's
private `window.__vsSession._setIntercomHold`.

## Tips from running it on wall tablets (Fully Kiosk Browser)

- Allow the microphone in Fully (Web Content Settings) and in Android's app permissions.
- Home Assistant serves `/local/` with a **31-day browser cache**. Version your own files
  (`my.js?v=2`) and, after changing the page itself, load it once with a new query string (e.g.
  `?u=2`), or the tablet keeps the old page.
- Weak tablets: the integration's on-device wake word (microWakeWord) runs fine without a GPU; pick
  "On Device" in the satellite's settings, or let Home Assistant detect the wake word.

## Credits and license

All of the voice assistant is [jxlarrea/voice-satellite-card-integration](https://github.com/jxlarrea/voice-satellite-card-integration)
(AGPL-3.0). It isn't included here; it's loaded from your own Home Assistant at run time.
This module: MIT (see `LICENSE`).
