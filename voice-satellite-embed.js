/* voice-satellite-embed: run the Voice Satellite integration's browser satellite on any web page.
   https://github.com/jxlarrea/voice-satellite-card-integration runs a full Assist voice satellite
   (wake word, pipeline, timers, announcements, media player) inside Home Assistant's own frontend.
   This module lets a page that is NOT Home Assistant's frontend (a custom wall-tablet dashboard, a
   kiosk page, a photo frame) run the same thing, with the integration installed as usual and
   unchanged: the integration's own script is loaded from Home Assistant, and its satellite entity,
   settings, pipeline, skins, announcements and timers all work as they do there.

   How: that script looks for Home Assistant's <home-assistant> element and uses its `hass` object
   (states, entity registry, the websocket connection). This module creates a hidden element with a
   small `hass` built on a home-assistant-js-websocket connection, streaming only the entities the
   satellite needs. NOTE: that is the integration's internal contract, not a supported API; an
   update of the integration may need an update here.

   Use:
     import { startVoiceSatellite } from './voice-satellite-embed.js';
     const sat = await startVoiceSatellite({
       hassUrl: 'https://homeassistant.example.com',   // default: this page's origin
       token: '<long-lived access token>',             // or pass connection: <haws Connection>
       entity: 'assist_satellite.kitchen_tablet',      // this device's satellite (one per device)
     });
     sat.busy()           true while listening, thinking or answering
     sat.hold(true|false) let go of / take back the microphone (e.g. during a call)
     sat.stop()           unsubscribe (the integration's script stays loaded until the page reloads)

   License: MIT. The integration itself (AGPL-3.0) is not included; it is loaded from your own
   Home Assistant at run time. */

const HAWS = 'https://cdn.jsdelivr.net/npm/home-assistant-js-websocket@9.4.0/+esm';
const SCRIPT = '/voice_satellite/voice-satellite-card.js';
const ACTIVE = ['listening', 'processing', 'responding'];

export async function startVoiceSatellite(opts = {}) {
  const sat = opts.entity;
  if (!sat) throw new Error('voice-satellite-embed: pass entity: "assist_satellite.<this device>"');
  if (document.querySelector('home-assistant')) {
    /* Inside Home Assistant's own frontend the integration already runs; a second copy would take
       the satellite away from it. */
    console.info('[vs-embed] Home Assistant frontend detected; not starting a second satellite');
    return { busy: () => false, hold() {}, stop() {} };
  }
  const hassUrl = (opts.hassUrl || location.origin).replace(/\/$/, '');
  const log = (...a) => opts.debug && console.log('[vs-embed]', ...a);

  /* ---- connection ---- */
  let conn = opts.connection;
  if (!conn) {
    if (!opts.token) throw new Error('voice-satellite-embed: pass token (a long-lived access token) or connection');
    const haws = await import(opts.hawsUrl || HAWS);
    conn = await haws.createConnection({ auth: haws.createLongLivedTokenAuth(hassUrl, opts.token) });
  }

  /* ---- entity registry: the compact display list has what the satellite reads (platform and
     translation_key: it finds its settings entities by them, through its device) ---- */
  let entities = {};
  async function loadRegistry() {
    const r = await conn.sendMessagePromise({ type: 'config/entity_registry/list_for_display' });
    const cats = r.entity_categories || {};
    const map = {};
    for (const e of r.entities) {
      map[e.ei] = { entity_id: e.ei, device_id: e.di || null, area_id: e.ai || null, platform: e.pl,
        translation_key: e.tk || null, entity_category: e.ec != null ? cats[e.ec] : null,
        name: e.en != null ? e.en : null, icon: e.ic || null, hidden: !!e.hb, labels: e.lb || [] };
    }
    entities = map;          // a new object only when the registry changes: the satellite indexes by it
  }

  /* ---- states of the satellite, its sibling entities (settings, media player) and the player its
     text-to-speech output select names; subscribe_entities with a list, compressed format ---- */
  const S = {};
  let watched = [], unsubStates = null;
  const wanted = () => {
    const dev = entities[sat] && entities[sat].device_id;
    const sibs = dev ? Object.values(entities).filter(e => e.device_id === dev && e.entity_id !== sat).map(e => e.entity_id) : [];
    const targets = sibs.map(id => S[id] && S[id].attributes.entity_id).filter(x => typeof x === 'string' && x.includes('.'));
    return [...new Set([sat, ...sibs, ...targets])].sort();
  };
  async function subscribeStates() {
    const ids = wanted();
    if (ids.join() === watched.join() && unsubStates) return;
    watched = ids;
    if (unsubStates) { const u = unsubStates; unsubStates = null; u().catch(() => {}); }
    unsubStates = await conn.subscribeMessage(onStates, { type: 'subscribe_entities', entity_ids: ids });
  }
  function onStates(ev) {
    if (ev.a) for (const id in ev.a) {
      const x = ev.a[id];
      S[id] = { entity_id: id, state: x.s, attributes: x.a || {}, last_changed: x.lc, last_updated: x.lu || x.lc,
        context: { id: '', parent_id: null, user_id: null } };
    }
    if (ev.c) for (const id in ev.c) {
      const cur = S[id]; if (!cur) continue;
      const d = ev.c[id], p = d['+'], n = Object.assign({}, cur);    // a changed entity gets a new object
      if (p) {
        if ('s' in p) n.state = p.s;
        if (p.a) n.attributes = Object.assign({}, cur.attributes, p.a);
        if ('lc' in p) { n.last_changed = p.lc; n.last_updated = p.lc; }
        if ('lu' in p) n.last_updated = p.lu;
      }
      if (d['-'] && d['-'].a) { n.attributes = Object.assign({}, n.attributes); d['-'].a.forEach(k => delete n.attributes[k]); }
      S[id] = n;
    }
    if (ev.r) ev.r.forEach(id => delete S[id]);
    publish();
    if (wanted().join() !== watched.join()) subscribeStates().catch(e => log('resubscribe failed', e));
  }

  /* ---- the hass object: a new one on every change (the satellite polls the element once a second
     and reacts only to a different object) ---- */
  let config = {};
  const el = document.createElement('home-assistant');
  el.hidden = true;
  function publish() {
    el.hass = {
      states: Object.assign({}, S), entities, connection: conn, config,
      language: opts.language || 'en', selectedLanguage: null, user: null,
      locale: { language: opts.language || 'en', number_format: 'language', time_format: 'language',
        date_format: 'language', first_weekday: 'language', time_zone: 'local' },
      themes: { darkMode: true, theme: 'default', default_theme: 'default', themes: {} },
      callService: (domain, service, data, target) => conn.sendMessagePromise(Object.assign(
        { type: 'call_service', domain, service, service_data: data || {} }, target ? { target } : {})),
      callWS: msg => conn.sendMessagePromise(msg),
      hassUrl: (path = '') => hassUrl + path,
    };
  }

  await loadRegistry();
  if (!entities[sat]) throw new Error(`voice-satellite-embed: ${sat} is not in Home Assistant (add a Voice Satellite entry for this device first)`);
  config = await conn.sendMessagePromise({ type: 'get_config' }).catch(() => ({}));
  await subscribeStates();
  publish();
  document.body.appendChild(el);

  /* Registry changes (a setting renamed, the TTS target changed): reload and resubscribe. */
  let regT = 0;
  const unsubReg = await conn.subscribeEvents(() => {
    clearTimeout(regT);
    regT = setTimeout(() => loadRegistry().then(subscribeStates).then(publish).catch(e => log('registry reload failed', e)), 2000);
  }, 'entity_registry_updated');
  /* haws resubscribes on reconnect; refresh the registry too (entities may have changed meanwhile). */
  const onReady = () => loadRegistry().then(() => { watched = []; return subscribeStates(); }).then(publish).catch(() => {});
  conn.addEventListener('ready', onReady);

  /* ---- load the integration's script; the satellite to use is read from localStorage ---- */
  try { localStorage.setItem('vs-satellite-entity', sat); } catch (e) {}
  if (!document.querySelector(`script[data-vs-embed]`)) {
    const v = S[sat] && S[sat].attributes.integration_version;
    const s = document.createElement('script');
    s.type = 'module';
    s.dataset.vsEmbed = '';
    s.src = hassUrl + SCRIPT + (v ? '?v=' + encodeURIComponent(v) : '');
    s.onerror = () => console.error('[vs-embed] could not load ' + s.src + ' (is the Voice Satellite integration installed?)');
    document.head.appendChild(s);
  }
  log('started for', sat, 'watching', watched);

  return {
    busy: () => ACTIVE.includes(S[sat] && S[sat].state),
    /* The integration's own intercom hand-off (private API, used the same way by its card). */
    hold(on) { const x = window.__vsSession; if (x && x._setIntercomHold) x._setIntercomHold(!!on); },
    stop() {
      conn.removeEventListener('ready', onReady);
      if (unsubStates) unsubStates().catch(() => {});
      unsubReg().catch(() => {});
      el.remove();
    },
  };
}
