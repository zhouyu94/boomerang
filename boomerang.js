/**
 * @class BOOMR
 * @desc
 * boomerang measures various performance characteristics of your user's browsing
 * experience and beacons it back to your server.
 *
 * To use this you'll need a web site, lots of users and the ability to do
 * something with the data you collect.  How you collect the data is up to
 * you, but we have a few ideas.
 *
 * Everything in boomerang is accessed through the `BOOMR` object, which is
 * available on `window.BOOMR`.  It contains the public API, utility functions
 * ({@link BOOMR.utils}) and all of the plugins ({@link BOOMR.plugins}).
 *
 * Each plugin has its own API, but is reachable through {@link BOOMR.plugins}.
 *
 * ## Beacon Parameters
 *
 * The core boomerang object will add the following parameters to the beacon.
 *
 * Note that each individual {@link BOOMR.plugins plugin} will add its own
 * parameters as well.
 *
 * * `v`: Boomerang version
 * * `u`: The page's URL (for most beacons), or the `XMLHttpRequest` URL
 * * `pgu`: The page's URL (for `XMLHttpRequest` beacons)
 * * `pid`: Page ID (8 characters)
 * * `r`: Navigation referrer (from `document.location`)
 * * `vis.pre`: `1` if the page transitioned from prerender to visible
 * * `xhr.pg`: The `XMLHttpRequest` page group
 * * `errors`: Error messages of errors detected in Boomerang code, separated by a newline
 */

/**
 * @typedef TimeStamp
 * @type {number}
 *
 * @desc
 * A [Unix Epoch](https://en.wikipedia.org/wiki/Unix_time) timestamp (milliseconds
 * since 1970) created by [BOOMR.now()]{@link BOOMR.now}.
 *
 * If `DOMHighResTimeStamp` (`performance.now()`) is supported, it is
 * a `DOMHighResTimeStamp` (with microsecond resolution in the fractional),
 * otherwise, it is `Date.now()`.
 */

/**
 * @global
 * @type {TimeStamp}
 * @desc
 * Timestamp the boomerang.js script started executing.
 *
 * This has to be global so that we don't wait for this entire
 * script to download and execute before measuring the
 * time.  We also declare it without `var` so that we can later
 * `delete` it.  This is the only way that works on Internet Explorer.
 */
BOOMR_start = new Date().getTime();

/**
 * @function
 * @global
 * @desc
 * Check the value of `document.domain` and fix it if incorrect.
 *
 * This function is run at the top of boomerang, and then whenever
 * {@link BOOMR.init} is called.  If boomerang is running within an IFRAME, this
 * function checks to see if it can access elements in the parent
 * IFRAME.  If not, it will fudge around with `document.domain` until
 * it finds a value that works.
 *
 * This allows site owners to change the value of `document.domain` at
 * any point within their page's load process, and we will adapt to
 * it.
 *
 * @param {string} domain Domain name as retrieved from page URL
 */
function BOOMR_check_doc_domain(domain) {
	/*eslint no-unused-vars:0*/
	var test;

	if (!window) {
		return;
	}

	// If domain is not passed in, then this is a global call
	// domain is only passed in if we call ourselves, so we
	// skip the frame check at that point
	if (!domain) {
		// If we're running in the main window, then we don't need this
		if (window.parent === window || !document.getElementById("boomr-if-as")) {
			return;// true;	// nothing to do
		}

		if (window.BOOMR && BOOMR.boomerang_frame && BOOMR.window) {
			try {
				// If document.domain is changed during page load (from www.blah.com to blah.com, for example),
				// BOOMR.window.location.href throws "Permission Denied" in IE.
				// Resetting the inner domain to match the outer makes location accessible once again
				if (BOOMR.boomerang_frame.document.domain !== BOOMR.window.document.domain) {
					BOOMR.boomerang_frame.document.domain = BOOMR.window.document.domain;
				}
			}
			catch (err) {
				if (!BOOMR.isCrossOriginError(err)) {
					BOOMR.addError(err, "BOOMR_check_doc_domain.domainFix");
				}
			}
		}
		domain = document.domain;
	}

	if (domain.indexOf(".") === -1) {
		return;// false;	// not okay, but we did our best
	}

	// 1. Test without setting document.domain
	try {
		test = window.parent.document;
		return;// test !== undefined;	// all okay
	}
	// 2. Test with document.domain
	catch (err) {
		document.domain = domain;
	}
	try {
		test = window.parent.document;
		return;// test !== undefined;	// all okay
	}
	// 3. Strip off leading part and try again
	catch (err) {
		domain = domain.replace(/^[\w\-]+\./, "");
	}

	BOOMR_check_doc_domain(domain);
}

BOOMR_check_doc_domain();

// Construct BOOMR
// w is window
(function(w) {
	var impl, boomr, d, createCustomEvent, dispatchEvent, visibilityState, visibilityChange, orig_w = w;

	// If the window that boomerang is running in is not top level (ie, we're running in an iframe)
	// and if this iframe contains a script node with an id of "boomr-if-as",
	// Then that indicates that we are using the iframe loader, so the page we're trying to measure
	// is w.parent
	//
	// Note that we use `document` rather than `w.document` because we're specifically interested in
	// the document of the currently executing context rather than a passed in proxy.
	//
	// The only other place we do this is in `BOOMR.utils.getMyURL` below, for the same reason, we
	// need the full URL of the currently executing (boomerang) script.
	if (w.parent !== w &&
	    document.getElementById("boomr-if-as") &&
	    document.getElementById("boomr-if-as").nodeName.toLowerCase() === "script") {
		w = w.parent;
	}

	d = w.document;

	// Short namespace because I don't want to keep typing BOOMERANG
	if (!w.BOOMR) {
		w.BOOMR = {};
	}

	BOOMR = w.BOOMR;

	// don't allow this code to be included twice
	if (BOOMR.version) {
		return;
	}

	/**
	 * Boomerang version, formatted as major.minor.patchlevel.
	 *
	 * This variable is replaced during build (`grunt build`).
	 *
	 * @type {string}
	 *
	 * @memberof BOOMR
	 */
	BOOMR.version = "%boomerang_version%";

	/**
	 * The main document window.
	 * * If Boomerang was loaded in an IFRAME, this is the parent window
	 * * If Boomerang was loaded inline, this is the current window
	 *
	 * @type {Window}
	 *
	 * @memberof BOOMR
	 */
	BOOMR.window = w;

	/**
	 * The Boomerang frame:
	 * * If Boomerang was loaded in an IFRAME, this is the IFRAME
	 * * If Boomerang was loaded inline, this is the current window
	 *
	 * @type {Window}
	 *
	 * @memberof BOOMR
	 */
	BOOMR.boomerang_frame = orig_w;

	/**
	 * @class BOOMR.plugins
	 * @desc
	 * Boomerang plugin namespace.
	 *
	 * All plugins should add their plugin object to `BOOMR.plugins`.
	 *
	 * A plugin should have, at minimum, the following exported functions:
	 * * `init(config)`
	 * * `is_complete()`
	 *
	 * See {@tutorial creating-plugins} for details.
	 */
	if (!BOOMR.plugins) {
		BOOMR.plugins = {};
	}

	// CustomEvent proxy for IE9 & 10 from https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent
	(function() {
		try {
			if (new w.CustomEvent("CustomEvent") !== undefined) {
				createCustomEvent = function(e_name, params) {
					return new w.CustomEvent(e_name, params);
				};
			}
		}
		catch (ignore) {
			// empty
		}

		try {
			if (!createCustomEvent && d.createEvent && d.createEvent("CustomEvent")) {
				createCustomEvent = function(e_name, params) {
					var evt = d.createEvent("CustomEvent");
					params = params || { cancelable: false, bubbles: false };
					evt.initCustomEvent(e_name, params.bubbles, params.cancelable, params.detail);

					return evt;
				};
			}
		}
		catch (ignore) {
			// empty
		}

		if (!createCustomEvent && d.createEventObject) {
			createCustomEvent = function(e_name, params) {
				var evt = d.createEventObject();
				evt.type = evt.propertyName = e_name;
				evt.detail = params.detail;

				return evt;
			};
		}

		if (!createCustomEvent) {
			createCustomEvent = function() { return undefined; };
		}
	}());

	/**
	 * Dispatch a custom event to the browser
	 * @param {string} e_name The custom event name that consumers can subscribe to
	 * @param {object} e_data Any data passed to subscribers of the custom event via the `event.detail` property
	 * @param {boolean} async By default, custom events are dispatched immediately.
	 * Set to true if the event should be dispatched once the browser has finished its current
	 * JavaScript execution.
	 */
	dispatchEvent = function(e_name, e_data, async) {
		var ev = createCustomEvent(e_name, {"detail": e_data});
		if (!ev) {
			return;
		}

		function dispatch() {
			try {
				if (d.dispatchEvent) {
					d.dispatchEvent(ev);
				}
				else if (d.fireEvent) {
					d.fireEvent("onpropertychange", ev);
				}
			}
			catch (e) {
				BOOMR.debug("Error when dispatching " + e_name);
			}
		}

		if (async) {
			BOOMR.setImmediate(dispatch);
		}
		else {
			dispatch();
		}
	};

	// visibilitychange is useful to detect if the page loaded through prerender
	// or if the page never became visible
	// http://www.w3.org/TR/2011/WD-page-visibility-20110602/
	// http://www.nczonline.net/blog/2011/08/09/introduction-to-the-page-visibility-api/
	// https://developer.mozilla.org/en-US/docs/Web/Guide/User_experience/Using_the_Page_Visibility_API

	// Set the name of the hidden property and the change event for visibility
	if (typeof d.hidden !== "undefined") {
		visibilityState = "visibilityState";
		visibilityChange = "visibilitychange";
	}
	else if (typeof d.mozHidden !== "undefined") {
		visibilityState = "mozVisibilityState";
		visibilityChange = "mozvisibilitychange";
	}
	else if (typeof d.msHidden !== "undefined") {
		visibilityState = "msVisibilityState";
		visibilityChange = "msvisibilitychange";
	}
	else if (typeof d.webkitHidden !== "undefined") {
		visibilityState = "webkitVisibilityState";
		visibilityChange = "webkitvisibilitychange";
	}

	// impl is a private object not reachable from outside the BOOMR object.
	// Users can set properties by passing in to the init() method.
	impl = {
		// Beacon URL
		beacon_url: "",

		// Forces protocol-relative URLs to HTTPS
		beacon_url_force_https: true,

		// List of string regular expressions that must match the beacon_url.  If
		// not set, or the list is empty, all beacon URLs are allowed.
		beacon_urls_allowed: [],

		// Beacon request method, either GET, POST or AUTO. AUTO will check the
		// request size then use GET if the request URL is less than MAX_GET_LENGTH
		// chars. Otherwise, it will fall back to a POST request.
		beacon_type: "AUTO",

		// Beacon authorization key value. Most systems will use the 'Authentication'
		// keyword, but some some services use keys like 'X-Auth-Token' or other
		// custom keys.
		beacon_auth_key: "Authorization",

		// Beacon authorization token. This is only needed if your are using a POST
		// and the beacon requires an Authorization token to accept your data.  This
		// disables use of the browser sendBeacon() API.
		beacon_auth_token: undefined,

		// Sends beacons with Credentials (applies to XHR beacons, not IMG or `sendBeacon()`).
		// If you need this, you may want to enable `beacon_disable_sendbeacon` as
		// `sendBeacon()` does not support credentials.
		beacon_with_credentials: false,

		// Disables navigator.sendBeacon() support
		beacon_disable_sendbeacon: false,

		// Strip out everything except last two parts of hostname.
		// This doesn't work well for domains that end with a country tld,
		// but we allow the developer to override site_domain for that.
		// You can disable all cookies by setting site_domain to a falsy value.
		site_domain: w.location.hostname.
					replace(/.*?([^.]+\.[^.]+)\.?$/, "$1").
					toLowerCase(),

		// User's ip address determined on the server.  Used for the BW cookie.
		user_ip: "",

		// Whether or not to send beacons on page load
		autorun: true,

		// Whether or not we've sent a page load beacon
		hasSentPageLoadBeacon: false,

		// document.referrer
		r: undefined,

		// strip_query_string: false,

		// onloadfired: false,

		// handlers_attached: false,

		// waiting_for_config: false,

		events: {
			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired when the page is usable by the user.
			 *
			 * By default this is fired when `window.onload` fires, but if you
			 * set `autorun` to false when calling {@link BOOMR.init}, then you
			 * must explicitly fire this event by calling {@link BOOMR#event:page_ready}.
			 *
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/GlobalEventHandlers/onload}
			 * @event BOOMR#page_ready
			 * @property {Event} [event] Event triggering the page_ready
			 */
			"page_ready": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired just before the browser unloads the page.
			 *
			 * The first event of `window.pagehide`, `window.beforeunload`,
			 * or `window.unload` will trigger this.
			 *
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/Events/pagehide}
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/WindowEventHandlers/onbeforeunload}
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/WindowEventHandlers/onunload}
			 * @event BOOMR#page_unload
			 */
			"page_unload": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired before the document is about to be unloaded.
			 *
			 * `window.beforeunload` will trigger this.
			 *
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/WindowEventHandlers/onbeforeunload}
			 * @event BOOMR#before_unload
			 */
			"before_unload": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired on `document.DOMContentLoaded`.
			 *
			 * The `DOMContentLoaded` event is fired when the initial HTML document
			 * has been completely loaded and parsed, without waiting for stylesheets,
			 * images, and subframes to finish loading
			 *
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/Events/DOMContentLoaded}
			 * @event BOOMR#dom_loaded
			 */
			"dom_loaded": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired on `document.visibilitychange`.
			 *
			 * The `visibilitychange` event is fired when the content of a tab has
			 * become visible or has been hidden.
			 *
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/Events/visibilitychange}
			 * @event BOOMR#visibility_changed
			 */
			"visibility_changed": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired when the `visibilityState` of the document has changed from
			 * `prerender` to `visible`
			 *
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/Events/visibilitychange}
			 * @event BOOMR#prerender_to_visible
			 */
			"prerender_to_visible": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired when a beacon is about to be sent.
			 *
			 * The subscriber can still add variables to the beacon at this point,
			 * either by modifying the `vars` paramter or calling {@link BOOMR.addVar}.
			 *
			 * @event BOOMR#before_beacon
			 * @property {object} vars Beacon variables
			 */
			"before_beacon": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired when a beacon was sent.
			 *
			 * The beacon variables cannot be modified at this point.  Any calls
			 * to {@link BOOMR.addVar} or {@link BOOMR.removeVar} will apply to the
			 * next beacon.
			 *
			 * Also known as `onbeacon`.
			 *
			 * @event BOOMR#beacon
			 * @property {object} vars Beacon variables
			 */
			"beacon": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired when the page load beacon has been sent.
			 *
			 * This event should only happen once on a page.  It does not apply
			 * to SPA soft navigations.
			 *
			 * @event BOOMR#page_load_beacon
			 * @property {object} vars Beacon variables
			 */
			"page_load_beacon": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired when an XMLHttpRequest has finished, or, if something calls
			 * {@link BOOMR.responseEnd}.
			 *
			 * @event BOOMR#xhr_load
			 * @property {object} data Event data
			 */
			"xhr_load": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired when the `click` event has happened on the `document`.
			 *
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/GlobalEventHandlers/onclick}
			 * @event BOOMR#click
			 */
			"click": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired when any `FORM` element is submitted.
			 *
			 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/submit}
			 * @event BOOMR#form_submit
			 */
			"form_submit": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever new configuration data is applied via {@link BOOMR.init}.
			 *
			 * Also known as `onconfig`.
			 *
			 * @event BOOMR#config
			 * @property {object} data Configuration data
			 */
			"config": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever `XMLHttpRequest.open` is called.
			 *
			 * This event will only happen if {@link BOOMR.plugins.AutoXHR} is enabled.
			 *
			 * @event BOOMR#xhr_init
			 * @property {string} type XHR type ("xhr")
			 */
			"xhr_init": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever a SPA plugin is about to track a new navigation.
			 *
			 * @event BOOMR#spa_init
			 * @property {string} navType Navigation type (`spa` or `spa_hard`)
			 * @property {object} param SPA navigation parameters
			 */
			"spa_init": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever a SPA navigation is complete.
			 *
			 * @event BOOMR#spa_navigation
			 */
			"spa_navigation": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever a SPA navigation is cancelled.
			 *
			 * @event BOOMR#spa_cancel
			 */
			"spa_cancel": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever `XMLHttpRequest.send` is called.
			 *
			 * This event will only happen if {@link BOOMR.plugins.AutoXHR} is enabled.
			 *
			 * @event BOOMR#xhr_send
			 * @property {object} xhr `XMLHttpRequest` object
			 */
			"xhr_send": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever and `XMLHttpRequest` has an error (if its `status` is
			 * set).
			 *
			 * This event will only happen if {@link BOOMR.plugins.AutoXHR} is enabled.
			 *
			 * Also known as `onxhrerror`.
			 *
			 * @event BOOMR#xhr_error
			 * @property {object} data XHR data
			 */
			"xhr_error": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever a page error has happened.
			 *
			 * This event will only happen if {@link BOOMR.plugins.Errors} is enabled.
			 *
			 * Also known as `onerror`.
			 *
			 * @event BOOMR#error
			 * @property {object} err Error
			 */
			"error": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever an `XMLHttpRequest.send()` is called
			 *
			 * This event will only happen if {@link BOOMR.plugins.AutoXHR} is enabled.
			 *
			 * @event BOOMR#xhr_send
			 * @property {object} req XMLHttpRequest
			 */
			"xhr_send": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever connection information changes via the
			 * Network Information API.
			 *
			 * This event will only happen if {@link BOOMR.plugins.Mobile} is enabled.
			 *
			 * @event BOOMR#netinfo
			 * @property {object} connection `navigator.connection`
			 */
			"netinfo": [],

			/**
			 * Boomerang event, subscribe via {@link BOOMR.subscribe}.
			 *
			 * Fired whenever a Rage Click is detected.
			 *
			 * This event will only happen if {@link BOOMR.plugins.Continuity} is enabled.
			 *
			 * @event BOOMR#rage_click
			 * @property {Event} e Event
			 */
			"rage_click": []
		},

		/**
		 * Public events
		 */
		public_events: {
			/**
			 * Public event (fired on `document`), and can be subscribed via
			 * `document.addEventListener("onBeforeBoomerangBeacon", ...)` or
			 * `document.attachEvent("onpropertychange", ...)`.
			 *
			 * Maps to {@link BOOMR#event:before_beacon}
			 *
			 * @event document#onBeforeBoomerangBeacon
			 * @property {object} vars Beacon variables
			 */
			"before_beacon": "onBeforeBoomerangBeacon",

			/**
			 * Public event (fired on `document`), and can be subscribed via
			 * `document.addEventListener("onBoomerangBeacon", ...)` or
			 * `document.attachEvent("onpropertychange", ...)`.
			 *
			 * Maps to {@link BOOMR#event:before_beacon}
			 *
			 * @event document#onBoomerangBeacon
			 * @property {object} vars Beacon variables
			 */
			"beacon": "onBoomerangBeacon",

			/**
			 * Public event (fired on `document`), and can be subscribed via
			 * `document.addEventListener("onBoomerangLoaded", ...)` or
			 * `document.attachEvent("onpropertychange", ...)`.
			 *
			 * Fired when {@link BOOMR} has loaded and can be used.
			 *
			 * @event document#onBoomerangLoaded
			 */
			"onboomerangloaded": "onBoomerangLoaded"
		},

		/**
		 * Maps old event names to their updated name
		 */
		translate_events: {
			"onbeacon": "beacon",
			"onconfig": "config",
			"onerror": "error",
			"onxhrerror": "xhr_error"
		},

		listenerCallbacks: {},

		vars: {},
		singleBeaconVars: {},

		/**
		 * Variable priority lists:
		 * -1 = first
		 *  1 = last
		 */
		varPriority: {
			"-1": {},
			"1": {}
		},

		errors: {},

		disabled_plugins: {},

		localStorageSupported: false,
		LOCAL_STORAGE_PREFIX: "_boomr_",

		xb_handler: function(type) {
			return function(ev) {
				var target;
				if (!ev) { ev = w.event; }
				if (ev.target) { target = ev.target; }
				else if (ev.srcElement) { target = ev.srcElement; }
				if (target.nodeType === 3) {  // defeat Safari bug
					target = target.parentNode;
				}

				// don't capture events on flash objects
				// because of context slowdowns in PepperFlash
				if (target &&
				    target.nodeName &&
				    target.nodeName.toUpperCase() === "OBJECT" &&
				    target.type === "application/x-shockwave-flash") {
					return;
				}
				impl.fireEvent(type, target);
			};
		},

		clearEvents: function() {
			var eventName;

			for (eventName in this.events) {
				if (this.events.hasOwnProperty(eventName)) {
					this.events[eventName] = [];
				}
			}
		},

		clearListeners: function() {
			var type, i;

			for (type in impl.listenerCallbacks) {
				if (impl.listenerCallbacks.hasOwnProperty(type)) {
					// remove all callbacks -- removeListener is guaranteed
					// to remove the element we're calling with
					while (impl.listenerCallbacks[type].length) {
						BOOMR.utils.removeListener(
						    impl.listenerCallbacks[type][0].el,
						    type,
						    impl.listenerCallbacks[type][0].fn);
					}
				}
			}

			impl.listenerCallbacks = {};
		},

		fireEvent: function(e_name, data) {
			var i, handler, handlers, handlersLen;

			e_name = e_name.toLowerCase();

			// translate old names
			if (this.translate_events[e_name]) {
				e_name = this.translate_events[e_name];
			}

			if (!this.events.hasOwnProperty(e_name)) {
				return;// false;
			}

			if (this.public_events.hasOwnProperty(e_name)) {
				dispatchEvent(this.public_events[e_name], data);
			}

			handlers = this.events[e_name];

			// Before we fire any event listeners, let's call real_sendBeacon() to flush
			// any beacon that is being held by the setImmediate.
			if (e_name !== "before_beacon" && e_name !== "beacon") {
				BOOMR.real_sendBeacon();
			}

			// only call handlers at the time of fireEvent (and not handlers that are
			// added during this callback to avoid an infinite loop)
			handlersLen = handlers.length;
			for (i = 0; i < handlersLen; i++) {
				try {
					handler = handlers[i];
					handler.fn.call(handler.scope, data, handler.cb_data);
				}
				catch (err) {
					BOOMR.addError(err, "fireEvent." + e_name + "<" + i + ">");
				}
			}

			// remove any 'once' handlers now that we've fired all of them
			for (i = 0; i < handlersLen; i++) {
				if (handlers[i].once) {
					handlers.splice(i, 1);
					handlersLen--;
					i--;
				}
			}

			return;// true;
		},

		spaNavigation: function() {
			// a SPA navigation occured, force onloadfired to true
			impl.onloadfired = true;
		},

		/**
		 * Determines whether a beacon URL is allowed based on
		 * `beacon_urls_allowed` config
		 *
		 * @param {string} url URL to test
		 *
		 */
		beaconUrlAllowed: function(url) {
			if (!impl.beacon_urls_allowed || impl.beacon_urls_allowed.length === 0) {
				return true;
			}

			for (var i = 0; i < impl.beacon_urls_allowed.length; i++) {
				var regEx = new RegExp(impl.beacon_urls_allowed[i]);
				if (regEx.exec(url)) {
					return true;
				}
			}

			return false;
		},

		/**
		 * Checks browser for localStorage support
		 */
		checkLocalStorageSupport: function() {
			var name = impl.LOCAL_STORAGE_PREFIX + "clss";
			impl.localStorageSupported = false;

			// Browsers with cookies disabled or in private/incognito mode may throw an
			// error when accessing the localStorage variable
			try {
				// we need JSON and localStorage support
				if (!w.JSON || !w.localStorage) {
					return;
				}

				w.localStorage.setItem(name, name);
				impl.localStorageSupported = (w.localStorage.getItem(name) === name);
				w.localStorage.removeItem(name);
			}
			catch (ignore) {
				impl.localStorageSupported = false;
			}
		}
	};

	// We create a boomr object and then copy all its properties to BOOMR so that
	// we don't overwrite anything additional that was added to BOOMR before this
	// was called... for example, a plugin.
	boomr = {
		/**
		 * The timestamp when boomerang.js showed up on the page.
		 *
		 * This is the value of `BOOMR_start` we set earlier.
		 * @type {TimeStamp}
		 *
		 * @memberof BOOMR
		 */
		t_start: BOOMR_start,

		/**
		 * When the Boomerang plugins have all run.
		 *
		 * This value is generally set in zzz-last-plugin.js.
		 * @type {TimeStamp}
		 *
		 * @memberof BOOMR
		 */
		t_end: undefined,

		/**
		 * URL of boomerang.js.
		 *
		 * @type {string}
		 *
		 * @memberof BOOMR
		 */
		url: "",

		/**
		 * (Optional) URL of configuration file
		 *
		 * @type {string}
		 *
		 * @memberof BOOMR
		 */
		config_url: null,

		/**
		 * Whether or not Boomerang was loaded after the `onload` event.
		 *
		 * @type {boolean}
		 *
		 * @memberof BOOMR
		 */
		loadedLate: false,

		/**
		 * Current number of beacons sent.
		 *
		 * Will be incremented and added to outgoing beacon as `n`.
		 *
		 * @type {number}
		 *
		 */
		beaconsSent: 0,

		/**
		 * Constants visible to the world
		 * @class BOOMR.constants
		 */
		constants: {
			/**
			 * SPA beacon types
			 *
			 * @type {string[]}
			 *
			 * @memberof BOOMR.constants
			 */
			BEACON_TYPE_SPAS: ["spa", "spa_hard"],

			/**
			 * Maximum GET URL length.
			 * Using 2000 here as a de facto maximum URL length based on:
 			 * http://stackoverflow.com/questions/417142/what-is-the-maximum-length-of-a-url-in-different-browsers
			 *
			 * @type {number}
			 *
			 * @memberof BOOMR.constants
			 */
			MAX_GET_LENGTH: 2000
		},

		/**
		 * Session data
		 * @class BOOMR.session
		 */
		session: {
			/**
			 * Session Domain.
			 *
			 * You can disable all cookies by setting site_domain to a falsy value.
			 *
			 * @type {string}
			 *
			 * @memberof BOOMR.session
			 */
			domain: impl.site_domain,

			/**
			 * Session ID.  This will be randomly generated in the client but may
			 * be overwritten by the server if not set.
			 *
			 * @type {string}
			 *
			 * @memberof BOOMR.session
			 */
			ID: Math.random().toString(36).replace(/^0\./, ""),

			/**
			 * Session start time.
			 *
			 * @type {TimeStamp}
			 *
			 * @memberof BOOMR.session
			 */
			start: undefined,

			/**
			 * Session length (number of pages)
			 *
			 * @type {number}
			 *
			 * @memberof BOOMR.session
			 */
			length: 0,

			/**
			 * Session enabled (Are session cookies enabled?)
			 *
			 * @type {boolean}
			 *
			 * @memberof BOOMR.session
			 */
			enabled: true
		},

		/**
		 * @class BOOMR.utils
		 */
		utils: {
			/**
			 * Determines whether or not the browser has `postMessage` support
			 *
			 * @returns {boolean} True if supported
			 */
			hasPostMessageSupport: function() {
				if (!w.postMessage || typeof w.postMessage !== "function" && typeof w.postMessage !== "object") {
					return false;
				}
				return true;
			},

			/**
			 * Converts an object to a string.
			 *
			 * @param {object} o Object
			 * @param {string} separator Member separator
			 * @param {number} nest_level Number of levels to recurse
			 *
			 * @returns {string} String representation of the object
			 *
			 * @memberof BOOMR.utils
			 */
			objectToString: function(o, separator, nest_level) {
				var value = [], k;

				if (!o || typeof o !== "object") {
					return o;
				}
				if (separator === undefined) {
					separator = "\n\t";
				}
				if (!nest_level) {
					nest_level = 0;
				}

				if (BOOMR.utils.isArray(o)) {
					for (k = 0; k < o.length; k++) {
						if (nest_level > 0 && o[k] !== null && typeof o[k] === "object") {
							value.push(
								this.objectToString(
									o[k],
									separator + (separator === "\n\t" ? "\t" : ""),
									nest_level - 1
								)
							);
						}
						else {
							if (separator === "&") {
								value.push(encodeURIComponent(o[k]));
							}
							else {
								value.push(o[k]);
							}
						}
					}
					separator = ",";
				}
				else {
					for (k in o) {
						if (Object.prototype.hasOwnProperty.call(o, k)) {
							if (nest_level > 0 && o[k] !== null && typeof o[k] === "object") {
								value.push(encodeURIComponent(k) + "=" +
									this.objectToString(
										o[k],
										separator + (separator === "\n\t" ? "\t" : ""),
										nest_level - 1
									)
								);
							}
							else {
								if (separator === "&") {
									value.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k]));
								}
								else {
									value.push(k + "=" + o[k]);
								}
							}
						}
					}
				}

				return value.join(separator);
			},

			/**
			 * Gets the value of the cookie identified by `name`.
			 *
			 * @param {string} name Cookie name
			 *
			 * @returns {string|null} Cookie value, if set.
			 *
			 * @memberof BOOMR.utils
			 */
			getCookie: function(name) {
				if (!name) {
					return null;
				}

				name = " " + name + "=";

				var i, cookies;
				cookies = " " + d.cookie + ";";
				if ((i = cookies.indexOf(name)) >= 0) {
					i += name.length;
					cookies = cookies.substring(i, cookies.indexOf(";", i)).replace(/^"/, "").replace(/"$/, "");
					return cookies;
				}
			},

			/**
			 * Sets the cookie named `name` to the serialized value of `subcookies`.
			 *
			 * @param {string} name The name of the cookie
			 * @param {object} subcookies Key/value pairs to write into the cookie.
			 * These will be serialized as an & separated list of URL encoded key=value pairs.
			 * @param {number} max_age Lifetime in seconds of the cookie.
			 * Set this to 0 to create a session cookie that expires when
			 * the browser is closed. If not set, defaults to 0.
			 *
			 * @returns {boolean} True if the cookie was set successfully
			 *
			 * @example
			 * BOOMR.utils.setCookie("RT", { s: t_start, r: url });
			 *
			 * @memberof BOOMR.utils
			 */
			setCookie: function(name, subcookies, max_age) {
				var value, nameval, savedval, c, exp;

				if (!name || !BOOMR.session.domain || typeof subcookies === "undefined") {
					BOOMR.debug("Invalid parameters or site domain: " + name + "/" + subcookies + "/" + BOOMR.session.domain);

					BOOMR.addVar("nocookie", 1);
					return false;
				}

				value = this.objectToString(subcookies, "&");
				nameval = name + "=\"" + value + "\"";

				if (nameval.length < 500) {
					c = [nameval, "path=/", "domain=" + BOOMR.session.domain];
					if (typeof max_age === "number") {
						exp = new Date();
						exp.setTime(exp.getTime() + max_age * 1000);
						exp = exp.toGMTString();
						c.push("expires=" + exp);
					}

					d.cookie = c.join("; ");
					// confirm cookie was set (could be blocked by user's settings, etc.)
					savedval = this.getCookie(name);
					// the saved cookie should be the same or undefined in the case of removeCookie
					if (value === savedval ||
					    (typeof savedval === "undefined" && typeof max_age === "number" && max_age <= 0)) {
						return true;
					}
					BOOMR.warn("Saved cookie value doesn't match what we tried to set:\n" + value + "\n" + savedval);
				}
				else {
					BOOMR.warn("Cookie too long: " + nameval.length + " " + nameval);
				}

				BOOMR.addVar("nocookie", 1);
				return false;
			},

			/**
			 * Parse a cookie string returned by {@link BOOMR.utils.getCookie} and
			 * split it into its constituent subcookies.
			 *
			 * @param {string} cookie Cookie value
			 *
			 * @returns {object} On success, an object of key/value pairs of all
			 * sub cookies. Note that some subcookies may have empty values.
			 * `null` if `cookie` was not set or did not contain valid subcookies.
			 *
			 * @memberof BOOMR.utils
			 */
			getSubCookies: function(cookie) {
				var cookies_a,
				    i, l, kv,
				    gotcookies = false,
				    cookies = {};

				if (!cookie) {
					return null;
				}

				if (typeof cookie !== "string") {
					BOOMR.debug("TypeError: cookie is not a string: " + typeof cookie);
					return null;
				}

				cookies_a = cookie.split("&");

				for (i = 0, l = cookies_a.length; i < l; i++) {
					kv = cookies_a[i].split("=");
					if (kv[0]) {
						kv.push("");  // just in case there's no value
						cookies[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
						gotcookies = true;
					}
				}

				return gotcookies ? cookies : null;
			},

			/**
			 * Removes the cookie identified by `name` by nullifying its value,
			 * and making it a session cookie.
			 *
			 * @param {string} name Cookie name
			 *
			 * @memberof BOOMR.utils
			 */
			removeCookie: function(name) {
				return this.setCookie(name, {}, -86400);
			},

			/**
			 * Retrieve items from localStorage
			 *
			 * @param {string} name Name of storage
			 *
			 * @returns {object|null} Returns object retrieved from localStorage.
			 *                       Returns undefined if not found or expired.
			 *                       Returns null if parameters are invalid or an error occured
			 *
			 * @memberof BOOMR.utils
			 */
			getLocalStorage: function(name) {
				var value, data;
				if (!name || !impl.localStorageSupported) {
					return null;
				}

				try {
					value = w.localStorage.getItem(impl.LOCAL_STORAGE_PREFIX + name);
					if (value === null) {
						return undefined;
					}
					data = w.JSON.parse(value);
				}
				catch (e) {
					BOOMR.warn(e);
					return null;
				}

				if (!data || typeof data.items !== "object") {
					// Items are invalid
					this.removeLocalStorage(name);
					return null;
				}
				if (typeof data.expires === "number") {
					if (BOOMR.now() >= data.expires) {
						// Items are expired
						this.removeLocalStorage(name);
						return undefined;
					}
				}
				return data.items;
			},

			/**
			 * Saves items in localStorage
			 * The value stored in localStorage will be a JSON string representation of {"items": items, "expiry": expiry}
			 * where items is the object we're saving and expiry is an optional epoch number of when the data is to be
			 * considered expired
			 *
			 * @param {string} name Name of storage
			 * @param {object} items Items to be saved
			 * @param {number} max_age Age in seconds before items are to be considered expired
			 *
			 * @returns {boolean} True if the localStorage was set successfully
			 *
			 * @memberof BOOMR.utils
			 */
			setLocalStorage: function(name, items, max_age) {
				var data, value, savedval;

				if (!name || !impl.localStorageSupported || typeof items !== "object") {
					return false;
				}

				data = {"items": items};

				if (typeof max_age === "number") {
					data.expires = BOOMR.now() + (max_age * 1000);
				}

				value = w.JSON.stringify(data);

				if (value.length < 50000) {
					try {
						w.localStorage.setItem(impl.LOCAL_STORAGE_PREFIX + name, value);
						// confirm storage was set (could be blocked by user's settings, etc.)
						savedval = w.localStorage.getItem(impl.LOCAL_STORAGE_PREFIX + name);
						if (value === savedval) {
							return true;
						}
					}
					catch (ignore) {
						// Empty
					}
					BOOMR.warn("Saved storage value doesn't match what we tried to set:\n" + value + "\n" + savedval);
				}
				else {
					BOOMR.warn("Storage items too large: " + value.length + " " + value);
				}

				return false;
			},

			/**
			 * Remove items from localStorage
			 *
			 * @param {string} name Name of storage
			 *
			 * @returns {boolean} True if item was removed from localStorage.
			 *
			 * @memberof BOOMR.utils
			 */
			removeLocalStorage: function(name) {
				if (!name || !impl.localStorageSupported) {
					return false;
				}
				try {
					w.localStorage.removeItem(impl.LOCAL_STORAGE_PREFIX + name);
					return true;
				}
				catch (ignore) {
					// Empty
				}
				return false;
			},

			/**
			 * Cleans up a URL by removing the query string (if configured), and
			 * limits the URL to the specified size.
			 *
			 * @param {string} url URL to clean
			 * @param {number} urlLimit Maximum size, in characters, of the URL
			 *
			 * @returns {string} Cleaned up URL
			 *
			 * @memberof BOOMR.utils
			 */
			cleanupURL: function(url, urlLimit) {
				if (!url || BOOMR.utils.isArray(url)) {
					return "";
				}

				if (impl.strip_query_string) {
					url = url.replace(/\?.*/, "?qs-redacted");
				}

				if (typeof urlLimit !== "undefined" && url && url.length > urlLimit) {
					// We need to break this URL up.  Try at the query string first.
					var qsStart = url.indexOf("?");
					if (qsStart !== -1 && qsStart < urlLimit) {
						url = url.substr(0, qsStart) + "?...";
					}
					else {
						// No query string, just stop at the limit
						url = url.substr(0, urlLimit - 3) + "...";
					}
				}

				return url;
			},

			/**
			 * Gets the URL with the query string replaced with a MD5 hash of its contents.
			 *
			 * @param {string} url URL
			 * @param {boolean} stripHash Whether or not to strip the hash
			 *
			 * @returns {string} URL with query string hashed
			 *
			 * @memberof BOOMR.utils
			 */
			hashQueryString: function(url, stripHash) {
				if (!url) {
					return url;
				}
				if (!url.match) {
					BOOMR.addError("TypeError: Not a string", "hashQueryString", typeof url);
					return "";
				}
				if (url.match(/^\/\//)) {
					url = location.protocol + url;
				}
				if (!url.match(/^(https?|file):/)) {
					BOOMR.error("Passed in URL is invalid: " + url);
					return "";
				}
				if (stripHash) {
					url = url.replace(/#.*/, "");
				}
				if (!BOOMR.utils.MD5) {
					return url;
				}
				return url.replace(/\?([^#]*)/, function(m0, m1) {
					return "?" + (m1.length > 10 ? BOOMR.utils.MD5(m1) : m1);
				});
			},

			/**
			 * Sets the object's properties if anything in config matches
			 * one of the property names.
			 *
			 * @param {object} o The plugin's `impl` object within which it stores
			 * all its configuration and private properties
			 * @param {object} config The config object passed in to the plugin's
			 * `init()` method.
			 * @param {string} plugin_name The plugin's name in the {@link BOOMR.plugins} object.
			 * @param {string[]} properties An array containing a list of all configurable
			 * properties that this plugin has.
			 *
			 * @returns {boolean} True if a property was set
			 *
			 * @memberof BOOMR.utils
			 */
			pluginConfig: function(o, config, plugin_name, properties) {
				var i, props = 0;

				if (!config || !config[plugin_name]) {
					return false;
				}

				for (i = 0; i < properties.length; i++) {
					if (config[plugin_name][properties[i]] !== undefined) {
						o[properties[i]] = config[plugin_name][properties[i]];
						props++;
					}
				}

				return (props > 0);
			},

			/**
			 * `filter` for arrays
			 *
			 * @param {Array} array The array to iterate over.
			 * @param {Function} predicate The function invoked per iteration.
			 *
			 * @returns {Array} Returns the new filtered array.
			 *
			 * @memberof BOOMR.utils
			 */
			arrayFilter: function(array, predicate) {
				var result = [];

				if (!(this.isArray(array) || (array && typeof array.length === "number")) ||
				    typeof predicate !== "function") {
					return result;
				}

				if (typeof array.filter === "function") {
					result = array.filter(predicate);
				}
				else {
					var index = -1,
					    length = array.length,
					    value;

					while (++index < length) {
						value = array[index];
						if (predicate(value, index, array)) {
							result[result.length] = value;
						}
					}
				}
				return result;
			},

			/**
			 * `find` for Arrays
			 *
			 * @param {Array} array The array to iterate over
			 * @param {Function} predicate The function invoked per iteration
			 *
			 * @returns {Array} Returns the value of first element that satisfies
			 * the predicate
			 *
			 * @memberof BOOMR.utils
			 */
			arrayFind: function(array, predicate) {
				if (!(this.isArray(array) || (array && typeof array.length === "number")) ||
				    typeof predicate !== "function") {
					return undefined;
				}

				if (typeof array.find === "function") {
					return array.find(predicate);
				}
				else {
					var index = -1,
					    length = array.length,
					    value;

					while (++index < length) {
						value = array[index];
						if (predicate(value, index, array)) {
							return value;
						}
					}
					return undefined;
				}
			},

			/**
			 * MutationObserver feature detection
			 *
			 * @returns {boolean} Returns true if MutationObserver is supported.
			 * Always returns false for IE 11 due several bugs in it's implementation that MS flagged as Won't Fix.
			 * In IE11, XHR responseXML might be malformed if MO is enabled (where extra newlines get added in nodes with UTF-8 content).
			 * Another IE 11 MO bug can cause the process to crash when certain mutations occur.
			 * For the process crash issue, see https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/8137215/ and
			 * https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/15167323/
			 *
			 * @memberof BOOMR.utils
			 */
			isMutationObserverSupported: function() {
				// We can only detect IE 11 bugs by UA sniffing.
				var ie11 = (w && w.navigator && w.navigator.userAgent && w.navigator.userAgent.match(/Trident.*rv[ :]*11\./));
				return (!ie11 && w && w.MutationObserver && typeof w.MutationObserver === "function");
			},

			/**
			 * The callback function may return a falsy value to disconnect the
			 * observer after it returns, or a truthy value to keep watching for
			 * mutations. If the return value is numeric and greater than 0, then
			 * this will be the new timeout. If it is boolean instead, then the
			 * timeout will not fire any more so the caller MUST call disconnect()
			 * at some point.
			 *
			 * @callback BOOMR~addObserverCallback
			 * @param {object[]} mutations List of mutations detected by the observer or `undefined` if the observer timed out
			 * @param {object} callback_data Is the passed in `callback_data` parameter without modifications
			 */

			/**
			 * Add a MutationObserver for a given element and terminate after `timeout`ms.
			 *
			 * @param {DOMElement} el DOM element to watch for mutations
			 * @param {MutationObserverInit} config MutationObserverInit object (https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver#MutationObserverInit)
			 * @param {number} timeout Number of milliseconds of no mutations after which the observer should be automatically disconnected.
			 * If set to a falsy value, the observer will wait indefinitely for Mutations.
			 * @param {BOOMR~addObserverCallback} callback Callback function to call either on timeout or if mutations are detected.
			 * @param {object} callback_data Any data to be passed to the callback function as its second parameter.
			 * @param {object} callback_ctx An object that represents the `this` object of the `callback` method.
			 * Leave unset the callback function is not a method of an object.
			 *
			 * @returns {object|null}
			 * - `null` if a MutationObserver could not be created OR
			 * - An object containing the observer and the timer object:
			 *   `{ observer: <MutationObserver>, timer: <Timeout Timer if any> }`
			 * - The caller can use this to disconnect the observer at any point
			 *   by calling `retval.observer.disconnect()`
			 * - Note that the caller should first check to see if `retval.observer`
			 *   is set before calling `disconnect()` as it may have been cleared automatically.
			 *
			 * @memberof BOOMR.utils
			 */
			addObserver: function(el, config, timeout, callback, callback_data, callback_ctx) {
				var o = {observer: null, timer: null};

				if (!this.isMutationObserverSupported() || !callback || !el) {
					return null;
				}

				function done(mutations) {
					var run_again = false;

					if (o.timer) {
						clearTimeout(o.timer);
						o.timer = null;
					}

					if (callback) {
						run_again = callback.call(callback_ctx, mutations, callback_data);

						if (!run_again) {
							callback = null;
						}
					}

					if (!run_again && o.observer) {
						o.observer.disconnect();
						o.observer = null;
					}

					if (typeof run_again === "number" && run_again > 0) {
						o.timer = setTimeout(done, run_again);
					}
				}

				o.observer = new BOOMR.window.MutationObserver(done);

				if (timeout) {
					o.timer = setTimeout(done, o.timeout);
				}

				o.observer.observe(el, config);

				return o;
			},

			/**
			 * Adds an event listener.
			 *
			 * @param {DOMElement} el DOM element
			 * @param {string} type Event name
			 * @param {function} fn Callback function
			 * @param {boolean} passive Passive mode
			 *
			 * @memberof BOOMR.utils
			 */
			addListener: function(el, type, fn, passive) {
				var opts = false;
				if (el.addEventListener) {
					if (passive && BOOMR.browser.supportsPassive()) {
						opts = {
							capture: false,
							passive: true
						};
					}

					el.addEventListener(type, fn, opts);
				}
				else if (el.attachEvent) {
					el.attachEvent("on" + type, fn);
				}

				// ensure the type arry exists
				impl.listenerCallbacks[type] = impl.listenerCallbacks[type] || [];

				// save a reference to the target object and function
				impl.listenerCallbacks[type].push({ el: el, fn: fn});
			},

			/**
			 * Removes an event listener.
			 *
			 * @param {DOMElement} el DOM element
			 * @param {string} type Event name
			 * @param {function} fn Callback function
			 *
			 * @memberof BOOMR.utils
			 */
			removeListener: function(el, type, fn) {
				var i;

				if (el.removeEventListener) {
					// NOTE: We don't need to match any other options (e.g. passive)
					// from addEventListener, as removeEventListener only cares
					// about captive.
					el.removeEventListener(type, fn, false);
				}
				else if (el.detachEvent) {
					el.detachEvent("on" + type, fn);
				}

				if (impl.listenerCallbacks.hasOwnProperty(type)) {
					for (var i = 0; i < impl.listenerCallbacks[type].length; i++) {
						if (fn === impl.listenerCallbacks[type][i].fn &&
						    el === impl.listenerCallbacks[type][i].el) {
							impl.listenerCallbacks[type].splice(i, 1);
							return;
						}
					}
				}
			},

			/**
			 * Determines if the specified object is an `Array` or not
			 *
			 * @param {object} ary Object in question
			 *
			 * @returns {boolean} True if the object is an `Array`
			 *
			 * @memberof BOOMR.utils
			 */
			isArray: function(ary) {
				return Object.prototype.toString.call(ary) === "[object Array]";
			},

			/**
			 * Determines if the specified value is in the array
			 *
			 * @param {object} val Value to check
			 * @param {object} ary Object in question
			 *
			 * @returns {boolean} True if the value is in the Array
			 *
			 * @memberof BOOMR.utils
			 */
			inArray: function(val, ary) {
				var i;

				if (typeof val === "undefined" || typeof ary === "undefined" || !ary.length) {
					return false;
				}

				for (i = 0; i < ary.length; i++) {
					if (ary[i] === val) {
						return true;
					}
				}

				return false;
			},

			/**
			 * Get a query parameter value from a URL's query string
			 *
			 * @param {string} param Query parameter name
			 * @param {string|Object} [url] URL containing the query string, or a link object.
			 * Defaults to `BOOMR.window.location`
			 *
			 * @returns {string|null} URI decoded value or null if param isn't a query parameter
			 *
			 * @memberof BOOMR.utils
			 */
			getQueryParamValue: function(param, url) {
				var l, params, i, kv;
				if (!param) {
					return null;
				}

				if (typeof url === "string") {
					l = BOOMR.window.document.createElement("a");
					l.href = url;
				}
				else if (typeof url === "object" && typeof url.search === "string") {
					l = url;
				}
				else {
					l = BOOMR.window.location;
				}

				// Now that we match, pull out all query string parameters
				params = l.search.slice(1).split(/&/);

				for (i = 0; i < params.length; i++) {
					if (params[i]) {
						kv = params[i].split("=");
						if (kv.length && kv[0] === param) {
							return kv.length > 1 ? decodeURIComponent(kv.splice(1).join("=").replace(/\+/g, " ")) : "";
						}
					}
				}
				return null;
			},

			/**
			 * Generates a pseudo-random UUID (Version 4):
			 * https://en.wikipedia.org/wiki/Universally_unique_identifier
			 *
			 * @returns {string} UUID
			 *
			 * @memberof BOOMR.utils
			 */
			generateUUID: function() {
				return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
					var r = Math.random() * 16 | 0;
					var v = c === "x" ? r : (r & 0x3 | 0x8);
					return v.toString(16);
				});
			},

			/**
			 * Generates a random ID based on the specified number of characters.  Uses
			 * characters a-z0-9.
			 *
			 * @param {number} chars Number of characters (max 40)
			 *
			 * @returns {string} Random ID
			 *
			 * @memberof BOOMR.utils
			 */
			generateId: function(chars) {
				return "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".substr(0, chars || 40).replace(/x/g, function(c) {
					var c = (Math.random() || 0.01).toString(36);

					// some implementations may return "0" for small numbers
					if (c === "0") {
						return "0";
					}
					else {
						return c.substr(2, 1);
					}
				});
			},

			/**
			 * Attempt to serialize an object, preferring JSURL over JSON.stringify
			 *
			 * @param {Object} value Object to serialize
			 * @returns {string} serialized version of value, empty-string if not possible
			 */
			serializeForUrl: function(value) {
				if (BOOMR.utils.Compression && BOOMR.utils.Compression.jsUrl) {
					return BOOMR.utils.Compression.jsUrl(value);
				}
				if (window.JSON) {
					return JSON.stringify(value);
				}
				// not supported
				BOOMR.debug("JSON is not supported");
				return "";
			},

			/**
			 * Attempt to identify the URL of boomerang itself using multiple methods for cross-browser support
			 *
			 * This method uses document.currentScript (which cannot be called from an event handler), script.readyState (IE6-10),
			 * and the stack property of a caught Error object.
			 *
			 * @returns {string} The URL of the currently executing boomerang script.
			 */
			getMyURL: function() {
				var stack;
				// document.currentScript works in all browsers except for IE: https://caniuse.com/#feat=document-currentscript
				// #boomr-if-as works in all browsers if the page uses our standard iframe loader
				// #boomr-scr-as works in all browsers if the page uses our preloader loader
				// BOOMR_script will be undefined on IE for pages that do not use our standard loaders

				// Note that we do not use `w.document` or `d` here because we need the current execution context
				var BOOMR_script = (document.currentScript || document.getElementById("boomr-if-as") || document.getElementById("boomr-scr-as"));

				if (BOOMR_script) {
					return BOOMR_script.src;
				}

				// For IE 6-10 users on pages not using the standard loader, we iterate through all scripts backwards
				var scripts = document.getElementsByTagName("script"), i;

				// i-- is both a decrement as well as a condition, ie, the loop will terminate when i goes from 0 to -1
				for (i = scripts.length; i--;) {
					// We stop at the first script that has its readyState set to interactive indicating that it is currently executing
					if (scripts[i].readyState === "interactive") {
						return scripts[i].src;
					}
				}

				// For IE 11, we throw an Error and inspect its stack property in the catch block
				// This also works on IE10, but throwing is disruptive so we try to avoid it and use
				// the less disruptive script iterator above
				try {
					throw new Error();
				}
				catch (e) {
					if ("stack" in e) {
						stack = this.arrayFilter(e.stack.split(/\n/), function(l) { return l.match(/https?:\/\//); });
						if (stack && stack.length) {
							return stack[0].replace(/.*(https?:\/\/.+?)(:\d+)+\D*$/m, "$1");
						}
					}
					// FWIW, on IE 8 & 9, the Error object does not contain a stack property, but if you have an uncaught error,
					// and a `window.onerror` handler (not using addEventListener), then the second argument to that handler is
					// the URL of the script that threw. The handler needs to `return true;` to prevent the default error handler
					// This flow is asynchronous though (due to the event handler), so won't work in a function return scenario
					// like this (we can't use promises because we would only need this hack in browsers that don't support promises).
				}

				return "";
			},

			/*
			 * Gets the Scroll x and y (rounded) for a page
			 *
			 * @returns {object} Scroll x and y coordinates
			 */
			scroll: function() {
				// Adapted from:
				// https://developer.mozilla.org/en-US/docs/Web/API/Window/scrollY
				var supportPageOffset = w.pageXOffset !== undefined;
				var isCSS1Compat = ((w.document.compatMode || "") === "CSS1Compat");

				var ret = {
					x: 0,
					y: 0
				};

				if (supportPageOffset) {
					if (typeof w.pageXOffset === "function") {
						ret.x = w.pageXOffset();
						ret.y = w.pageYOffset();
					}
					else {
						ret.x = w.pageXOffset;
						ret.y = w.pageYOffset;
					}
				}
				else if (isCSS1Compat) {
					ret.x = w.document.documentElement.scrollLeft;
					ret.y = w.document.documentElement.scrollTop;
				}
				else {
					ret.x = w.document.body.scrollLeft;
					ret.y = w.document.body.scrollTop;
				}

				// round to full numbers
				if (typeof ret.sx === "number") {
					ret.sx = Math.round(ret.sx);
				}

				if (typeof ret.sy === "number") {
					ret.sy = Math.round(ret.sy);
				}

				return ret;
			},

			/**
			 * Gets the window height
			 *
			 * @returns {number} Window height
			 */
			windowHeight: function() {
				return w.innerHeight || w.document.documentElement.clientHeight || w.document.body.clientHeight;
			},

			/**
			 * Gets the window width
			 *
			 * @returns {number} Window width
			 */
			windowWidth: function() {
				return w.innerWidth || w.document.documentElement.clientWidth || w.document.body.clientWidth;
			},

			/**
			 * Determines if the function is native or not
			 *
			 * @param {function} fn Function
			 *
			 * @returns {boolean} True when the function is native
			 */
			isNative: function(fn) {
				return !!fn &&
				    fn.toString &&
				    !fn.hasOwnProperty("toString") &&
				    /\[native code\]/.test(String(fn));
			}

			/* BEGIN_DEBUG */
			, forEach: function(array, fn, thisArg) {
				if (!BOOMR.utils.isArray(array) || typeof fn !== "function") {
					return;
				}
				var length = array.length;
				for (var i = 0; i < length; i++) {
					if (array.hasOwnProperty(i)) {
						fn.call(thisArg, array[i], i, array);
					}
				}
			}
			/* END_DEBUG */

		}, // closes `utils`

		/**
		 * Browser feature detection flags.
		 *
		 * @class BOOMR.browser
		 */
		browser: {
			results: {},

			/**
			 * Whether or not the browser supports 'passive' mode for event
			 * listeners
			 *
			 * @returns {boolean} True if the browser supports passive mode
			 */
			supportsPassive: function() {
				if (typeof BOOMR.browser.results.supportsPassive === "undefined") {
					BOOMR.browser.results.supportsPassive = false;

					if (!Object.defineProperty) {
						return false;
					}

					try {
						var opts = Object.defineProperty({}, "passive", {
							get: function() {
								BOOMR.browser.results.supportsPassive = true;
							}
						});
						window.addEventListener("test", null, opts);
					}
					catch (e) {
						// NOP
					}
				}

				return BOOMR.browser.results.supportsPassive;
			}
		},

		/**
		 * Initializes Boomerang by applying the specified configuration.
		 *
		 * All plugins' `init()` functions will be called with the same config as well.
		 *
		 * @param {object} config Configuration object
		 * @param {boolean} [config.autorun] By default, boomerang runs automatically
		 * and attaches its `page_ready` handler to the `window.onload` event.
		 * If you set `autorun` to `false`, this will not happen and you will
		 * need to call {@link BOOMR.page_ready} yourself.
		 * @param {string} config.beacon_auth_key Beacon authorization key value
		 * @param {string} config.beacon_auth_token Beacon authorization token.
		 * @param {boolean} config.beacon_with_credentials Sends beacon with credentials
		 * @param {boolean} config.beacon_disable_sendbeacon Disables `navigator.sendBeacon()` support
		 * @param {string} config.beacon_url The URL to beacon results back to.
		 * If not set, no beacon will be sent.
		 * @param {boolean} config.beacon_url_force_https Forces protocol-relative Beacon URLs to HTTPS
		 * @param {string} config.beacon_type `GET`, `POST` or `AUTO`
		 * @param {string} [config.site_domain] The domain that all cookies should be set on
		 * Boomerang will try to auto-detect this, but unless your site is of the
		 * `foo.com` format, it will probably get it wrong. It's a good idea
		 * to set this to whatever part of your domain you'd like to share
		 * bandwidth and performance measurements across.
		 * Set this to a falsy value to disable all cookies.
		 * @param {boolean} [config.strip_query_string] Whether or not to strip query strings from all URLs (e.g. `u`, `pgu`, etc.)
		 * @param {string} [config.user_ip] Despite its name, this is really a free-form
		 * string used to uniquely identify the user's current internet
		 * connection. It's used primarily by the bandwidth test to determine
		 * whether it should re-measure the user's bandwidth or just use the
		 * value stored in the cookie. You may use IPv4, IPv6 or anything else
		 * that you think can be used to identify the user's network connection.
		 * @param {function} [config.log] Logger to use. Set to `null` to disable logging.
		 * @param {function} [<plugins>] Each plugin has its own section
		 *
		 * @returns {BOOMR} Boomerang object
		 *
		 * @memberof BOOMR
		 */
		init: function(config) {
			var i, k,
			    properties = [
				    "autorun",
				    "beacon_auth_key",
				    "beacon_auth_token",
				    "beacon_with_credentials",
				    "beacon_disable_sendbeacon",
				    "beacon_url",
				    "beacon_url_force_https",
				    "beacon_type",
				    "site_domain",
				    "strip_query_string",
				    "user_ip"
			    ];

			BOOMR_check_doc_domain();

			if (!config) {
				config = {};
			}

			// ensure logging is setup properly (or null'd out for production)
			if (config.log !== undefined) {
				this.log = config.log;
			}

			if (!this.log) {
				this.log = function(/* m,l,s */) {};
			}

			if (!this.pageId) {
				// generate a random page ID for this page's lifetime
				this.pageId = BOOMR.utils.generateId(8);
				BOOMR.debug("Generated PageID: " + this.pageId);
			}

			if (config.primary && impl.handlers_attached) {
				return this;
			}

			if (config.site_domain !== undefined) {
				this.session.domain = config.site_domain;
			}

			// Set autorun if in config right now, as plugins that listen for page_ready
			// event may fire when they .init() if onload has already fired, and whether
			// or not we should fire page_ready depends on config.autorun.
			if (typeof config.autorun !== "undefined") {
				impl.autorun = config.autorun;
			}

			for (k in this.plugins) {
				if (this.plugins.hasOwnProperty(k)) {
					// config[plugin].enabled has been set to false
					if (config[k] &&
					    config[k].hasOwnProperty("enabled") &&
					    config[k].enabled === false) {
						impl.disabled_plugins[k] = 1;

						if (typeof this.plugins[k].disable === "function") {
							this.plugins[k].disable();
						}

						continue;
					}

					// plugin was previously disabled
					if (impl.disabled_plugins[k]) {

						// and has not been explicitly re-enabled
						if (!config[k] ||
						    !config[k].hasOwnProperty("enabled") ||
						    config[k].enabled !== true) {
							continue;
						}

						if (typeof this.plugins[k].enable === "function") {
							this.plugins[k].enable();
						}

						// plugin is now enabled
						delete impl.disabled_plugins[k];
					}

					// plugin exists and has an init method
					if (typeof this.plugins[k].init === "function") {
						try {
							this.plugins[k].init(config);
						}
						catch (err) {
							BOOMR.addError(err, k + ".init");
						}
					}
				}
			}

			for (i = 0; i < properties.length; i++) {
				if (config[properties[i]] !== undefined) {
					impl[properties[i]] = config[properties[i]];
				}
			}

			// if it's the first call to init (handlers aren't attached) and we're not asked to wait OR
			// it's the second init call (handlers are attached) and we were previously waiting
			// then we set up the page ready autorun functionality
			if ((!impl.handlers_attached && !config.wait) || (impl.handlers_attached && impl.waiting_for_config)) {
				// The developer can override onload by setting autorun to false
				if (!impl.onloadfired && (impl.autorun === undefined || impl.autorun !== false)) {
					if (BOOMR.hasBrowserOnloadFired()) {
						BOOMR.loadedLate = true;
					}
					BOOMR.attach_page_ready(BOOMR.page_ready_autorun);
				}
				impl.waiting_for_config = false;
			}

			// only attach handlers once
			if (impl.handlers_attached) {
				return this;
			}

			if (config.wait) {
				impl.waiting_for_config = true;
			}

			BOOMR.attach_page_ready(function() {
				// if we're not using the loader snippet, save the onload time for
				// browsers that do not support NavigationTiming.
				// This will be later than onload if boomerang arrives late on the
				// page but it's the best we can do
				if (!BOOMR.t_onload) {
					BOOMR.t_onload = BOOMR.now();
				}
			});

			BOOMR.utils.addListener(w, "DOMContentLoaded", function() { impl.fireEvent("dom_loaded"); });

			BOOMR.fireEvent("config", config);
			BOOMR.subscribe("config", function(beaconConfig) {
				if (beaconConfig.beacon_url) {
					impl.beacon_url = beaconConfig.beacon_url;
				}
			});

			BOOMR.subscribe("spa_navigation", impl.spaNavigation, null, impl);

			(function() {
				var forms, iterator;
				if (visibilityChange !== undefined) {
					BOOMR.utils.addListener(d, visibilityChange, function() { impl.fireEvent("visibility_changed"); });

					// save the current visibility state
					impl.lastVisibilityState = BOOMR.visibilityState();

					BOOMR.subscribe("visibility_changed", function() {
						var visState = BOOMR.visibilityState();

						// record the last time each visibility state occurred
						BOOMR.lastVisibilityEvent[visState] = BOOMR.now();
						BOOMR.debug("Visibility changed from " + impl.lastVisibilityState + " to " + visState);

						// if we transitioned from prerender to hidden or visible, fire the prerender_to_visible event
						if (impl.lastVisibilityState === "prerender" &&
						    visState !== "prerender") {
							// note that we transitioned from prerender on the beacon for debugging
							BOOMR.addVar("vis.pre", "1");

							// let all listeners know
							impl.fireEvent("prerender_to_visible");
						}

						impl.lastVisibilityState = visState;
					});
				}

				BOOMR.utils.addListener(d, "mouseup", impl.xb_handler("click"));

				forms = d.getElementsByTagName("form");
				for (iterator = 0; iterator < forms.length; iterator++) {
					BOOMR.utils.addListener(forms[iterator], "submit", impl.xb_handler("form_submit"));
				}

				if (!w.onpagehide && w.onpagehide !== null) {
					// This must be the last one to fire
					// We only clear w on browsers that don't support onpagehide because
					// those that do are new enough to not have memory leak problems of
					// some older browsers
					BOOMR.utils.addListener(w, "unload", function() { BOOMR.window = w = null; });
				}
			}());

			impl.handlers_attached = true;
			return this;
		},

		/**
		 * Attach a callback to the `pageshow` or `onload` event if `onload` has not
		 * been fired otherwise queue it to run immediately
		 *
		 * @param {function} cb Callback to run when `onload` fires or page is visible (`pageshow`)
		 *
		 * @memberof BOOMR
		 */
		attach_page_ready: function(cb) {
			if (BOOMR.hasBrowserOnloadFired()) {
				this.setImmediate(cb, null, null, BOOMR);
			}
			else {
				// Use `pageshow` if available since it will fire even if page came from a back-forward page cache.
				// Browsers that support `pageshow` will not fire `onload` if navigation was through a back/forward button
				// and the page was retrieved from back-forward cache.
				if (w.onpagehide || w.onpagehide === null) {
					BOOMR.utils.addListener(w, "pageshow", cb);
				}
				else {
					BOOMR.utils.addListener(w, "load", cb);
				}
			}
		},

		/**
		 * Sends the `page_ready` event only if `autorun` is still true after
		 * {@link BOOMR.init} is called.
		 *
		 * @param {Event} ev Event
		 *
		 * @memberof BOOMR
		 */
		page_ready_autorun: function(ev) {
			if (impl.autorun) {
				BOOMR.page_ready(ev, true);
			}
		},

		/**
		 * Method that fires the {@link BOOMR#event:page_ready} event. Call this
		 * only if you've set `autorun` to `false` when calling the {@link BOOMR.init}
		 * method. You should call this method when you determine that your page
		 * is ready to be used by your user. This will be the end-time used in
		 * the page load time measurement. Optionally, you can pass a Unix Epoch
		 * timestamp as a parameter or set the global `BOOMR_page_ready` var that will
		 * be used as the end-time instead.
		 *
		 * @param {Event|number} [ev] Ready event or optional load event end timestamp if called manually
		 * @param {boolean} auto True if called by `page_ready_autorun`
		 *
		 * @returns {BOOMR} Boomerang object
		 *
		 * @example
		 * BOOMR.init({ autorun: false, ... });
		 * // wait until the page is ready, i.e. your view has loaded
		 * BOOMR.page_ready();
		 *
		 * @memberof BOOMR
		 */
		page_ready: function(ev, auto) {
			var tm_page_ready;

			// a number can be passed as the first argument if called manually which
			// will be used as the loadEventEnd time
			if (!auto && typeof ev === "number") {
				tm_page_ready = ev;
				ev = null;
			}

			if (!ev) {
				ev = w.event;
			}

			if (!ev) {
				ev = {
					name: "load"
				};
			}

			// if we were called manually or global BOOMR_page_ready was set then
			// add loadEventEnd and note this was 'pr' on the beacon
			if (!auto) {
				ev.timing = ev.timing || {};
				// use timestamp parameter or global BOOMR_page_ready if set, otherwise use
				// the current timestamp
				if (tm_page_ready) {
					ev.timing.loadEventEnd = tm_page_ready;
				}
				else if (typeof w.BOOMR_page_ready === "number") {
					ev.timing.loadEventEnd = w.BOOMR_page_ready;
				}
				else {
					ev.timing.loadEventEnd = BOOMR.now();
				}

				BOOMR.addVar("pr", 1, true);
			}
			else if (typeof w.BOOMR_page_ready === "number") {
				ev.timing = ev.timing || {};
				// the global BOOMR_page_ready will override our loadEventEnd
				ev.timing.loadEventEnd = w.BOOMR_page_ready;

				BOOMR.addVar("pr", 1, true);
			}

			if (impl.onloadfired) {
				return this;
			}

			impl.fireEvent("page_ready", ev);
			impl.onloadfired = true;
			return this;
		},

		/**
		 * Determines whether or not the page's `onload` event has fired
		 *
		 * @returns {boolean} True if page's onload was called
		 */
		hasBrowserOnloadFired: function() {
			var p = BOOMR.getPerformance();
			// if the document is `complete` then the `onload` event has already occurred, we'll fire the callback immediately.
			// When `document.write` is used to replace the contents of the page and inject boomerang, the document `readyState`
			// will go from `complete` back to `loading` and then to `complete` again. The second transition to `complete`
			// doesn't fire a second `pageshow` event in some browsers (e.g. Safari). We need to check if
			// `performance.timing.loadEventStart` or `BOOMR_onload` has occurred to detect this scenario. Will not work for
			// older Safari that doesn't have NavTiming
			return ((d.readyState && d.readyState === "complete") ||
			    (p && p.timing && p.timing.loadEventStart > 0) ||
			    w.BOOMR_onload > 0);
		},

		/**
		 * Determines whether or not the page's `onload` event has fired, or
		 * if `autorun` is false, whether {@link BOOMR.page_ready} was called.
		 *
		 * @returns {boolean} True if `onload` or {@link BOOMR.page_ready} were called
		 *
		 * @memberof BOOMR
		 */
		onloadFired: function() {
			return impl.onloadfired;
		},

		/**
		 * The callback function may return a falsy value to disconnect the observer
		 * after it returns, or a truthy value to keep watching for mutations. If
		 * the return value is numeric and greater than 0, then this will be the new timeout.
		 * If it is boolean instead, then the timeout will not fire any more so
		 * the caller MUST call disconnect() at some point
		 *
		 * @callback BOOMR~setImmediateCallback
		 * @param {object} data The passed in `data` object
		 * @param {object} cb_data The passed in `cb_data` object
		 * @param {Error} callstack An Error object that holds the callstack for
		 * when `setImmediate` was called, used to determine what called the callback
		 */

		/**
		 * Defer the function `fn` until the next instant the browser is free from
		 * user tasks.
		 *
		 * @param {BOOMR~setImmediateCallback} fn The callback function.
		 * @param {object} [data] Any data to pass to the callback function
		 * @param {object} [cb_data] Any passthrough data for the callback function.
		 * This differs from `data` when `setImmediate` is called via an event
		 * handler and `data` is the Event object
		 * @param {object} [cb_scope] The scope of the callback function if it is a method of an object
		 *
		 * @returns nothing
		 *
		 * @memberof BOOMR
		 */
		setImmediate: function(fn, data, cb_data, cb_scope) {
			var cb, cstack;

			/* BEGIN_DEBUG */
			// DEBUG: This is to help debugging, we'll see where setImmediate calls were made from
			if (typeof Error !== "undefined") {
				cstack = new Error();
				cstack = cstack.stack ? cstack.stack.replace(/^Error/, "Called") : undefined;
			}
			/* END_DEBUG */

			cb = function() {
				fn.call(cb_scope || null, data, cb_data || {}, cstack);
				cb = null;
			};

			if (w.requestIdleCallback) {
				// set a timeout since rIC doesn't get called reliably in chrome headless
				w.requestIdleCallback(cb, {timeout: 1000});
			}
			else if (w.setImmediate) {
				w.setImmediate(cb);
			}
			else {
				setTimeout(cb, 10);
			}
		},

		/**
		 * Gets the current time in milliseconds since the Unix Epoch (Jan 1 1970).
		 *
		 * In browsers that support `DOMHighResTimeStamp`, this will be replaced
		 * by a function that adds `performance.now()` to `navigationStart`
		 * (with milliseconds.microseconds resolution).
		 *
		 * @function
		 *
		 * @returns {TimeStamp} Milliseconds since Unix Epoch
		 *
		 * @memberof BOOMR
		 */
		now: (function() {
			return Date.now || function() { return new Date().getTime(); };
		}()),

		/**
		 * Gets the `window.performance` object of the root window.
		 *
		 * Checks vendor prefixes for older browsers (e.g. IE9).
		 *
		 * @returns {Performance|undefined} `window.performance` if it exists
		 *
		 * @memberof BOOMR
		 */
		getPerformance: function() {
			try {
				if (BOOMR.window) {
					if ("performance" in BOOMR.window && BOOMR.window.performance) {
						return BOOMR.window.performance;
					}

					// vendor-prefixed fallbacks
					return BOOMR.window.msPerformance ||
					    BOOMR.window.webkitPerformance ||
					    BOOMR.window.mozPerformance;
				}
			}
			catch (ignore) {
				// empty
			}
		},

		/**
		 * Get high resolution delta timestamp from time origin
		 *
		 * This function needs to approximate the time since the performance timeOrigin
		 * or Navigation Timing API's `navigationStart` time.
		 * If available, `performance.now()` can provide this value.
		 * If not we either get the navigation start time from the RT plugin or
		 * from `t_lstart` or `t_start`. Those values are subtracted from the current
		 * time to derive a time since `navigationStart` value.
		 *
		 * @returns {float} Exact or approximate time since the time origin.
		 */
		hrNow: function() {
			var now, navigationStart, p = BOOMR.getPerformance();

			if (p && p.now) {
				now = p.now();
			}
			else {
				navigationStart = (BOOMR.plugins.RT && BOOMR.plugins.RT.navigationStart &&
					BOOMR.plugins.RT.navigationStart()) || BOOMR.t_lstart || BOOMR.t_start;

				// if navigationStart is undefined, we'll be returning NaN
				now = BOOMR.now() - navigationStart;
			}

			return now;
		},

		/**
		 * Gets the `document.visibilityState`, or `visible` if Page Visibility
		 * is not supported.
		 *
		 * @function
		 *
		 * @returns {string} Visibility state
		 *
		 * @memberof BOOMR
		 */
		visibilityState: (visibilityState === undefined ? function() {
			return "visible";
		} : function() {
			return d[visibilityState];
		}),

		/**
		 * An mapping of visibliity event states to the latest time they happened
		 *
		 * @type {object}
		 *
		 * @memberof BOOMR
		 */
		lastVisibilityEvent: {},

		/**
		 * Registers a Boomerang event.
		 *
		 * @param {string} e_name Event name
		 *
		 * @returns {BOOMR} Boomerang object
		 *
		 * @memberof BOOMR
		 */
		registerEvent: function(e_name) {
			if (impl.events.hasOwnProperty(e_name)) {
				// already registered
				return this;
			}

			// create a new queue of handlers
			impl.events[e_name] = [];

			return this;
		},

		/**
		 * Disables boomerang from doing anything further:
		 * 1. Clears event handlers (such as onload)
		 * 2. Clears all event listeners
		 *
		 * @memberof BOOMR
		 */
		disable: function() {
			impl.clearEvents();
			impl.clearListeners();
		},

		/**
		 * Fires a Boomerang event
		 *
		 * @param {string} e_name Event name
		 * @param {object} data Event payload
		 *
		 * @returns {BOOMR} Boomerang object
		 *
		 * @memberof BOOMR
		 */
		fireEvent: function(e_name, data) {
			return impl.fireEvent(e_name, data);
		},

		/**
		 * @callback BOOMR~subscribeCallback
		 * @param {object} eventData Event data
		 * @param {object} cb_data Callback data
		 */

		/**
		 * Subscribes to a Boomerang event
		 *
		 * @param {string} e_name Event name, i.e. {@link BOOMR#event:page_ready}.
		 * @param {BOOMR~subscribeCallback} fn Callback function
		 * @param {object} cb_data Callback data, passed as the second parameter to the callback function
		 * @param {object} cb_scope Callback scope.  If set to an object, then the
		 * callback function is called as a method of this object, and all
		 * references to `this` within the callback function will refer to `cb_scope`.
		 * @param {boolean} once Whether or not this callback should only be run once
		 *
		 * @returns {BOOMR} Boomerang object
		 *
		 * @memberof BOOMR
		 */
		subscribe: function(e_name, fn, cb_data, cb_scope, once) {
			var i, handler, ev;

			e_name = e_name.toLowerCase();

			// translate old names
			if (impl.translate_events[e_name]) {
				e_name = impl.translate_events[e_name];
			}

			if (!impl.events.hasOwnProperty(e_name)) {
				// allow subscriptions before they're registered
				impl.events[e_name] = [];
			}

			ev = impl.events[e_name];

			// don't allow a handler to be attached more than once to the same event
			for (i = 0; i < ev.length; i++) {
				handler = ev[i];
				if (handler && handler.fn === fn && handler.cb_data === cb_data && handler.scope === cb_scope) {
					return this;
				}
			}

			ev.push({
				fn: fn,
				cb_data: cb_data || {},
				scope: cb_scope || null,
				once: once || false
			});

			// attaching to page_ready after onload fires, so call soon
			if (e_name === "page_ready" && impl.onloadfired && impl.autorun) {
				this.setImmediate(fn, null, cb_data, cb_scope);
			}

			// Attach unload handlers directly to the window.onunload and
			// window.onbeforeunload events. The first of the two to fire will clear
			// fn so that the second doesn't fire. We do this because technically
			// onbeforeunload is the right event to fire, but not all browsers
			// support it.  This allows us to fall back to onunload when onbeforeunload
			// isn't implemented
			if (e_name === "page_unload" || e_name === "before_unload") {
				(function() {
					var unload_handler, evt_idx = ev.length;

					unload_handler = function(evt) {
						if (fn) {
							fn.call(cb_scope, evt || w.event, cb_data);
						}

						// If this was the last unload handler, we'll try to send the beacon immediately after it is done
						// The beacon will only be sent if one of the handlers has queued it
						if (e_name === "page_unload" && evt_idx === impl.events[e_name].length) {
							BOOMR.real_sendBeacon();
						}
					};

					if (e_name === "page_unload") {
						// pagehide is for iOS devices
						// see http://www.webkit.org/blog/516/webkit-page-cache-ii-the-unload-event/
						if (w.onpagehide || w.onpagehide === null) {
							BOOMR.utils.addListener(w, "pagehide", unload_handler);
						}
						else {
							BOOMR.utils.addListener(w, "unload", unload_handler);
						}
					}
					BOOMR.utils.addListener(w, "beforeunload", unload_handler);
				}());
			}

			return this;
		},

		/**
		 * Logs an internal Boomerang error.
		 *
		 * If the {@link BOOMR.plugins.Errors} plugin is enabled, this data will
		 * be compressed on the `err` beacon parameter.  If not, it will be included
		 * in uncompressed form on the `errors` parameter.
		 *
		 * @param {string|object} err Error
		 * @param {string} [src] Source
		 * @param {object} [extra] Extra data
		 *
		 * @memberof BOOMR
		 */
		addError: function BOOMR_addError(err, src, extra) {
			var str, E = BOOMR.plugins.Errors;

			BOOMR.error("Boomerang caught error: " + err + ", src: " + src + ", extra: " + extra);

			//
			// Use the Errors plugin if it's enabled
			//
			if (E && E.is_supported()) {
				if (typeof err === "string") {
					E.send({
						message: err,
						extra: extra,
						functionName: src,
						noStack: true
					}, E.VIA_APP, E.SOURCE_BOOMERANG);
				}
				else {
					if (typeof src === "string") {
						err.functionName = src;
					}

					if (typeof extra !== "undefined") {
						err.extra = extra;
					}

					E.send(err, E.VIA_APP, E.SOURCE_BOOMERANG);
				}

				return;
			}

			if (typeof err !== "string") {
				str = String(err);
				if (str.match(/^\[object/)) {
					str = err.name + ": " + (err.description || err.message).replace(/\r\n$/, "");
				}
				err = str;
			}
			if (src !== undefined) {
				err = "[" + src + ":" + BOOMR.now() + "] " + err;
			}
			if (extra) {
				err += ":: " + extra;
			}

			if (impl.errors[err]) {
				impl.errors[err]++;
			}
			else {
				impl.errors[err] = 1;
			}
		},

		/**
		 * Determines if the specified Error is a Cross-Origin error.
		 *
		 * @param {string|object} err Error
		 *
		 * @returns {boolean} True if the Error is a Cross-Origin error.
		 *
		 * @memberof BOOMR
		 */
		isCrossOriginError: function(err) {
			// These are expected for cross-origin iframe access.
			// For IE and Edge, we'll also check the error number for non-English browsers
			return err.name === "SecurityError" ||
				(err.name === "TypeError" && err.message === "Permission denied") ||
				(err.name === "Error" && err.message && err.message.match(/^(Permission|Access is) denied/)) ||
				err.number === -2146828218;  // IE/Edge error number for "Permission Denied"
		},

		/**
		 * Add one or more parameters to the beacon.
		 *
		 * This method may either be called with a single object containing
		 * key/value pairs, or with two parameters, the first is the variable
		 * name and the second is its value.
		 *
		 * All names should be strings usable in a URL's query string.
		 *
		 * We recommend only using alphanumeric characters and underscores, but you
		 * can use anything you like.
		 *
		 * Values should be strings (or numbers), and have the same restrictions
		 * as names.
		 *
		 * Parameters will be on all subsequent beacons unless `singleBeacon` is
		 * set.
		 *
		 * @param {string} name Variable name
		 * @param {string|object} val Value
		 * @param {boolean} singleBeacon Whether or not to add to a single beacon
		 * or all beacons
		 *
		 * @returns {BOOMR} Boomerang object
		 *
		 * @example
		 * BOOMR.addVar("page_id", 123);
		 * BOOMR.addVar({"page_id": 123, "user_id": "Person1"});
		 *
		 * @memberof BOOMR
		 */
		 addVar: function(name, value, singleBeacon) {
			if (typeof name === "string") {
				impl.vars[name] = value;
			}
			else if (typeof name === "object") {
				var o = name, k;
				for (k in o) {
					if (o.hasOwnProperty(k)) {
						impl.vars[k] = o[k];
					}
				}
			}

			if (singleBeacon) {
				impl.singleBeaconVars[name] = 1;
			}

			return this;
		},

		/**
		 * Appends data to a beacon.
		 *
		 * If the value already exists, a comma is added and the new data is applied.
		 *
		 * @param {string} name Variable name
		 * @param {string} val Value
		 *
		 * @returns {BOOMR} Boomerang object
		 *
		 * @memberof BOOMR
		 */
		appendVar: function(name, value) {
			var existing = BOOMR.getVar(name) || "";
			if (existing) {
				existing += ",";
			}

			BOOMR.addVar(name, existing + value);

			return this;
		},

		/**
		 * Removes one or more variables from the beacon URL. This is useful within
		 * a plugin to reset the values of parameters that it is about to set.
		 *
		 * Plugins can also use this in the {@link BOOMR#event:beacon} event to clear
		 * any variables that should only live on a single beacon.
		 *
		 * This method accepts either a list of variable names, or a single
		 * array containing a list of variable names.
		 *
		 * @param {string[]|string} name Variable name or list
		 *
		 * @returns {BOOMR} Boomerang object
		 *
		 * @memberof BOOMR
		 */
		removeVar: function(arg0) {
			var i, params;
			if (!arguments.length) {
				return this;
			}

			if (arguments.length === 1 && BOOMR.utils.isArray(arg0)) {
				params = arg0;
			}
			else {
				params = arguments;
			}

			for (i = 0; i < params.length; i++) {
				if (impl.vars.hasOwnProperty(params[i])) {
					delete impl.vars[params[i]];
				}
			}

			return this;
		},

		/**
		 * Determines whether or not the beacon has the specified variable.
		 *
		 * @param {string} name Variable name
		 *
		 * @returns {boolean} True if the variable is set.
		 *
		 * @memberof BOOMR
		 */
		hasVar: function(name) {
			return impl.vars.hasOwnProperty(name);
		},

		/**
		 * Gets the specified variable.
		 *
		 * @param {string} name Variable name
		 *
		 * @returns {object|undefined} Variable, or undefined if it isn't set
		 *
		 * @memberof BOOMR
		 */
		getVar: function(name) {
			return impl.vars[name];
		},

		/**
		 * Sets a variable's priority in the beacon URL.
		 * -1 = beginning of the URL
		 * 0  = middle of the URL (default)
		 * 1  = end of the URL
		 *
		 * @param {string} name Variable name
		 * @param {number} pri Priority (-1 or 1)
		 *
		 * @returns {BOOMR} Boomerang object
		 *
		 * @memberof BOOMR
		 */
		setVarPriority: function(name, pri) {
			if (typeof pri !== "number" || Math.abs(pri) !== 1) {
				return this;
			}

			impl.varPriority[pri][name] = 1;

			return this;
		},

		/**
		 * Sets the Referrers variable.
		 *
		 * @param {string} r Referrer from the document.referrer
		 *
		 * @memberof BOOMR
		 */
		setReferrer: function(r) {
			// document.referrer
			impl.r = r;
		},

		/**
		 * Starts a timer for a dynamic request.
		 *
		 * Once the named request has completed, call `loaded()` to send a beacon
		 * with the duration.
		 *
		 * @example
		 * var timer = BOOMR.requestStart("my-timer");
		 * // do stuff
		 * timer.loaded();
		 *
		 * @param {string} name Timer name
		 *
		 * @returns {object} An object with a `.loaded()` function that you can call
		 *     when the dynamic timer is complete.
		 *
		 * @memberof BOOMR
		 */
		requestStart: function(name) {
			var t_start = BOOMR.now();
			BOOMR.plugins.RT.startTimer("xhr_" + name, t_start);

			return {
				loaded: function(data) {
					BOOMR.responseEnd(name, t_start, data);
				}
			};
		},

		/**
		 * Determines if Boomerang can send a beacon.
		 *
		 * Queryies all plugins to see if they implement `readyToSend()`,
		 * and if so, that they return `true`.
		 *
		 * If not, the beacon cannot be sent.
		 *
		 * @returns {boolean} True if Boomerang can send a beacon
		 *
		 * @memberof BOOMR
		 */
		readyToSend: function() {
			var plugin;

			for (plugin in this.plugins) {
				if (this.plugins.hasOwnProperty(plugin)) {
					if (impl.disabled_plugins[plugin]) {
						continue;
					}

					if (typeof this.plugins[plugin].readyToSend === "function" &&
					    this.plugins[plugin].readyToSend() === false) {
						BOOMR.debug("Plugin " + plugin + " is not ready to send");
						return false;
					}
				}
			}

			return true;
		},

		/**
		 * Sends a beacon for a dynamic request.
		 *
		 * @param {string|object} name Timer name or timer object data.
		 * @param {string} [name.initiator] Initiator, such as `xhr` or `spa`
		 * @param {string} [name.url] URL of the request
		 * @param {TimeStamp} t_start Start time
		 * @param {object} data Request data
		 * @param {TimeStamp} t_end End time
		 *
		 * @memberof BOOMR
		 */
		responseEnd: function(name, t_start, data, t_end) {
			// take the now timestamp for start and end, if unspecified, in case we delay this beacon
			t_start = typeof t_start === "number" ? t_start : BOOMR.now();
			t_end = typeof t_end === "number" ? t_end : BOOMR.now();

			// wait until all plugins are ready to send
			if (!BOOMR.readyToSend()) {
				BOOMR.debug("Attempted to call responseEnd before all plugins were Ready to Send, trying again...");

				// try again later
				setTimeout(function() {
					BOOMR.responseEnd(name, t_start, data, t_end);
				}, 1000);

				return;
			}

			// Wait until we've sent the Page Load beacon first
			if (!BOOMR.hasSentPageLoadBeacon() &&
			    !BOOMR.utils.inArray(name.initiator, BOOMR.constants.BEACON_TYPE_SPAS)) {
				// wait for a beacon, then try again
				BOOMR.subscribe("page_load_beacon", function() {
					BOOMR.responseEnd(name, t_start, data, t_end);
				}, null, BOOMR, true);

				return;
			}

			if (typeof name === "object") {
				if (!name.url) {
					BOOMR.debug("BOOMR.responseEnd: First argument must have a url property if it's an object");
					return;
				}

				impl.fireEvent("xhr_load", name);
			}
			else {
				// flush out any queue'd beacons before we set the Page Group
				// and timers
				BOOMR.real_sendBeacon();

				BOOMR.addVar("xhr.pg", name);
				BOOMR.plugins.RT.startTimer("xhr_" + name, t_start);
				impl.fireEvent("xhr_load", {
					name: "xhr_" + name,
					data: data,
					timing: {
						loadEventEnd: t_end
					}
				});
			}
		},

		//
		// uninstrumentXHR, instrumentXHR, uninstrumentFetch and instrumentFetch
		// are stubs that will be replaced by auto-xhr.js if active.
		//
		/**
		 * Undo XMLHttpRequest instrumentation and reset the original `XMLHttpRequest`
		 * object
		 *
		 * This is implemented in `plugins/auto-xhr.js` {@link BOOMR.plugins.AutoXHR}.
		 *
		 * @memberof BOOMR
		 */
		uninstrumentXHR: function() { },

		/**
		 * Instrument all requests made via XMLHttpRequest to send beacons.
		 *
		 * This is implemented in `plugins/auto-xhr.js` {@link BOOMR.plugins.AutoXHR}.
		 *
		 * @memberof BOOMR
		 */
		instrumentXHR: function() { },

		/**
		 * Undo fetch instrumentation and reset the original `fetch`
		 * function
		 *
		 * This is implemented in `plugins/auto-xhr.js` {@link BOOMR.plugins.AutoXHR}.
		 *
		 * @memberof BOOMR
		 */
		uninstrumentFetch: function() { },

		/**
		 * Instrument all requests made via fetch to send beacons.
		 *
		 * This is implemented in `plugins/auto-xhr.js` {@link BOOMR.plugins.AutoXHR}.
		 *
		 * @memberof BOOMR
		 */
		instrumentFetch: function() { },

		/**
		 * Request boomerang to send its beacon with all queued beacon data
		 * (via {@link BOOMR.addVar}).
		 *
		 * Boomerang may ignore this request.
		 *
		 * When this method is called, boomerang checks all plugins. If any
		 * plugin has not completed its checks (ie, the plugin's `is_complete()`
		 * method returns `false`, then this method does nothing.
		 *
		 * If all plugins have completed, then this method fires the
		 * {@link BOOMR#event:before_beacon} event with all variables that will be
		 * sent on the beacon.
		 *
		 * After all {@link BOOMR#event:before_beacon} handlers return, this method
		 * checks if a `beacon_url` has been configured and if there are any
		 * beacon parameters to be sent. If both are true, it fires the beacon.
		 *
		 * The {@link BOOMR#event:beacon} event is then fired.
		 *
		 * `sendBeacon()` should be called any time a plugin goes from
		 * `is_complete() = false` to `is_complete = true` so the beacon is
		 * sent.
		 *
		 * The actual beaconing is handled in {@link BOOMR.real_sendBeacon} after
		 * a short delay (via {@link BOOMR.setImmediate}).  If other calls to
		 * `sendBeacon` happen before {@link BOOMR.real_sendBeacon} is called,
		 * those calls will be discarded (so it's OK to call this in quick
		 * succession).
		 *
		 * @param {string} [beacon_url_override] Beacon URL override
		 *
		 * @memberof BOOMR
		 */
		sendBeacon: function(beacon_url_override) {
			// This plugin wants the beacon to go somewhere else,
			// so update the location
			if (beacon_url_override) {
				impl.beacon_url_override = beacon_url_override;
			}

			if (!impl.beaconQueued) {
				impl.beaconQueued = true;
				BOOMR.setImmediate(BOOMR.real_sendBeacon, null, null, BOOMR);
			}

			return true;
		},

		/**
		 * Sends all beacon data.
		 *
		 * This function should be called directly any time a "new" beacon is about
		 * to be constructed.  For example, if you're creating a new XHR or other
		 * custom beacon, you should ensure the existing beacon data is flushed
		 * by calling `BOOMR.real_sendBeacon();` first.
		 *
		 * @memberof BOOMR
		 */
		real_sendBeacon: function() {
			var k, form, url, errors = [], params = [], paramsJoined, varsSent = {}, _if;

			if (!impl.beaconQueued) {
				return false;
			}

			impl.beaconQueued = false;

			BOOMR.debug("Checking if we can send beacon");

			// At this point someone is ready to send the beacon.  We send
			// the beacon only if all plugins have finished doing what they
			// wanted to do
			for (k in this.plugins) {
				if (this.plugins.hasOwnProperty(k)) {
					if (impl.disabled_plugins[k]) {
						continue;
					}
					if (!this.plugins[k].is_complete(impl.vars)) {
						BOOMR.debug("Plugin " + k + " is not complete, deferring beacon send");
						return false;
					}
				}
			}

			// Sanity test that the browser is still available (and not shutting down)
			if (!window || !window.Image || !window.navigator || !BOOMR.window) {
				BOOMR.debug("DOM not fully available, not sending a beacon");
				return false;
			}

			// For SPA apps, don't strip hashtags as some SPA frameworks use #s for tracking routes
			// instead of History pushState() APIs. Use d.URL instead of location.href because of a
			// Safari bug.
			var isSPA = BOOMR.utils.inArray(impl.vars["http.initiator"], BOOMR.constants.BEACON_TYPE_SPAS);
			var isPageLoad = typeof impl.vars["http.initiator"] === "undefined" || isSPA;

			if (!impl.vars.pgu) {
				impl.vars.pgu = isSPA ? d.URL : d.URL.replace(/#.*/, "");
			}
			impl.vars.pgu = BOOMR.utils.cleanupURL(impl.vars.pgu);

			// Use the current document.URL if it hasn't already been set, or for SPA apps,
			// on each new beacon (since each SPA soft navigation might change the URL)
			if (!impl.vars.u || isSPA) {
				impl.vars.u = impl.vars.pgu;
			}

			if (impl.vars.pgu === impl.vars.u) {
				delete impl.vars.pgu;
			}

			// Add cleaned-up referrer URLs to the beacon, if available
			if (impl.r) {
				impl.vars.r = BOOMR.utils.cleanupURL(impl.r);
			}
			else {
				delete impl.vars.r;
			}

			impl.vars.v = BOOMR.version;

			if (BOOMR.session.enabled) {
				impl.vars["rt.si"] = BOOMR.session.ID + "-" + Math.round(BOOMR.session.start / 1000).toString(36);
				impl.vars["rt.ss"] = BOOMR.session.start;
				impl.vars["rt.sl"] = BOOMR.session.length;
			}

			if (BOOMR.visibilityState()) {
				impl.vars["vis.st"] = BOOMR.visibilityState();
				if (BOOMR.lastVisibilityEvent.visible) {
					impl.vars["vis.lv"] = BOOMR.now() - BOOMR.lastVisibilityEvent.visible;
				}
				if (BOOMR.lastVisibilityEvent.hidden) {
					impl.vars["vis.lh"] = BOOMR.now() - BOOMR.lastVisibilityEvent.hidden;
				}
			}

			impl.vars["ua.plt"] = navigator.platform;
			impl.vars["ua.vnd"] = navigator.vendor;

			if (this.pageId) {
				impl.vars.pid = this.pageId;
			}

			// add beacon number
			impl.vars.n = ++this.beaconsSent;

			if (w !== window) {
				_if = "if";  // work around uglifyJS minification that breaks in IE8 and quirks mode
				impl.vars[_if] = "";
			}

			for (k in impl.errors) {
				if (impl.errors.hasOwnProperty(k)) {
					errors.push(k + (impl.errors[k] > 1 ? " (*" + impl.errors[k] + ")" : ""));
				}
			}

			if (errors.length > 0) {
				impl.vars.errors = errors.join("\n");
			}

			impl.errors = {};

			// If we reach here, all plugins have completed
			impl.fireEvent("before_beacon", impl.vars);

			// clone the vars object for two reasons: first, so all listeners of
			// 'beacon' get an exact clone (in case listeners are doing
			// BOOMR.removeVar), and second, to help build our priority list of vars.
			for (k in impl.vars) {
				if (impl.vars.hasOwnProperty(k)) {
					varsSent[k] = impl.vars[k];
				}
			}

			BOOMR.removeVar(["qt", "pgu"]);

			// remove any vars that should only be on a single beacon
			for (var singleVarName in impl.singleBeaconVars) {
				if (impl.singleBeaconVars.hasOwnProperty(singleVarName)) {
					BOOMR.removeVar(singleVarName);
				}
			}

			// clear single beacon vars list
			impl.singleBeaconVars = {};

			// keep track of page load beacons
			if (!impl.hasSentPageLoadBeacon && isPageLoad) {
				impl.hasSentPageLoadBeacon = true;

				// let this beacon go out first
				BOOMR.setImmediate(function() {
					impl.fireEvent("page_load_beacon", varsSent);
				});
			}

			// Stop at this point if we are rate limited
			if (BOOMR.session.rate_limited) {
				BOOMR.debug("Skipping because we're rate limited");
				return false;
			}

			// send the beacon data
			BOOMR.sendBeaconData(varsSent);

			return true;
		},

		/**
		 * Determines whether or not a Page Load beacon has been sent.
		 *
		 * @returns {boolean} True if a Page Load beacon has been sent.
		 */
		hasSentPageLoadBeacon: function() {
			return impl.hasSentPageLoadBeacon;
		},

		/**
		 * Sends beacon data via the Beacon API, XHR or Image
		 *
		 * @param {object} data Data
		 */
		sendBeaconData: function(data) {
			var urlFirst = [], urlLast = [], params, paramsJoined,
			    url, img, useImg = true, xhr, ret;

			BOOMR.debug("Ready to send beacon: " + BOOMR.utils.objectToString(data));

			// Use the override URL if given
			impl.beacon_url = impl.beacon_url_override || impl.beacon_url;

			// Check that the beacon_url was set first
			if (!impl.beacon_url) {
				BOOMR.debug("No beacon URL, so skipping.");
				return false;
			}

			if (!impl.beaconUrlAllowed(impl.beacon_url)) {
				BOOMR.debug("Beacon URL not allowed: " + impl.beacon_url);
				return false;
			}

			// Check that we have data to send
			if (data.length === 0) {
				return false;
			}

			// If we reach here, we've figured out all of the beacon data we'll send.
			impl.fireEvent("beacon", data);

			// get high- and low-priority variables first, which remove any of
			// those vars from data
			urlFirst = this.getVarsOfPriority(data, -1);
			urlLast  = this.getVarsOfPriority(data, 1);

			// merge the 3 lists
			params = urlFirst.concat(this.getVarsOfPriority(data, 0), urlLast);
			paramsJoined = params.join("&");

			// If beacon_url is protocol relative, make it https only
			if (impl.beacon_url_force_https && impl.beacon_url.match(/^\/\//)) {
				impl.beacon_url = "https:" + impl.beacon_url;
			}

			// if there are already url parameters in the beacon url,
			// change the first parameter prefix for the boomerang url parameters to &
			url = impl.beacon_url + ((impl.beacon_url.indexOf("?") > -1) ? "&" : "?") + paramsJoined;

			// check the http.initiator is null , if null ,think this beacon is page beacon
			if (paramsJoined.indexOf('http.initiator') == -1) {
				paramsJoined = paramsJoined + '&http.initiator=page';
			}

			//
			// Try to send an IMG beacon if possible (which is the most compatible),
			// otherwise send an XHR beacon if the  URL length is longer than 2,000 bytes.
			//
			if (impl.beacon_type === "GET") {
				useImg = true;

				if (url.length > BOOMR.constants.MAX_GET_LENGTH) {
					((window.console && (console.warn || console.log)) || function() {})("Boomerang: Warning: Beacon may not be sent via GET due to payload size > 2000 bytes");
				}
			}
			else if (impl.beacon_type === "POST" || url.length > BOOMR.constants.MAX_GET_LENGTH) {
				// switch to a XHR beacon if the the user has specified a POST OR GET length is too long
				useImg = false;
			}

			//
			// Try the sendBeacon API first.
			// But if beacon_type is set to "GET", dont attempt
			// sendBeacon API call
			//
			if (w && w.navigator &&
			    typeof w.navigator.sendBeacon === "function" &&
			    BOOMR.utils.isNative(w.navigator.sendBeacon) &&
			    typeof w.Blob === "function" &&
			    impl.beacon_type !== "GET" &&
			    // As per W3C, The sendBeacon method does not provide ability to pass any
			    // header other than 'Content-Type'. So if we need to send data with
			    // 'Authorization' header, we need to fallback to good old xhr.
			    typeof impl.beacon_auth_token === "undefined" &&
			    !impl.beacon_disable_sendbeacon) {
				// note we're using sendBeacon with &sb=1
				var blobData = new w.Blob([paramsJoined + "&sb=1"], {
					type: "application/x-www-form-urlencoded"
				});

				if (w.navigator.sendBeacon(impl.beacon_url, blobData)) {
					return true;
				}

				// sendBeacon was not successful, try Image or XHR beacons
			}

			// If we don't have XHR available, force an image beacon and hope
			// for the best
			if (!BOOMR.orig_XMLHttpRequest && (!w || !w.XMLHttpRequest)) {
				useImg = true;
			}

			if (useImg) {
				//
				// Image beacon
				//

				// just in case Image isn't a valid constructor
				try {
					img = new Image();
				}
				catch (e) {
					BOOMR.debug("Image is not a constructor, not sending a beacon");
					return false;
				}

				img.src = url;
			}
			else {
				//
				// XHR beacon
				//

				// Send a form-encoded XHR POST beacon
				xhr = new (BOOMR.window.orig_XMLHttpRequest || BOOMR.orig_XMLHttpRequest || BOOMR.window.XMLHttpRequest)();
				try {
					this.sendXhrPostBeacon(xhr, paramsJoined);
				}
				catch (e) {
					// if we had an exception with the window XHR object, try our IFRAME XHR
					xhr = new BOOMR.boomerang_frame.XMLHttpRequest();
					this.sendXhrPostBeacon(xhr, paramsJoined);
				}
			}

			return true;
		},

		/**
		 * Determines whether or not a Page Load beacon has been sent.
		 *
		 * @returns {boolean} True if a Page Load beacon has been sent.
		 *
		 * @memberof BOOMR
		 */
		hasSentPageLoadBeacon: function() {
			return impl.hasSentPageLoadBeacon;
		},

		/**
		 * Sends a beacon via XMLHttpRequest
		 *
		 * @param {object} xhr XMLHttpRequest object
		 * @param {object} [paramsJoined] XMLHttpRequest.send() argument
		 *
		 * @memberof BOOMR
		 */
		sendXhrPostBeacon: function(xhr, paramsJoined) {
			xhr.open("POST", impl.beacon_url);

			xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");

			if (typeof impl.beacon_auth_token !== "undefined") {
				if (typeof impl.beacon_auth_key === "undefined") {
					impl.beacon_auth_key = "Authorization";
				}

				xhr.setRequestHeader(impl.beacon_auth_key, impl.beacon_auth_token);
			}

			if (impl.beacon_with_credentials) {
				xhr.withCredentials = true;
			}

			xhr.send(paramsJoined);
		},

		/**
		 * Gets all variables of the specified priority
		 *
		 * @param {object} vars Variables (will be modified for pri -1 and 1)
		 * @param {number} pri Priority (-1, 0, or 1)
		 *
		 * @return {string[]} Array of URI-encoded vars
		 *
		 * @memberof BOOMR
		 */
		getVarsOfPriority: function(vars, pri) {
			var name, url = [],
			    // if we were given a priority, iterate over that list
			    // else iterate over vars
			    iterVars = (pri !== 0 ? impl.varPriority[pri] : vars);

			for (name in iterVars) {
				// if this var is set, add it to our URL array
				if (iterVars.hasOwnProperty(name) && vars.hasOwnProperty(name)) {
					url.push(this.getUriEncodedVar(name, typeof vars[name] === "undefined" ? "" : vars[name]));

					// remove this name from vars so it isn't also added
					// to the non-prioritized list when pri=0 is called
					if (pri !== 0) {
						delete vars[name];
					}
				}
			}

			return url;
		},

		/**
		 * Gets a URI-encoded name/value pair.
		 *
		 * @param {string} name Name
		 * @param {string} value Value
		 *
		 * @returns {string} URI-encoded string
		 *
		 * @memberof BOOMR
		 */
		getUriEncodedVar: function(name, value) {
			if (value === undefined || value === null) {
				value = "";
			}

			if (typeof value === "object") {
				value = BOOMR.utils.serializeForUrl(value);
			}

			var result = encodeURIComponent(name) +
				"=" + encodeURIComponent(value);

			return result;
		},

		/**
		 * Gets the latest ResourceTiming entry for the specified URL.
		 *
		 * Default sort order is chronological startTime.
		 *
		 * @param {string} url Resource URL
		 * @param {function} [sort] Sort the entries before returning the last one
		 * @param {function} [filter] Filter the entries. Will be applied before sorting
		 *
		 * @returns {PerformanceEntry|undefined} Entry, or undefined if ResourceTiming is not
		 *  supported or if the entry doesn't exist
		 *
		 * @memberof BOOMR
		 */
		getResourceTiming: function(url, sort, filter) {
			var entries, p = BOOMR.getPerformance();

			try {
				if (p && typeof p.getEntriesByName === "function") {
					entries = p.getEntriesByName(url);
					if (!entries || !entries.length) {
						return;
					}
					if (typeof filter === "function") {
						entries = BOOMR.utils.arrayFilter(entries, filter);
						if (!entries || !entries.length) {
							return;
						}
					}
					if (entries.length > 1 && typeof sort === "function") {
						entries.sort(sort);
					}
					return entries[entries.length - 1];
				}
			}
			catch (e) {
				BOOMR.warn("getResourceTiming:" + e);
			}
		}

		/* BEGIN_DEBUG */,
		/**
		 * Sets the list of allowed Beacon URLs
		 *
		 * @param {string[]} urls List of string regular expressions
		 */
		setBeaconUrlsAllowed: function(urls) {
			impl.beacon_urls_allowed = urls;
		}
		/* END_DEBUG */
	};

	boomr.url = boomr.utils.getMyURL();



	delete BOOMR_start;

	/**
	 * @global
	 * @type {TimeStamp}
	 * @name BOOMR_lstart
	 * @desc
	 * Time the loader script started fetching boomerang.js (if the asynchronous
	 * loader snippet is used).
	 */
	if (typeof BOOMR_lstart === "number") {
		/**
		 * Time the loader script started fetching boomerang.js (if using the
		 * asynchronous loader snippet) (`BOOMR_lstart`)
		 * @type {TimeStamp}
		 *
		 * @memberof BOOMR
		 */
		boomr.t_lstart = BOOMR_lstart;
		delete BOOMR_lstart;
	}
	else if (typeof BOOMR.window.BOOMR_lstart === "number") {
		boomr.t_lstart = BOOMR.window.BOOMR_lstart;
	}

	/**
	 * Time the `window.onload` event fired (if using the asynchronous loader snippet).
	 *
	 * This timestamp is logged in the case boomerang.js loads after the onload event
	 * for browsers that don't support NavigationTiming.
	 *
	 * @global
	 * @name BOOMR_onload
	 * @type {TimeStamp}
	 */
	if (typeof BOOMR.window.BOOMR_onload === "number") {
		/**
		 * Time the `window.onload` event fired (if using the asynchronous loader snippet).
		 *
		 * This timestamp is logged in the case boomerang.js loads after the onload event
		 * for browsers that don't support NavigationTiming.
		 *
		 * @type {TimeStamp}
		 * @memberof BOOMR
		 */
		boomr.t_onload = BOOMR.window.BOOMR_onload;
	}

	(function() {
		var make_logger;

		if (typeof console === "object" && console.log !== undefined) {
			/**
			 * Logs the message to the console
			 *
			 * @param {string} m Message
			 * @param {string} l Log level
			 * @param {string} [s] Source
			 *
			 * @function log
			 *
			 * @memberof BOOMR
			 */
			boomr.log = function(m, l, s) {
				console.log("(" + BOOMR.now() + ") " +
					"{" + BOOMR.pageId + "}" +
					": " + s +
					": [" + l + "] " +
					m);
			};
		}
		else {
			// NOP for browsers that don't support it
			boomr.log = function() {};
		}

		make_logger = function(l) {
			return function(m, s) {
				this.log(m, l, "boomerang" + (s ? "." + s : ""));
				return this;
			};
		};

		/**
		 * Logs debug messages to the console
		 *
		 * Debug messages are stripped out of production builds.
		 *
		 * @param {string} m Message
		 * @param {string} [s] Source
		 *
		 * @function debug
		 *
		 * @memberof BOOMR
		 */
		boomr.debug = make_logger("debug");

		/**
		 * Logs info messages to the console
		 *
		 * @param {string} m Message
		 * @param {string} [s] Source
		 *
		 * @function info
		 *
		 * @memberof BOOMR
		 */
		boomr.info = make_logger("info");

		/**
		 * Logs warning messages to the console
		 *
		 * @param {string} m Message
		 * @param {string} [s] Source
		 *
		 * @function warn
		 *
		 * @memberof BOOMR
		 */
		boomr.warn = make_logger("warn");

		/**
		 * Logs error messages to the console
		 *
		 * @param {string} m Message
		 * @param {string} [s] Source
		 *
		 * @function error
		 *
		 * @memberof BOOMR
		 */
		boomr.error = make_logger("error");
	}());

	// If the browser supports performance.now(), swap that in for BOOMR.now
	try {
		var p = boomr.getPerformance();
		if (p &&
		    typeof p.now === "function" &&
		    // #545 handle bogus performance.now from broken shims
		    /\[native code\]/.test(String(p.now)) &&
		    p.timing &&
		    p.timing.navigationStart) {
			boomr.now = function() {
				return Math.round(p.now() + p.timing.navigationStart);
			};
		}
	}
	catch (ignore) {
		// empty
	}

	impl.checkLocalStorageSupport();

	(function() {
		var ident;
		for (ident in boomr) {
			if (boomr.hasOwnProperty(ident)) {
				BOOMR[ident] = boomr[ident];
			}
		}

		if (!BOOMR.xhr_excludes) {
			/**
			 * URLs to exclude from automatic `XMLHttpRequest` instrumentation.
			 *
			 * You can put any of the following in it:
			 * * A full URL
			 * * A hostname
			 * * A path
			 *
			 * @example
			 * BOOMR = window.BOOMR || {};
			 * BOOMR.xhr_excludes = {
			 *   "mysite.com": true,
			 *   "/dashboard/": true,
			 *   "https://mysite.com/dashboard/": true
			 * };
			 *
			 * @memberof BOOMR
			 */
			BOOMR.xhr_excludes = {};
		}
	}());

	/* BEGIN_DEBUG */
	/*
	 * This block reports on overridden functions on `window` and properties on `document` using `BOOMR.warn()`.
	 * To enable, add `overridden` with a value of `true` to the query string.
	 */
	(function() {
		/**
		 * Checks a window for overridden functions.
		 *
		 * @param {Window} win The window object under test
		 *
		 * @returns {Array} Array of overridden function names
		 */
		BOOMR.checkWindowOverrides = function(win) {
			if (!Object.getOwnPropertyNames) {
				return [];
			}

			var freshWindow, objects, overridden = [];
			function setup() {
				var iframe = d.createElement("iframe");
				iframe.style.display = "none";
				iframe.src = "javascript:false"; // eslint-disable-line no-script-url
				d.getElementsByTagName("script")[0].parentNode.appendChild(iframe);
				freshWindow = iframe.contentWindow;
				objects = Object.getOwnPropertyNames(freshWindow);
			}

			function teardown() {
				iframe.parentNode.removeChild(iframe);
			}

			function checkWindowObject(objectKey) {
				if (isNonNative(objectKey)) {
					overridden.push(objectKey);
				}
			}

			function isNonNative(key) {
				var split = key.split("."), fn = win, results = [];
				while (fn && split.length) {
					try {
						fn = fn[split.shift()];
					}
					catch (e) {
						return false;
					}
				}
				return typeof fn === "function" && !isNativeFunction(fn, key);
			}

			function isNativeFunction(fn, str) {
				if (str === "console.assert" ||
					str === "Function.prototype" ||
					str.indexOf("onload") >= 0 ||
					str.indexOf("onbeforeunload") >= 0 ||
					str.indexOf("onerror") >= 0 ||
					str.indexOf("onload") >= 0 ||
					str.indexOf("NodeFilter") >= 0) {
					return true;
				}
				return fn.toString &&
					!fn.hasOwnProperty("toString") &&
					/\[native code\]/.test(String(fn));
			}

			setup();
			for (var objectIndex = 0; objectIndex < objects.length; objectIndex++) {
				var objectKey = objects[objectIndex];
				if (objectKey === "window" ||
					objectKey === "self" ||
					objectKey === "top" ||
					objectKey === "parent" ||
					objectKey === "frames") {
					continue;
				}
				if (freshWindow[objectKey] &&
					(typeof freshWindow[objectKey] === "object" || typeof freshWindow[objectKey] === "function")) {
					checkWindowObject(objectKey);

					var propertyNames = [];
					try {
						propertyNames = Object.getOwnPropertyNames(freshWindow[objectKey]);
					}
					catch (e) {;}
					for (var i = 0; i < propertyNames.length; i++) {
						checkWindowObject([objectKey, propertyNames[i]].join("."));
					}

					if (freshWindow[objectKey].prototype) {
						propertyNames = Object.getOwnPropertyNames(freshWindow[objectKey].prototype);
						for (var i = 0; i < propertyNames.length; i++) {
							checkWindowObject([objectKey, "prototype", propertyNames[i]].join("."));
						}
					}
				}
			}
			return overridden;
		};

		/**
		 * Checks a document for overridden properties.
		 *
		 * @param {HTMLDocument} doc The document object under test
		 *
		 * @returns {Array} Array of overridden properties names
		 */
		BOOMR.checkDocumentOverrides = function(doc) {
			return BOOMR.utils.arrayFilter(["readyState", "domain", "hidden", "URL", "cookie"], function(key) {
				return doc.hasOwnProperty(key);
			});
		};

		if (BOOMR.utils.getQueryParamValue("overridden") === "true" && w && w.Object && Object.getOwnPropertyNames) {
			var overridden = []
				.concat(BOOMR.checkWindowOverrides(w))
				.concat(BOOMR.checkDocumentOverrides(d));
			if (overridden.length > 0) {
				BOOMR.warn("overridden: " + overridden.sort());
			}
		}
	})();
	/* END_DEBUG */

	dispatchEvent("onBoomerangLoaded", { "BOOMR": BOOMR }, true);

}(window));

(function (window, undefined) {
	var LIBVERSION = '0.7.19',
		EMPTY = '',
		UNKNOWN = '?',
		FUNC_TYPE = 'function',
		UNDEF_TYPE = 'undefined',
		OBJ_TYPE = 'object',
		STR_TYPE = 'string',
		MAJOR = 'major', // deprecated
		MODEL = 'model',
		NAME = 'name',
		TYPE = 'type',
		VENDOR = 'vendor',
		VERSION = 'version',
		ARCHITECTURE = 'architecture',
		CONSOLE = 'console',
		MOBILE = 'mobile',
		TABLET = 'tablet',
		SMARTTV = 'smarttv',
		WEARABLE = 'wearable',
		EMBEDDED = 'embedded';
	var util = {
		extend: function (regexes, extensions) {
			var margedRegexes = {};
			for (var i in regexes) {
				if (extensions[i] && extensions[i].length % 2 === 0) {
					margedRegexes[i] = extensions[i].concat(regexes[i]);
				} else {
					margedRegexes[i] = regexes[i];
				}
			}
			return margedRegexes;
		},
		has: function (str1, str2) {
			if (typeof str1 === "string") {
				return str2.toLowerCase().indexOf(str1.toLowerCase()) !== -1;
			} else {
				return false;
			}
		},
		lowerize: function (str) {
			return str.toLowerCase();
		},
		major: function (version) {
			return typeof (version) === STR_TYPE ? version.replace(/[^\d\.]/g, '').split(".")[0] : undefined;
		},
		trim: function (str) {
			return str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
		}
	};
	var mapper = {

		rgx: function (ua, arrays) {

			//var result = {},
			var i = 0, j, k, p, q, matches, match;//, args = arguments;

			/*// construct object barebones
			for (p = 0; p < args[1].length; p++) {
				q = args[1][p];
				result[typeof q === OBJ_TYPE ? q[0] : q] = undefined;
			}*/

			// loop through all regexes maps
			while (i < arrays.length && !matches) {

				var regex = arrays[i],       // even sequence (0,2,4,..)
					props = arrays[i + 1];   // odd sequence (1,3,5,..)
				j = k = 0;

				// try matching uastring with regexes
				while (j < regex.length && !matches) {

					matches = regex[j++].exec(ua);

					if (!!matches) {
						for (p = 0; p < props.length; p++) {
							match = matches[++k];
							q = props[p];
							// check if given property is actually array
							if (typeof q === OBJ_TYPE && q.length > 0) {
								if (q.length == 2) {
									if (typeof q[1] == FUNC_TYPE) {
										// assign modified match
										this[q[0]] = q[1].call(this, match);
									} else {
										// assign given value, ignore regex match
										this[q[0]] = q[1];
									}
								} else if (q.length == 3) {
									// check whether function or regex
									if (typeof q[1] === FUNC_TYPE && !(q[1].exec && q[1].test)) {
										// call function (usually string mapper)
										this[q[0]] = match ? q[1].call(this, match, q[2]) : undefined;
									} else {
										// sanitize match using given regex
										this[q[0]] = match ? match.replace(q[1], q[2]) : undefined;
									}
								} else if (q.length == 4) {
									this[q[0]] = match ? q[3].call(this, match.replace(q[1], q[2])) : undefined;
								}
							} else {
								this[q] = match ? match : undefined;
							}
						}
					}
				}
				i += 2;
			}
			// console.log(this);
			//return this;
		},

		str: function (str, map) {

			for (var i in map) {
				// check if array
				if (typeof map[i] === OBJ_TYPE && map[i].length > 0) {
					for (var j = 0; j < map[i].length; j++) {
						if (util.has(map[i][j], str)) {
							return (i === UNKNOWN) ? undefined : i;
						}
					}
				} else if (util.has(map[i], str)) {
					return (i === UNKNOWN) ? undefined : i;
				}
			}
			return str;
		}
	};
	var maps = {

		browser: {
			oldsafari: {
				version: {
					'1.0': '/8',
					'1.2': '/1',
					'1.3': '/3',
					'2.0': '/412',
					'2.0.2': '/416',
					'2.0.3': '/417',
					'2.0.4': '/419',
					'?': '/'
				}
			}
		},

		device: {
			amazon: {
				model: {
					'Fire Phone': ['SD', 'KF']
				}
			},
			sprint: {
				model: {
					'Evo Shift 4G': '7373KT'
				},
				vendor: {
					'HTC': 'APA',
					'Sprint': 'Sprint'
				}
			}
		},

		os: {
			windows: {
				version: {
					'ME': '4.90',
					'NT 3.11': 'NT3.51',
					'NT 4.0': 'NT4.0',
					'2000': 'NT 5.0',
					'XP': ['NT 5.1', 'NT 5.2'],
					'Vista': 'NT 6.0',
					'7': 'NT 6.1',
					'8': 'NT 6.2',
					'8.1': 'NT 6.3',
					'10': ['NT 6.4', 'NT 10.0'],
					'RT': 'ARM'
				}
			}
		}
	};
	var regexes = {

		browser: [[

			// Presto based
			/(opera\smini)\/([\w\.-]+)/i,                                       // Opera Mini
			/(opera\s[mobiletab]+).+version\/([\w\.-]+)/i,                      // Opera Mobi/Tablet
			/(opera).+version\/([\w\.]+)/i,                                     // Opera > 9.80
			/(opera)[\/\s]+([\w\.]+)/i                                          // Opera < 9.80
		], [NAME, VERSION], [

			/(opios)[\/\s]+([\w\.]+)/i                                          // Opera mini on iphone >= 8.0
		], [[NAME, 'Opera Mini'], VERSION], [

			/\s(opr)\/([\w\.]+)/i                                               // Opera Webkit
		], [[NAME, 'Opera'], VERSION], [

			// Mixed
			/(kindle)\/([\w\.]+)/i,                                             // Kindle
			/(lunascape|maxthon|netfront|jasmine|blazer)[\/\s]?([\w\.]*)/i,
			// Lunascape/Maxthon/Netfront/Jasmine/Blazer

			// Trident based
			/(avant\s|iemobile|slim|baidu)(?:browser)?[\/\s]?([\w\.]*)/i,
			// Avant/IEMobile/SlimBrowser/Baidu
			/(?:ms|\()(ie)\s([\w\.]+)/i,                                        // Internet Explorer

			// Webkit/KHTML based
			/(rekonq)\/([\w\.]*)/i,                                             // Rekonq
			/(chromium|flock|rockmelt|midori|epiphany|silk|skyfire|ovibrowser|bolt|iron|vivaldi|iridium|phantomjs|bowser|quark|qupzilla|falkon)\/([\w\.-]+)/i
			// Chromium/Flock/RockMelt/Midori/Epiphany/Silk/Skyfire/Bolt/Iron/Iridium/PhantomJS/Bowser/QupZilla/Falkon
		], [NAME, VERSION], [

			/(konqueror)\/([\w\.]+)/i                                           // Konqueror
		], [[NAME, 'Konqueror'], VERSION], [

			/(trident).+rv[:\s]([\w\.]+).+like\sgecko/i                         // IE11
		], [[NAME, 'IE'], VERSION], [

			/(edge|edgios|edga)\/((\d+)?[\w\.]+)/i                              // Microsoft Edge
		], [[NAME, 'Edge'], VERSION], [

			/(yabrowser)\/([\w\.]+)/i                                           // Yandex
		], [[NAME, 'Yandex'], VERSION], [

			/(puffin)\/([\w\.]+)/i                                              // Puffin
		], [[NAME, 'Puffin'], VERSION], [

			/(focus)\/([\w\.]+)/i                                               // Firefox Focus
		], [[NAME, 'Firefox Focus'], VERSION], [

			/(opt)\/([\w\.]+)/i                                                 // Opera Touch
		], [[NAME, 'Opera Touch'], VERSION], [

			/((?:[\s\/])uc?\s?browser|(?:juc.+)ucweb)[\/\s]?([\w\.]+)/i         // UCBrowser
		], [[NAME, 'UCBrowser'], VERSION], [

			/(comodo_dragon)\/([\w\.]+)/i                                       // Comodo Dragon
		], [[NAME, /_/g, ' '], VERSION], [

			/(micromessenger)\/([\w\.]+)/i                                      // WeChat
		], [[NAME, 'WeChat'], VERSION], [

			/(brave)\/([\w\.]+)/i                                              // Brave browser
		], [[NAME, 'Brave'], VERSION], [

			/(qqbrowserlite)\/([\w\.]+)/i                                       // QQBrowserLite
		], [NAME, VERSION], [

			/(QQ)\/([\d\.]+)/i                                                  // QQ, aka ShouQ
		], [NAME, VERSION], [

			/m?(qqbrowser)[\/\s]?([\w\.]+)/i                                    // QQBrowser
		], [NAME, VERSION], [

			/(BIDUBrowser)[\/\s]?([\w\.]+)/i                                    // Baidu Browser
		], [NAME, VERSION], [

			/(2345Explorer)[\/\s]?([\w\.]+)/i                                   // 2345 Browser
		], [NAME, VERSION], [

			/(MetaSr)[\/\s]?([\w\.]+)/i                                         // SouGouBrowser
		], [NAME], [

			/(LBBROWSER)/i                                      // LieBao Browser
		], [NAME], [

			/xiaomi\/miuibrowser\/([\w\.]+)/i                                   // MIUI Browser
		], [VERSION, [NAME, 'MIUI Browser']], [

			/;fbav\/([\w\.]+);/i                                                // Facebook App for iOS & Android
		], [VERSION, [NAME, 'Facebook']], [

			/safari\s(line)\/([\w\.]+)/i,                                       // Line App for iOS
			/android.+(line)\/([\w\.]+)\/iab/i                                  // Line App for Android
		], [NAME, VERSION], [

			/headlesschrome(?:\/([\w\.]+)|\s)/i                                 // Chrome Headless
		], [VERSION, [NAME, 'Chrome Headless']], [

			/\swv\).+(chrome)\/([\w\.]+)/i                                      // Chrome WebView
		], [[NAME, /(.+)/, '$1 WebView'], VERSION], [

			/((?:oculus|samsung)browser)\/([\w\.]+)/i
		], [[NAME, /(.+(?:g|us))(.+)/, '$1 $2'], VERSION], [                // Oculus / Samsung Browser

			/android.+version\/([\w\.]+)\s+(?:mobile\s?safari|safari)*/i        // Android Browser
		], [VERSION, [NAME, 'Android Browser']], [

			/(chrome|omniweb|arora|[tizenoka]{5}\s?browser)\/v?([\w\.]+)/i
			// Chrome/OmniWeb/Arora/Tizen/Nokia
		], [NAME, VERSION], [

			/(dolfin)\/([\w\.]+)/i                                              // Dolphin
		], [[NAME, 'Dolphin'], VERSION], [

			/((?:android.+)crmo|crios)\/([\w\.]+)/i                             // Chrome for Android/iOS
		], [[NAME, 'Chrome'], VERSION], [

			/(coast)\/([\w\.]+)/i                                               // Opera Coast
		], [[NAME, 'Opera Coast'], VERSION], [

			/fxios\/([\w\.-]+)/i                                                // Firefox for iOS
		], [VERSION, [NAME, 'Firefox']], [

			/version\/([\w\.]+).+?mobile\/\w+\s(safari)/i                       // Mobile Safari
		], [VERSION, [NAME, 'Mobile Safari']], [

			/version\/([\w\.]+).+?(mobile\s?safari|safari)/i                    // Safari & Safari Mobile
		], [VERSION, NAME], [

			/webkit.+?(gsa)\/([\w\.]+).+?(mobile\s?safari|safari)(\/[\w\.]+)/i  // Google Search Appliance on iOS
		], [[NAME, 'GSA'], VERSION], [

			/webkit.+?(mobile\s?safari|safari)(\/[\w\.]+)/i                     // Safari < 3.0
		], [NAME, [VERSION, mapper.str, maps.browser.oldsafari.version]], [

			/(webkit|khtml)\/([\w\.]+)/i
		], [NAME, VERSION], [

			// Gecko based
			/(navigator|netscape)\/([\w\.-]+)/i                                 // Netscape
		], [[NAME, 'Netscape'], VERSION], [
			/(swiftfox)/i,                                                      // Swiftfox
			/(icedragon|iceweasel|camino|chimera|fennec|maemo\sbrowser|minimo|conkeror)[\/\s]?([\w\.\+]+)/i,
			// IceDragon/Iceweasel/Camino/Chimera/Fennec/Maemo/Minimo/Conkeror
			/(firefox|seamonkey|k-meleon|icecat|iceape|firebird|phoenix|palemoon|basilisk|waterfox)\/([\w\.-]+)$/i,

			// Firefox/SeaMonkey/K-Meleon/IceCat/IceApe/Firebird/Phoenix
			/(mozilla)\/([\w\.]+).+rv\:.+gecko\/\d+/i,                          // Mozilla

			// Other
			/(polaris|lynx|dillo|icab|doris|amaya|w3m|netsurf|sleipnir)[\/\s]?([\w\.]+)/i,
			// Polaris/Lynx/Dillo/iCab/Doris/Amaya/w3m/NetSurf/Sleipnir
			/(links)\s\(([\w\.]+)/i,                                            // Links
			/(gobrowser)\/?([\w\.]*)/i,                                         // GoBrowser
			/(ice\s?browser)\/v?([\w\._]+)/i,                                   // ICE Browser
			/(mosaic)[\/\s]([\w\.]+)/i                                          // Mosaic
		], [NAME, VERSION]
		],

		cpu: [[

			/(?:(amd|x(?:(?:86|64)[_-])?|wow|win)64)[;\)]/i                     // AMD64
		], [[ARCHITECTURE, 'amd64']], [

			/(ia32(?=;))/i                                                      // IA32 (quicktime)
		], [[ARCHITECTURE, util.lowerize]], [

			/((?:i[346]|x)86)[;\)]/i                                            // IA32
		], [[ARCHITECTURE, 'ia32']], [

			// PocketPC mistakenly identified as PowerPC
			/windows\s(ce|mobile);\sppc;/i
		], [[ARCHITECTURE, 'arm']], [

			/((?:ppc|powerpc)(?:64)?)(?:\smac|;|\))/i                           // PowerPC
		], [[ARCHITECTURE, /ower/, '', util.lowerize]], [

			/(sun4\w)[;\)]/i                                                    // SPARC
		], [[ARCHITECTURE, 'sparc']], [

			/((?:avr32|ia64(?=;))|68k(?=\))|arm(?:64|(?=v\d+[;l]))|(?=atmel\s)avr|(?:irix|mips|sparc)(?:64)?(?=;)|pa-risc)/i
			// IA64, 68K, ARM/64, AVR/32, IRIX/64, MIPS/64, SPARC/64, PA-RISC
		], [[ARCHITECTURE, util.lowerize]]
		],

		device: [[

			/\((ipad|playbook);[\w\s\),;-]+(rim|apple)/i                        // iPad/PlayBook
		], [MODEL, VENDOR, [TYPE, TABLET]], [

			/applecoremedia\/[\w\.]+ \((ipad)/                                  // iPad
		], [MODEL, [VENDOR, 'Apple'], [TYPE, TABLET]], [

			/(apple\s{0,1}tv)/i                                                 // Apple TV
		], [[MODEL, 'Apple TV'], [VENDOR, 'Apple']], [

			/(archos)\s(gamepad2?)/i,                                           // Archos
			/(hp).+(touchpad)/i,                                                // HP TouchPad
			/(hp).+(tablet)/i,                                                  // HP Tablet
			/(kindle)\/([\w\.]+)/i,                                             // Kindle
			/\s(nook)[\w\s]+build\/(\w+)/i,                                     // Nook
			/(dell)\s(strea[kpr\s\d]*[\dko])/i                                  // Dell Streak
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/(kf[A-z]+)\sbuild\/.+silk\//i                                      // Kindle Fire HD
		], [MODEL, [VENDOR, 'Amazon'], [TYPE, TABLET]], [
			/(sd|kf)[0349hijorstuw]+\sbuild\/.+silk\//i                         // Fire Phone
		], [[MODEL, mapper.str, maps.device.amazon.model], [VENDOR, 'Amazon'], [TYPE, MOBILE]], [
			/android.+aft([bms])\sbuild/i                                       // Fire TV
		], [MODEL, [VENDOR, 'Amazon'], [TYPE, SMARTTV]], [

			/\((ip[honed|\s\w*]+);.+(apple)/i                                   // iPod/iPhone
		], [MODEL, VENDOR, [TYPE, MOBILE]], [
			/\((ip[honed|\s\w*]+);/i                                            // iPod/iPhone
		], [MODEL, [VENDOR, 'Apple'], [TYPE, MOBILE]], [

			/(blackberry)[\s-]?(\w+)/i,                                         // BlackBerry
			/(blackberry|benq|palm(?=\-)|sonyericsson|acer|asus|dell|meizu|motorola|polytron)[\s_-]?([\w-]*)/i,
			// BenQ/Palm/Sony-Ericsson/Acer/Asus/Dell/Meizu/Motorola/Polytron
			/(hp)\s([\w\s]+\w)/i,                                               // HP iPAQ
			/(asus)-?(\w+)/i                                                    // Asus
		], [VENDOR, MODEL, [TYPE, MOBILE]], [
			/\(bb10;\s(\w+)/i                                                   // BlackBerry 10
		], [MODEL, [VENDOR, 'BlackBerry'], [TYPE, MOBILE]], [
			// Asus Tablets
			/android.+(transfo[prime\s]{4,10}\s\w+|eeepc|slider\s\w+|nexus 7|padfone|p00c)/i
		], [MODEL, [VENDOR, 'Asus'], [TYPE, TABLET]], [

			/(sony)\s(tablet\s[ps])\sbuild\//i,                                  // Sony
			/(sony)?(?:sgp.+)\sbuild\//i
		], [[VENDOR, 'Sony'], [MODEL, 'Xperia Tablet'], [TYPE, TABLET]], [
			/android.+\s([c-g]\d{4}|so[-l]\w+)(?=\sbuild\/|\).+chrome\/(?![1-6]{0,1}\d\.))/i
		], [MODEL, [VENDOR, 'Sony'], [TYPE, MOBILE]], [

			/\s(ouya)\s/i,                                                      // Ouya
			/(nintendo)\s([wids3u]+)/i                                          // Nintendo
		], [VENDOR, MODEL, [TYPE, CONSOLE]], [

			/android.+;\s(shield)\sbuild/i                                      // Nvidia
		], [MODEL, [VENDOR, 'Nvidia'], [TYPE, CONSOLE]], [

			/(playstation\s[34portablevi]+)/i                                   // Playstation
		], [MODEL, [VENDOR, 'Sony'], [TYPE, CONSOLE]], [

			/(sprint\s(\w+))/i                                                  // Sprint Phones
		], [[VENDOR, mapper.str, maps.device.sprint.vendor], [MODEL, mapper.str, maps.device.sprint.model], [TYPE, MOBILE]], [

			/(lenovo)\s?(S(?:5000|6000)+(?:[-][\w+]))/i                         // Lenovo tablets
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/(htc)[;_\s-]+([\w\s]+(?=\)|\sbuild)|\w+)/i,                        // HTC
			/(zte)-(\w*)/i,                                                     // ZTE
			/(alcatel|geeksphone|lenovo|nexian|panasonic|(?=;\s)sony)[_\s-]?([\w-]*)/i
			// Alcatel/GeeksPhone/Lenovo/Nexian/Panasonic/Sony
		], [VENDOR, [MODEL, /_/g, ' '], [TYPE, MOBILE]], [

			/(nexus\s9)/i                                                       // HTC Nexus 9
		], [MODEL, [VENDOR, 'HTC'], [TYPE, TABLET]], [

			/d\/huawei([\w\s-]+)[;\)]/i,
			/(nexus\s6p)/i                                                      // Huawei
		], [MODEL, [VENDOR, 'Huawei'], [TYPE, MOBILE]], [

			/(microsoft);\s(lumia[\s\w]+)/i                                     // Microsoft Lumia
		], [VENDOR, MODEL, [TYPE, MOBILE]], [

			/[\s\(;](xbox(?:\sone)?)[\s\);]/i                                   // Microsoft Xbox
		], [MODEL, [VENDOR, 'Microsoft'], [TYPE, CONSOLE]], [
			/(kin\.[onetw]{3})/i                                                // Microsoft Kin
		], [[MODEL, /\./g, ' '], [VENDOR, 'Microsoft'], [TYPE, MOBILE]], [

			// Motorola
			/\s(milestone|droid(?:[2-4x]|\s(?:bionic|x2|pro|razr))?:?(\s4g)?)[\w\s]+build\//i,
			/mot[\s-]?(\w*)/i,
			/(XT\d{3,4}) build\//i,
			/(nexus\s6)/i
		], [MODEL, [VENDOR, 'Motorola'], [TYPE, MOBILE]], [
			/android.+\s(mz60\d|xoom[\s2]{0,2})\sbuild\//i
		], [MODEL, [VENDOR, 'Motorola'], [TYPE, TABLET]], [

			/hbbtv\/\d+\.\d+\.\d+\s+\([\w\s]*;\s*(\w[^;]*);([^;]*)/i            // HbbTV devices
		], [[VENDOR, util.trim], [MODEL, util.trim], [TYPE, SMARTTV]], [

			/hbbtv.+maple;(\d+)/i
		], [[MODEL, /^/, 'SmartTV'], [VENDOR, 'Samsung'], [TYPE, SMARTTV]], [

			/\(dtv[\);].+(aquos)/i                                              // Sharp
		], [MODEL, [VENDOR, 'Sharp'], [TYPE, SMARTTV]], [

			/android.+((sch-i[89]0\d|shw-m380s|gt-p\d{4}|gt-n\d+|sgh-t8[56]9|nexus 10))/i,
			/((SM-T\w+))/i
		], [[VENDOR, 'Samsung'], MODEL, [TYPE, TABLET]], [                  // Samsung
			/smart-tv.+(samsung)/i
		], [VENDOR, [TYPE, SMARTTV], MODEL], [
			/((s[cgp]h-\w+|gt-\w+|galaxy\snexus|sm-\w[\w\d]+))/i,
			/(sam[sung]*)[\s-]*(\w+-?[\w-]*)/i,
			/sec-((sgh\w+))/i
		], [[VENDOR, 'Samsung'], MODEL, [TYPE, MOBILE]], [

			/sie-(\w*)/i                                                        // Siemens
		], [MODEL, [VENDOR, 'Siemens'], [TYPE, MOBILE]], [

			/(maemo|nokia).*(n900|lumia\s\d+)/i,                                // Nokia
			/(nokia)[\s_-]?([\w-]*)/i
		], [[VENDOR, 'Nokia'], MODEL, [TYPE, MOBILE]], [

			/android[x\d\.\s;]+\s([ab][1-7]\-?[0178a]\d\d?)/i                   // Acer
		], [MODEL, [VENDOR, 'Acer'], [TYPE, TABLET]], [

			/android.+([vl]k\-?\d{3})\s+build/i                                 // LG Tablet
		], [MODEL, [VENDOR, 'LG'], [TYPE, TABLET]], [
			/android\s3\.[\s\w;-]{10}(lg?)-([06cv9]{3,4})/i                     // LG Tablet
		], [[VENDOR, 'LG'], MODEL, [TYPE, TABLET]], [
			/(lg) netcast\.tv/i                                                 // LG SmartTV
		], [VENDOR, MODEL, [TYPE, SMARTTV]], [
			/(nexus\s[45])/i,                                                   // LG
			/lg[e;\s\/-]+(\w*)/i,
			/android.+lg(\-?[\d\w]+)\s+build/i
		], [MODEL, [VENDOR, 'LG'], [TYPE, MOBILE]], [

			/android.+(ideatab[a-z0-9\-\s]+)/i                                  // Lenovo
		], [MODEL, [VENDOR, 'Lenovo'], [TYPE, TABLET]], [

			/linux;.+((jolla));/i                                               // Jolla
		], [VENDOR, MODEL, [TYPE, MOBILE]], [

			/((pebble))app\/[\d\.]+\s/i                                         // Pebble
		], [VENDOR, MODEL, [TYPE, WEARABLE]], [

			/android.+;\s(oppo)\s?([\w\s]+)\sbuild/i                            // OPPO
		], [VENDOR, MODEL, [TYPE, MOBILE]], [

			/crkey/i                                                            // Google Chromecast
		], [[MODEL, 'Chromecast'], [VENDOR, 'Google']], [

			/android.+;\s(glass)\s\d/i                                          // Google Glass
		], [MODEL, [VENDOR, 'Google'], [TYPE, WEARABLE]], [

			/android.+;\s(pixel c)[\s)]/i                                       // Google Pixel C
		], [MODEL, [VENDOR, 'Google'], [TYPE, TABLET]], [

			/android.+;\s(pixel( [23])?( xl)?)\s/i                              // Google Pixel
		], [MODEL, [VENDOR, 'Google'], [TYPE, MOBILE]], [

			/android.+;\s(\w+)\s+build\/hm\1/i,                                 // Xiaomi Hongmi 'numeric' models
			/android.+(hm[\s\-_]*note?[\s_]*(?:\d\w)?)\s+build/i,               // Xiaomi Hongmi
			/android.+(mi[\s\-_]*(?:one|one[\s_]plus|note lte)?[\s_]*(?:\d?\w?)[\s_]*(?:plus)?)\s+build/i,    // Xiaomi Mi
			/android.+(redmi[\s\-_]*(?:note)?(?:[\s_]*[\w\s]+))\s+build/i       // Redmi Phones
		], [[MODEL, /_/g, ' '], [VENDOR, 'Xiaomi'], [TYPE, MOBILE]], [
			/android.+(mi[\s\-_]*(?:pad)(?:[\s_]*[\w\s]+))\s+build/i            // Mi Pad tablets
		], [[MODEL, /_/g, ' '], [VENDOR, 'Xiaomi'], [TYPE, TABLET]], [
			/android.+;\s(m[1-5]\snote)\sbuild/i                                // Meizu Tablet
		], [MODEL, [VENDOR, 'Meizu'], [TYPE, TABLET]], [
			/(mz)-([\w-]{2,})/i                                                 // Meizu Phone
		], [[VENDOR, 'Meizu'], MODEL, [TYPE, MOBILE]], [

			/android.+a000(1)\s+build/i,                                        // OnePlus
			/android.+oneplus\s(a\d{4})\s+build/i
		], [MODEL, [VENDOR, 'OnePlus'], [TYPE, MOBILE]], [

			/android.+[;\/]\s*(RCT[\d\w]+)\s+build/i                            // RCA Tablets
		], [MODEL, [VENDOR, 'RCA'], [TYPE, TABLET]], [

			/android.+[;\/\s]+(Venue[\d\s]{2,7})\s+build/i                      // Dell Venue Tablets
		], [MODEL, [VENDOR, 'Dell'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(Q[T|M][\d\w]+)\s+build/i                         // Verizon Tablet
		], [MODEL, [VENDOR, 'Verizon'], [TYPE, TABLET]], [

			/android.+[;\/]\s+(Barnes[&\s]+Noble\s+|BN[RT])(V?.*)\s+build/i     // Barnes & Noble Tablet
		], [[VENDOR, 'Barnes & Noble'], MODEL, [TYPE, TABLET]], [

			/android.+[;\/]\s+(TM\d{3}.*\b)\s+build/i                           // Barnes & Noble Tablet
		], [MODEL, [VENDOR, 'NuVision'], [TYPE, TABLET]], [

			/android.+;\s(k88)\sbuild/i                                         // ZTE K Series Tablet
		], [MODEL, [VENDOR, 'ZTE'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(gen\d{3})\s+build.*49h/i                         // Swiss GEN Mobile
		], [MODEL, [VENDOR, 'Swiss'], [TYPE, MOBILE]], [

			/android.+[;\/]\s*(zur\d{3})\s+build/i                              // Swiss ZUR Tablet
		], [MODEL, [VENDOR, 'Swiss'], [TYPE, TABLET]], [

			/android.+[;\/]\s*((Zeki)?TB.*\b)\s+build/i                         // Zeki Tablets
		], [MODEL, [VENDOR, 'Zeki'], [TYPE, TABLET]], [

			/(android).+[;\/]\s+([YR]\d{2})\s+build/i,
			/android.+[;\/]\s+(Dragon[\-\s]+Touch\s+|DT)(\w{5})\sbuild/i        // Dragon Touch Tablet
		], [[VENDOR, 'Dragon Touch'], MODEL, [TYPE, TABLET]], [

			/android.+[;\/]\s*(NS-?\w{0,9})\sbuild/i                            // Insignia Tablets
		], [MODEL, [VENDOR, 'Insignia'], [TYPE, TABLET]], [

			/android.+[;\/]\s*((NX|Next)-?\w{0,9})\s+build/i                    // NextBook Tablets
		], [MODEL, [VENDOR, 'NextBook'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(Xtreme\_)?(V(1[045]|2[015]|30|40|60|7[05]|90))\s+build/i
		], [[VENDOR, 'Voice'], MODEL, [TYPE, MOBILE]], [                    // Voice Xtreme Phones

			/android.+[;\/]\s*(LVTEL\-)?(V1[12])\s+build/i                     // LvTel Phones
		], [[VENDOR, 'LvTel'], MODEL, [TYPE, MOBILE]], [

			/android.+;\s(PH-1)\s/i
		], [MODEL, [VENDOR, 'Essential'], [TYPE, MOBILE]], [                // Essential PH-1

			/android.+[;\/]\s*(V(100MD|700NA|7011|917G).*\b)\s+build/i          // Envizen Tablets
		], [MODEL, [VENDOR, 'Envizen'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(Le[\s\-]+Pan)[\s\-]+(\w{1,9})\s+build/i          // Le Pan Tablets
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/android.+[;\/]\s*(Trio[\s\-]*.*)\s+build/i                         // MachSpeed Tablets
		], [MODEL, [VENDOR, 'MachSpeed'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(Trinity)[\-\s]*(T\d{3})\s+build/i                // Trinity Tablets
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/android.+[;\/]\s*TU_(1491)\s+build/i                               // Rotor Tablets
		], [MODEL, [VENDOR, 'Rotor'], [TYPE, TABLET]], [

			/android.+(KS(.+))\s+build/i                                        // Amazon Kindle Tablets
		], [MODEL, [VENDOR, 'Amazon'], [TYPE, TABLET]], [

			/android.+(Gigaset)[\s\-]+(Q\w{1,9})\s+build/i                      // Gigaset Tablets
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/\s(tablet|tab)[;\/]/i,                                             // Unidentifiable Tablet
			/\s(mobile)(?:[;\/]|\ssafari)/i                                     // Unidentifiable Mobile
		], [[TYPE, util.lowerize], VENDOR, MODEL], [

			/[\s\/\(](smart-?tv)[;\)]/i                                         // SmartTV
		], [[TYPE, SMARTTV]], [

			/(android[\w\.\s\-]{0,9});.+build/i                                 // Generic Android Device
		], [MODEL, [VENDOR, 'Generic']]
		],

		engine: [[

			/windows.+\sedge\/([\w\.]+)/i                                       // EdgeHTML
		], [VERSION, [NAME, 'EdgeHTML']], [

			/webkit\/537\.36.+chrome\/(?!27)/i                                  // Blink
		], [[NAME, 'Blink']], [

			/(presto)\/([\w\.]+)/i,                                             // Presto
			/(webkit|trident|netfront|netsurf|amaya|lynx|w3m|goanna)\/([\w\.]+)/i,
			// WebKit/Trident/NetFront/NetSurf/Amaya/Lynx/w3m/Goanna
			/(khtml|tasman|links)[\/\s]\(?([\w\.]+)/i,                          // KHTML/Tasman/Links
			/(icab)[\/\s]([23]\.[\d\.]+)/i                                      // iCab
		], [NAME, VERSION], [

			/rv\:([\w\.]{1,9}).+(gecko)/i                                       // Gecko
		], [VERSION, NAME]
		],

		os: [[

			// Windows based
			/microsoft\s(windows)\s(vista|xp)/i                                 // Windows (iTunes)
		], [NAME, VERSION], [
			/(windows)\snt\s6\.2;\s(arm)/i,                                     // Windows RT
			/(windows\sphone(?:\sos)*)[\s\/]?([\d\.\s\w]*)/i,                   // Windows Phone
			/(windows\smobile|windows)[\s\/]?([ntce\d\.\s]+\w)/i
		], [NAME, [VERSION, mapper.str, maps.os.windows.version]], [
			/(win(?=3|9|n)|win\s9x\s)([nt\d\.]+)/i
		], [[NAME, 'Windows'], [VERSION, mapper.str, maps.os.windows.version]], [

			// Mobile/Embedded OS
			/\((bb)(10);/i                                                      // BlackBerry 10
		], [[NAME, 'BlackBerry'], VERSION], [
			/(blackberry)\w*\/?([\w\.]*)/i,                                     // Blackberry
			/(tizen)[\/\s]([\w\.]+)/i,                                          // Tizen
			/(android|webos|palm\sos|qnx|bada|rim\stablet\sos|meego|contiki)[\/\s-]?([\w\.]*)/i,
			// Android/WebOS/Palm/QNX/Bada/RIM/MeeGo/Contiki
			/linux;.+(sailfish);/i                                              // Sailfish OS
		], [NAME, VERSION], [
			/(symbian\s?os|symbos|s60(?=;))[\/\s-]?([\w\.]*)/i                  // Symbian
		], [[NAME, 'Symbian'], VERSION], [
			/\((series40);/i                                                    // Series 40
		], [NAME], [
			/mozilla.+\(mobile;.+gecko.+firefox/i                               // Firefox OS
		], [[NAME, 'Firefox OS'], VERSION], [

			// Console
			/(nintendo|playstation)\s([wids34portablevu]+)/i,                   // Nintendo/Playstation

			// GNU/Linux based
			/(mint)[\/\s\(]?(\w*)/i,                                            // Mint
			/(mageia|vectorlinux)[;\s]/i,                                       // Mageia/VectorLinux
			/(joli|[kxln]?ubuntu|debian|suse|opensuse|gentoo|(?=\s)arch|slackware|fedora|mandriva|centos|pclinuxos|redhat|zenwalk|linpus)[\/\s-]?(?!chrom)([\w\.-]*)/i,
			// Joli/Ubuntu/Debian/SUSE/Gentoo/Arch/Slackware
			// Fedora/Mandriva/CentOS/PCLinuxOS/RedHat/Zenwalk/Linpus
			/(hurd|linux)\s?([\w\.]*)/i,                                        // Hurd/Linux
			/(gnu)\s?([\w\.]*)/i                                                // GNU
		], [NAME, VERSION], [

			/(cros)\s[\w]+\s([\w\.]+\w)/i                                       // Chromium OS
		], [[NAME, 'Chromium OS'], VERSION], [

			// Solaris
			/(sunos)\s?([\w\.\d]*)/i                                            // Solaris
		], [[NAME, 'Solaris'], VERSION], [

			// BSD based
			/\s([frentopc-]{0,4}bsd|dragonfly)\s?([\w\.]*)/i                    // FreeBSD/NetBSD/OpenBSD/PC-BSD/DragonFly
		], [NAME, VERSION], [

			/(haiku)\s(\w+)/i                                                   // Haiku
		], [NAME, VERSION], [

			/cfnetwork\/.+darwin/i,
			/ip[honead]{2,4}(?:.*os\s([\w]+)\slike\smac|;\sopera)/i             // iOS
		], [[VERSION, /_/g, '.'], [NAME, 'iOS']], [

			/(mac\sos\sx)\s?([\w\s\.]*)/i,
			/(macintosh|mac(?=_powerpc)\s)/i                                    // Mac OS
		], [[NAME, 'Mac OS'], [VERSION, /_/g, '.']], [

			// Other
			/((?:open)?solaris)[\/\s-]?([\w\.]*)/i,                             // Solaris
			/(aix)\s((\d)(?=\.|\)|\s)[\w\.])*/i,                                // AIX
			/(plan\s9|minix|beos|os\/2|amigaos|morphos|risc\sos|openvms|fuchsia)/i,
			// Plan9/Minix/BeOS/OS2/AmigaOS/MorphOS/RISCOS/OpenVMS/Fuchsia
			/(unix)\s?([\w\.]*)/i                                               // UNIX
		], [NAME, VERSION]
		]
	};

	var UAParser = function (uastring, extensions) {

		if (typeof uastring === 'object') {
			extensions = uastring;
			uastring = undefined;
		}

		if (!(this instanceof UAParser)) {
			return new UAParser(uastring, extensions).getResult();
		}

		var ua = uastring || ((window && window.navigator && window.navigator.userAgent) ? window.navigator.userAgent : EMPTY);
		var rgxmap = extensions ? util.extend(regexes, extensions) : regexes;

		this.getBrowser = function () {
			var browser = { name: undefined, version: undefined };
			mapper.rgx.call(browser, ua, rgxmap.browser);
			browser.major = util.major(browser.version); // deprecated
			return browser;
		};
		this.getCPU = function () {
			var cpu = { architecture: undefined };
			mapper.rgx.call(cpu, ua, rgxmap.cpu);
			return cpu;
		};
		this.getDevice = function () {
			var device = { vendor: undefined, model: undefined, type: undefined };
			mapper.rgx.call(device, ua, rgxmap.device);
			return device;
		};
		this.getEngine = function () {
			var engine = { name: undefined, version: undefined };
			mapper.rgx.call(engine, ua, rgxmap.engine);
			return engine;
		};
		this.getOS = function () {
			var os = { name: undefined, version: undefined };
			mapper.rgx.call(os, ua, rgxmap.os);
			return os;
		};
		this.getResult = function () {
			return {
				ua: this.getUA(),
				browser: this.getBrowser(),
				engine: this.getEngine(),
				os: this.getOS(),
				device: this.getDevice(),
				cpu: this.getCPU()
			};
		};
		this.getUA = function () {
			return ua;
		};
		this.setUA = function (uastring) {
			ua = uastring;
			return this;
		};
		return this;
	};

	UAParser.VERSION = LIBVERSION;
	UAParser.BROWSER = {
		NAME: NAME,
		MAJOR: MAJOR, // deprecated
		VERSION: VERSION
	};
	UAParser.CPU = {
		ARCHITECTURE: ARCHITECTURE
	};
	UAParser.DEVICE = {
		MODEL: MODEL,
		VENDOR: VENDOR,
		TYPE: TYPE,
		CONSOLE: CONSOLE,
		MOBILE: MOBILE,
		SMARTTV: SMARTTV,
		TABLET: TABLET,
		WEARABLE: WEARABLE,
		EMBEDDED: EMBEDDED
	};
	UAParser.ENGINE = {
		NAME: NAME,
		VERSION: VERSION
	};
	UAParser.OS = {
		NAME: NAME,
		VERSION: VERSION
	};
	if (!window.UAParser) {
		window.UAParser = UAParser;
	}

}(window));

(function (window, undefined) {
	var LIBVERSION = '0.7.19',
		EMPTY = '',
		UNKNOWN = '?',
		FUNC_TYPE = 'function',
		UNDEF_TYPE = 'undefined',
		OBJ_TYPE = 'object',
		STR_TYPE = 'string',
		MAJOR = 'major', // deprecated
		MODEL = 'model',
		NAME = 'name',
		TYPE = 'type',
		VENDOR = 'vendor',
		VERSION = 'version',
		ARCHITECTURE = 'architecture',
		CONSOLE = 'console',
		MOBILE = 'mobile',
		TABLET = 'tablet',
		SMARTTV = 'smarttv',
		WEARABLE = 'wearable',
		EMBEDDED = 'embedded';
	var util = {
		extend: function (regexes, extensions) {
			var margedRegexes = {};
			for (var i in regexes) {
				if (extensions[i] && extensions[i].length % 2 === 0) {
					margedRegexes[i] = extensions[i].concat(regexes[i]);
				} else {
					margedRegexes[i] = regexes[i];
				}
			}
			return margedRegexes;
		},
		has: function (str1, str2) {
			if (typeof str1 === "string") {
				return str2.toLowerCase().indexOf(str1.toLowerCase()) !== -1;
			} else {
				return false;
			}
		},
		lowerize: function (str) {
			return str.toLowerCase();
		},
		major: function (version) {
			return typeof (version) === STR_TYPE ? version.replace(/[^\d\.]/g, '').split(".")[0] : undefined;
		},
		trim: function (str) {
			return str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
		}
	};
	var mapper = {

		rgx: function (ua, arrays) {

			//var result = {},
			var i = 0, j, k, p, q, matches, match;//, args = arguments;

			/*// construct object barebones
			for (p = 0; p < args[1].length; p++) {
				q = args[1][p];
				result[typeof q === OBJ_TYPE ? q[0] : q] = undefined;
			}*/

			// loop through all regexes maps
			while (i < arrays.length && !matches) {

				var regex = arrays[i],       // even sequence (0,2,4,..)
					props = arrays[i + 1];   // odd sequence (1,3,5,..)
				j = k = 0;

				// try matching uastring with regexes
				while (j < regex.length && !matches) {

					matches = regex[j++].exec(ua);

					if (!!matches) {
						for (p = 0; p < props.length; p++) {
							match = matches[++k];
							q = props[p];
							// check if given property is actually array
							if (typeof q === OBJ_TYPE && q.length > 0) {
								if (q.length == 2) {
									if (typeof q[1] == FUNC_TYPE) {
										// assign modified match
										this[q[0]] = q[1].call(this, match);
									} else {
										// assign given value, ignore regex match
										this[q[0]] = q[1];
									}
								} else if (q.length == 3) {
									// check whether function or regex
									if (typeof q[1] === FUNC_TYPE && !(q[1].exec && q[1].test)) {
										// call function (usually string mapper)
										this[q[0]] = match ? q[1].call(this, match, q[2]) : undefined;
									} else {
										// sanitize match using given regex
										this[q[0]] = match ? match.replace(q[1], q[2]) : undefined;
									}
								} else if (q.length == 4) {
									this[q[0]] = match ? q[3].call(this, match.replace(q[1], q[2])) : undefined;
								}
							} else {
								this[q] = match ? match : undefined;
							}
						}
					}
				}
				i += 2;
			}
			// console.log(this);
			//return this;
		},

		str: function (str, map) {

			for (var i in map) {
				// check if array
				if (typeof map[i] === OBJ_TYPE && map[i].length > 0) {
					for (var j = 0; j < map[i].length; j++) {
						if (util.has(map[i][j], str)) {
							return (i === UNKNOWN) ? undefined : i;
						}
					}
				} else if (util.has(map[i], str)) {
					return (i === UNKNOWN) ? undefined : i;
				}
			}
			return str;
		}
	};
	var maps = {

		browser: {
			oldsafari: {
				version: {
					'1.0': '/8',
					'1.2': '/1',
					'1.3': '/3',
					'2.0': '/412',
					'2.0.2': '/416',
					'2.0.3': '/417',
					'2.0.4': '/419',
					'?': '/'
				}
			}
		},

		device: {
			amazon: {
				model: {
					'Fire Phone': ['SD', 'KF']
				}
			},
			sprint: {
				model: {
					'Evo Shift 4G': '7373KT'
				},
				vendor: {
					'HTC': 'APA',
					'Sprint': 'Sprint'
				}
			}
		},

		os: {
			windows: {
				version: {
					'ME': '4.90',
					'NT 3.11': 'NT3.51',
					'NT 4.0': 'NT4.0',
					'2000': 'NT 5.0',
					'XP': ['NT 5.1', 'NT 5.2'],
					'Vista': 'NT 6.0',
					'7': 'NT 6.1',
					'8': 'NT 6.2',
					'8.1': 'NT 6.3',
					'10': ['NT 6.4', 'NT 10.0'],
					'RT': 'ARM'
				}
			}
		}
	};
	var regexes = {

		browser: [[

			// Presto based
			/(opera\smini)\/([\w\.-]+)/i,                                       // Opera Mini
			/(opera\s[mobiletab]+).+version\/([\w\.-]+)/i,                      // Opera Mobi/Tablet
			/(opera).+version\/([\w\.]+)/i,                                     // Opera > 9.80
			/(opera)[\/\s]+([\w\.]+)/i                                          // Opera < 9.80
		], [NAME, VERSION], [

			/(opios)[\/\s]+([\w\.]+)/i                                          // Opera mini on iphone >= 8.0
		], [[NAME, 'Opera Mini'], VERSION], [

			/\s(opr)\/([\w\.]+)/i                                               // Opera Webkit
		], [[NAME, 'Opera'], VERSION], [

			// Mixed
			/(kindle)\/([\w\.]+)/i,                                             // Kindle
			/(lunascape|maxthon|netfront|jasmine|blazer)[\/\s]?([\w\.]*)/i,
			// Lunascape/Maxthon/Netfront/Jasmine/Blazer

			// Trident based
			/(avant\s|iemobile|slim|baidu)(?:browser)?[\/\s]?([\w\.]*)/i,
			// Avant/IEMobile/SlimBrowser/Baidu
			/(?:ms|\()(ie)\s([\w\.]+)/i,                                        // Internet Explorer

			// Webkit/KHTML based
			/(rekonq)\/([\w\.]*)/i,                                             // Rekonq
			/(chromium|flock|rockmelt|midori|epiphany|silk|skyfire|ovibrowser|bolt|iron|vivaldi|iridium|phantomjs|bowser|quark|qupzilla|falkon)\/([\w\.-]+)/i
			// Chromium/Flock/RockMelt/Midori/Epiphany/Silk/Skyfire/Bolt/Iron/Iridium/PhantomJS/Bowser/QupZilla/Falkon
		], [NAME, VERSION], [

			/(konqueror)\/([\w\.]+)/i                                           // Konqueror
		], [[NAME, 'Konqueror'], VERSION], [

			/(trident).+rv[:\s]([\w\.]+).+like\sgecko/i                         // IE11
		], [[NAME, 'IE'], VERSION], [

			/(edge|edgios|edga)\/((\d+)?[\w\.]+)/i                              // Microsoft Edge
		], [[NAME, 'Edge'], VERSION], [

			/(yabrowser)\/([\w\.]+)/i                                           // Yandex
		], [[NAME, 'Yandex'], VERSION], [

			/(puffin)\/([\w\.]+)/i                                              // Puffin
		], [[NAME, 'Puffin'], VERSION], [

			/(focus)\/([\w\.]+)/i                                               // Firefox Focus
		], [[NAME, 'Firefox Focus'], VERSION], [

			/(opt)\/([\w\.]+)/i                                                 // Opera Touch
		], [[NAME, 'Opera Touch'], VERSION], [

			/((?:[\s\/])uc?\s?browser|(?:juc.+)ucweb)[\/\s]?([\w\.]+)/i         // UCBrowser
		], [[NAME, 'UCBrowser'], VERSION], [

			/(comodo_dragon)\/([\w\.]+)/i                                       // Comodo Dragon
		], [[NAME, /_/g, ' '], VERSION], [

			/(micromessenger)\/([\w\.]+)/i                                      // WeChat
		], [[NAME, 'WeChat'], VERSION], [

			/(brave)\/([\w\.]+)/i                                              // Brave browser
		], [[NAME, 'Brave'], VERSION], [

			/(qqbrowserlite)\/([\w\.]+)/i                                       // QQBrowserLite
		], [NAME, VERSION], [

			/(QQ)\/([\d\.]+)/i                                                  // QQ, aka ShouQ
		], [NAME, VERSION], [

			/m?(qqbrowser)[\/\s]?([\w\.]+)/i                                    // QQBrowser
		], [NAME, VERSION], [

			/(BIDUBrowser)[\/\s]?([\w\.]+)/i                                    // Baidu Browser
		], [NAME, VERSION], [

			/(2345Explorer)[\/\s]?([\w\.]+)/i                                   // 2345 Browser
		], [NAME, VERSION], [

			/(MetaSr)[\/\s]?([\w\.]+)/i                                         // SouGouBrowser
		], [NAME], [

			/(LBBROWSER)/i                                      // LieBao Browser
		], [NAME], [

			/xiaomi\/miuibrowser\/([\w\.]+)/i                                   // MIUI Browser
		], [VERSION, [NAME, 'MIUI Browser']], [

			/;fbav\/([\w\.]+);/i                                                // Facebook App for iOS & Android
		], [VERSION, [NAME, 'Facebook']], [

			/safari\s(line)\/([\w\.]+)/i,                                       // Line App for iOS
			/android.+(line)\/([\w\.]+)\/iab/i                                  // Line App for Android
		], [NAME, VERSION], [

			/headlesschrome(?:\/([\w\.]+)|\s)/i                                 // Chrome Headless
		], [VERSION, [NAME, 'Chrome Headless']], [

			/\swv\).+(chrome)\/([\w\.]+)/i                                      // Chrome WebView
		], [[NAME, /(.+)/, '$1 WebView'], VERSION], [

			/((?:oculus|samsung)browser)\/([\w\.]+)/i
		], [[NAME, /(.+(?:g|us))(.+)/, '$1 $2'], VERSION], [                // Oculus / Samsung Browser

			/android.+version\/([\w\.]+)\s+(?:mobile\s?safari|safari)*/i        // Android Browser
		], [VERSION, [NAME, 'Android Browser']], [

			/(chrome|omniweb|arora|[tizenoka]{5}\s?browser)\/v?([\w\.]+)/i
			// Chrome/OmniWeb/Arora/Tizen/Nokia
		], [NAME, VERSION], [

			/(dolfin)\/([\w\.]+)/i                                              // Dolphin
		], [[NAME, 'Dolphin'], VERSION], [

			/((?:android.+)crmo|crios)\/([\w\.]+)/i                             // Chrome for Android/iOS
		], [[NAME, 'Chrome'], VERSION], [

			/(coast)\/([\w\.]+)/i                                               // Opera Coast
		], [[NAME, 'Opera Coast'], VERSION], [

			/fxios\/([\w\.-]+)/i                                                // Firefox for iOS
		], [VERSION, [NAME, 'Firefox']], [

			/version\/([\w\.]+).+?mobile\/\w+\s(safari)/i                       // Mobile Safari
		], [VERSION, [NAME, 'Mobile Safari']], [

			/version\/([\w\.]+).+?(mobile\s?safari|safari)/i                    // Safari & Safari Mobile
		], [VERSION, NAME], [

			/webkit.+?(gsa)\/([\w\.]+).+?(mobile\s?safari|safari)(\/[\w\.]+)/i  // Google Search Appliance on iOS
		], [[NAME, 'GSA'], VERSION], [

			/webkit.+?(mobile\s?safari|safari)(\/[\w\.]+)/i                     // Safari < 3.0
		], [NAME, [VERSION, mapper.str, maps.browser.oldsafari.version]], [

			/(webkit|khtml)\/([\w\.]+)/i
		], [NAME, VERSION], [

			// Gecko based
			/(navigator|netscape)\/([\w\.-]+)/i                                 // Netscape
		], [[NAME, 'Netscape'], VERSION], [
			/(swiftfox)/i,                                                      // Swiftfox
			/(icedragon|iceweasel|camino|chimera|fennec|maemo\sbrowser|minimo|conkeror)[\/\s]?([\w\.\+]+)/i,
			// IceDragon/Iceweasel/Camino/Chimera/Fennec/Maemo/Minimo/Conkeror
			/(firefox|seamonkey|k-meleon|icecat|iceape|firebird|phoenix|palemoon|basilisk|waterfox)\/([\w\.-]+)$/i,

			// Firefox/SeaMonkey/K-Meleon/IceCat/IceApe/Firebird/Phoenix
			/(mozilla)\/([\w\.]+).+rv\:.+gecko\/\d+/i,                          // Mozilla

			// Other
			/(polaris|lynx|dillo|icab|doris|amaya|w3m|netsurf|sleipnir)[\/\s]?([\w\.]+)/i,
			// Polaris/Lynx/Dillo/iCab/Doris/Amaya/w3m/NetSurf/Sleipnir
			/(links)\s\(([\w\.]+)/i,                                            // Links
			/(gobrowser)\/?([\w\.]*)/i,                                         // GoBrowser
			/(ice\s?browser)\/v?([\w\._]+)/i,                                   // ICE Browser
			/(mosaic)[\/\s]([\w\.]+)/i                                          // Mosaic
		], [NAME, VERSION]
		],

		cpu: [[

			/(?:(amd|x(?:(?:86|64)[_-])?|wow|win)64)[;\)]/i                     // AMD64
		], [[ARCHITECTURE, 'amd64']], [

			/(ia32(?=;))/i                                                      // IA32 (quicktime)
		], [[ARCHITECTURE, util.lowerize]], [

			/((?:i[346]|x)86)[;\)]/i                                            // IA32
		], [[ARCHITECTURE, 'ia32']], [

			// PocketPC mistakenly identified as PowerPC
			/windows\s(ce|mobile);\sppc;/i
		], [[ARCHITECTURE, 'arm']], [

			/((?:ppc|powerpc)(?:64)?)(?:\smac|;|\))/i                           // PowerPC
		], [[ARCHITECTURE, /ower/, '', util.lowerize]], [

			/(sun4\w)[;\)]/i                                                    // SPARC
		], [[ARCHITECTURE, 'sparc']], [

			/((?:avr32|ia64(?=;))|68k(?=\))|arm(?:64|(?=v\d+[;l]))|(?=atmel\s)avr|(?:irix|mips|sparc)(?:64)?(?=;)|pa-risc)/i
			// IA64, 68K, ARM/64, AVR/32, IRIX/64, MIPS/64, SPARC/64, PA-RISC
		], [[ARCHITECTURE, util.lowerize]]
		],

		device: [[

			/\((ipad|playbook);[\w\s\),;-]+(rim|apple)/i                        // iPad/PlayBook
		], [MODEL, VENDOR, [TYPE, TABLET]], [

			/applecoremedia\/[\w\.]+ \((ipad)/                                  // iPad
		], [MODEL, [VENDOR, 'Apple'], [TYPE, TABLET]], [

			/(apple\s{0,1}tv)/i                                                 // Apple TV
		], [[MODEL, 'Apple TV'], [VENDOR, 'Apple']], [

			/(archos)\s(gamepad2?)/i,                                           // Archos
			/(hp).+(touchpad)/i,                                                // HP TouchPad
			/(hp).+(tablet)/i,                                                  // HP Tablet
			/(kindle)\/([\w\.]+)/i,                                             // Kindle
			/\s(nook)[\w\s]+build\/(\w+)/i,                                     // Nook
			/(dell)\s(strea[kpr\s\d]*[\dko])/i                                  // Dell Streak
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/(kf[A-z]+)\sbuild\/.+silk\//i                                      // Kindle Fire HD
		], [MODEL, [VENDOR, 'Amazon'], [TYPE, TABLET]], [
			/(sd|kf)[0349hijorstuw]+\sbuild\/.+silk\//i                         // Fire Phone
		], [[MODEL, mapper.str, maps.device.amazon.model], [VENDOR, 'Amazon'], [TYPE, MOBILE]], [
			/android.+aft([bms])\sbuild/i                                       // Fire TV
		], [MODEL, [VENDOR, 'Amazon'], [TYPE, SMARTTV]], [

			/\((ip[honed|\s\w*]+);.+(apple)/i                                   // iPod/iPhone
		], [MODEL, VENDOR, [TYPE, MOBILE]], [
			/\((ip[honed|\s\w*]+);/i                                            // iPod/iPhone
		], [MODEL, [VENDOR, 'Apple'], [TYPE, MOBILE]], [

			/(blackberry)[\s-]?(\w+)/i,                                         // BlackBerry
			/(blackberry|benq|palm(?=\-)|sonyericsson|acer|asus|dell|meizu|motorola|polytron)[\s_-]?([\w-]*)/i,
			// BenQ/Palm/Sony-Ericsson/Acer/Asus/Dell/Meizu/Motorola/Polytron
			/(hp)\s([\w\s]+\w)/i,                                               // HP iPAQ
			/(asus)-?(\w+)/i                                                    // Asus
		], [VENDOR, MODEL, [TYPE, MOBILE]], [
			/\(bb10;\s(\w+)/i                                                   // BlackBerry 10
		], [MODEL, [VENDOR, 'BlackBerry'], [TYPE, MOBILE]], [
			// Asus Tablets
			/android.+(transfo[prime\s]{4,10}\s\w+|eeepc|slider\s\w+|nexus 7|padfone|p00c)/i
		], [MODEL, [VENDOR, 'Asus'], [TYPE, TABLET]], [

			/(sony)\s(tablet\s[ps])\sbuild\//i,                                  // Sony
			/(sony)?(?:sgp.+)\sbuild\//i
		], [[VENDOR, 'Sony'], [MODEL, 'Xperia Tablet'], [TYPE, TABLET]], [
			/android.+\s([c-g]\d{4}|so[-l]\w+)(?=\sbuild\/|\).+chrome\/(?![1-6]{0,1}\d\.))/i
		], [MODEL, [VENDOR, 'Sony'], [TYPE, MOBILE]], [

			/\s(ouya)\s/i,                                                      // Ouya
			/(nintendo)\s([wids3u]+)/i                                          // Nintendo
		], [VENDOR, MODEL, [TYPE, CONSOLE]], [

			/android.+;\s(shield)\sbuild/i                                      // Nvidia
		], [MODEL, [VENDOR, 'Nvidia'], [TYPE, CONSOLE]], [

			/(playstation\s[34portablevi]+)/i                                   // Playstation
		], [MODEL, [VENDOR, 'Sony'], [TYPE, CONSOLE]], [

			/(sprint\s(\w+))/i                                                  // Sprint Phones
		], [[VENDOR, mapper.str, maps.device.sprint.vendor], [MODEL, mapper.str, maps.device.sprint.model], [TYPE, MOBILE]], [

			/(lenovo)\s?(S(?:5000|6000)+(?:[-][\w+]))/i                         // Lenovo tablets
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/(htc)[;_\s-]+([\w\s]+(?=\)|\sbuild)|\w+)/i,                        // HTC
			/(zte)-(\w*)/i,                                                     // ZTE
			/(alcatel|geeksphone|lenovo|nexian|panasonic|(?=;\s)sony)[_\s-]?([\w-]*)/i
			// Alcatel/GeeksPhone/Lenovo/Nexian/Panasonic/Sony
		], [VENDOR, [MODEL, /_/g, ' '], [TYPE, MOBILE]], [

			/(nexus\s9)/i                                                       // HTC Nexus 9
		], [MODEL, [VENDOR, 'HTC'], [TYPE, TABLET]], [

			/d\/huawei([\w\s-]+)[;\)]/i,
			/(nexus\s6p)/i                                                      // Huawei
		], [MODEL, [VENDOR, 'Huawei'], [TYPE, MOBILE]], [

			/(microsoft);\s(lumia[\s\w]+)/i                                     // Microsoft Lumia
		], [VENDOR, MODEL, [TYPE, MOBILE]], [

			/[\s\(;](xbox(?:\sone)?)[\s\);]/i                                   // Microsoft Xbox
		], [MODEL, [VENDOR, 'Microsoft'], [TYPE, CONSOLE]], [
			/(kin\.[onetw]{3})/i                                                // Microsoft Kin
		], [[MODEL, /\./g, ' '], [VENDOR, 'Microsoft'], [TYPE, MOBILE]], [

			// Motorola
			/\s(milestone|droid(?:[2-4x]|\s(?:bionic|x2|pro|razr))?:?(\s4g)?)[\w\s]+build\//i,
			/mot[\s-]?(\w*)/i,
			/(XT\d{3,4}) build\//i,
			/(nexus\s6)/i
		], [MODEL, [VENDOR, 'Motorola'], [TYPE, MOBILE]], [
			/android.+\s(mz60\d|xoom[\s2]{0,2})\sbuild\//i
		], [MODEL, [VENDOR, 'Motorola'], [TYPE, TABLET]], [

			/hbbtv\/\d+\.\d+\.\d+\s+\([\w\s]*;\s*(\w[^;]*);([^;]*)/i            // HbbTV devices
		], [[VENDOR, util.trim], [MODEL, util.trim], [TYPE, SMARTTV]], [

			/hbbtv.+maple;(\d+)/i
		], [[MODEL, /^/, 'SmartTV'], [VENDOR, 'Samsung'], [TYPE, SMARTTV]], [

			/\(dtv[\);].+(aquos)/i                                              // Sharp
		], [MODEL, [VENDOR, 'Sharp'], [TYPE, SMARTTV]], [

			/android.+((sch-i[89]0\d|shw-m380s|gt-p\d{4}|gt-n\d+|sgh-t8[56]9|nexus 10))/i,
			/((SM-T\w+))/i
		], [[VENDOR, 'Samsung'], MODEL, [TYPE, TABLET]], [                  // Samsung
			/smart-tv.+(samsung)/i
		], [VENDOR, [TYPE, SMARTTV], MODEL], [
			/((s[cgp]h-\w+|gt-\w+|galaxy\snexus|sm-\w[\w\d]+))/i,
			/(sam[sung]*)[\s-]*(\w+-?[\w-]*)/i,
			/sec-((sgh\w+))/i
		], [[VENDOR, 'Samsung'], MODEL, [TYPE, MOBILE]], [

			/sie-(\w*)/i                                                        // Siemens
		], [MODEL, [VENDOR, 'Siemens'], [TYPE, MOBILE]], [

			/(maemo|nokia).*(n900|lumia\s\d+)/i,                                // Nokia
			/(nokia)[\s_-]?([\w-]*)/i
		], [[VENDOR, 'Nokia'], MODEL, [TYPE, MOBILE]], [

			/android[x\d\.\s;]+\s([ab][1-7]\-?[0178a]\d\d?)/i                   // Acer
		], [MODEL, [VENDOR, 'Acer'], [TYPE, TABLET]], [

			/android.+([vl]k\-?\d{3})\s+build/i                                 // LG Tablet
		], [MODEL, [VENDOR, 'LG'], [TYPE, TABLET]], [
			/android\s3\.[\s\w;-]{10}(lg?)-([06cv9]{3,4})/i                     // LG Tablet
		], [[VENDOR, 'LG'], MODEL, [TYPE, TABLET]], [
			/(lg) netcast\.tv/i                                                 // LG SmartTV
		], [VENDOR, MODEL, [TYPE, SMARTTV]], [
			/(nexus\s[45])/i,                                                   // LG
			/lg[e;\s\/-]+(\w*)/i,
			/android.+lg(\-?[\d\w]+)\s+build/i
		], [MODEL, [VENDOR, 'LG'], [TYPE, MOBILE]], [

			/android.+(ideatab[a-z0-9\-\s]+)/i                                  // Lenovo
		], [MODEL, [VENDOR, 'Lenovo'], [TYPE, TABLET]], [

			/linux;.+((jolla));/i                                               // Jolla
		], [VENDOR, MODEL, [TYPE, MOBILE]], [

			/((pebble))app\/[\d\.]+\s/i                                         // Pebble
		], [VENDOR, MODEL, [TYPE, WEARABLE]], [

			/android.+;\s(oppo)\s?([\w\s]+)\sbuild/i                            // OPPO
		], [VENDOR, MODEL, [TYPE, MOBILE]], [

			/crkey/i                                                            // Google Chromecast
		], [[MODEL, 'Chromecast'], [VENDOR, 'Google']], [

			/android.+;\s(glass)\s\d/i                                          // Google Glass
		], [MODEL, [VENDOR, 'Google'], [TYPE, WEARABLE]], [

			/android.+;\s(pixel c)[\s)]/i                                       // Google Pixel C
		], [MODEL, [VENDOR, 'Google'], [TYPE, TABLET]], [

			/android.+;\s(pixel( [23])?( xl)?)\s/i                              // Google Pixel
		], [MODEL, [VENDOR, 'Google'], [TYPE, MOBILE]], [

			/android.+;\s(\w+)\s+build\/hm\1/i,                                 // Xiaomi Hongmi 'numeric' models
			/android.+(hm[\s\-_]*note?[\s_]*(?:\d\w)?)\s+build/i,               // Xiaomi Hongmi
			/android.+(mi[\s\-_]*(?:one|one[\s_]plus|note lte)?[\s_]*(?:\d?\w?)[\s_]*(?:plus)?)\s+build/i,    // Xiaomi Mi
			/android.+(redmi[\s\-_]*(?:note)?(?:[\s_]*[\w\s]+))\s+build/i       // Redmi Phones
		], [[MODEL, /_/g, ' '], [VENDOR, 'Xiaomi'], [TYPE, MOBILE]], [
			/android.+(mi[\s\-_]*(?:pad)(?:[\s_]*[\w\s]+))\s+build/i            // Mi Pad tablets
		], [[MODEL, /_/g, ' '], [VENDOR, 'Xiaomi'], [TYPE, TABLET]], [
			/android.+;\s(m[1-5]\snote)\sbuild/i                                // Meizu Tablet
		], [MODEL, [VENDOR, 'Meizu'], [TYPE, TABLET]], [
			/(mz)-([\w-]{2,})/i                                                 // Meizu Phone
		], [[VENDOR, 'Meizu'], MODEL, [TYPE, MOBILE]], [

			/android.+a000(1)\s+build/i,                                        // OnePlus
			/android.+oneplus\s(a\d{4})\s+build/i
		], [MODEL, [VENDOR, 'OnePlus'], [TYPE, MOBILE]], [

			/android.+[;\/]\s*(RCT[\d\w]+)\s+build/i                            // RCA Tablets
		], [MODEL, [VENDOR, 'RCA'], [TYPE, TABLET]], [

			/android.+[;\/\s]+(Venue[\d\s]{2,7})\s+build/i                      // Dell Venue Tablets
		], [MODEL, [VENDOR, 'Dell'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(Q[T|M][\d\w]+)\s+build/i                         // Verizon Tablet
		], [MODEL, [VENDOR, 'Verizon'], [TYPE, TABLET]], [

			/android.+[;\/]\s+(Barnes[&\s]+Noble\s+|BN[RT])(V?.*)\s+build/i     // Barnes & Noble Tablet
		], [[VENDOR, 'Barnes & Noble'], MODEL, [TYPE, TABLET]], [

			/android.+[;\/]\s+(TM\d{3}.*\b)\s+build/i                           // Barnes & Noble Tablet
		], [MODEL, [VENDOR, 'NuVision'], [TYPE, TABLET]], [

			/android.+;\s(k88)\sbuild/i                                         // ZTE K Series Tablet
		], [MODEL, [VENDOR, 'ZTE'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(gen\d{3})\s+build.*49h/i                         // Swiss GEN Mobile
		], [MODEL, [VENDOR, 'Swiss'], [TYPE, MOBILE]], [

			/android.+[;\/]\s*(zur\d{3})\s+build/i                              // Swiss ZUR Tablet
		], [MODEL, [VENDOR, 'Swiss'], [TYPE, TABLET]], [

			/android.+[;\/]\s*((Zeki)?TB.*\b)\s+build/i                         // Zeki Tablets
		], [MODEL, [VENDOR, 'Zeki'], [TYPE, TABLET]], [

			/(android).+[;\/]\s+([YR]\d{2})\s+build/i,
			/android.+[;\/]\s+(Dragon[\-\s]+Touch\s+|DT)(\w{5})\sbuild/i        // Dragon Touch Tablet
		], [[VENDOR, 'Dragon Touch'], MODEL, [TYPE, TABLET]], [

			/android.+[;\/]\s*(NS-?\w{0,9})\sbuild/i                            // Insignia Tablets
		], [MODEL, [VENDOR, 'Insignia'], [TYPE, TABLET]], [

			/android.+[;\/]\s*((NX|Next)-?\w{0,9})\s+build/i                    // NextBook Tablets
		], [MODEL, [VENDOR, 'NextBook'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(Xtreme\_)?(V(1[045]|2[015]|30|40|60|7[05]|90))\s+build/i
		], [[VENDOR, 'Voice'], MODEL, [TYPE, MOBILE]], [                    // Voice Xtreme Phones

			/android.+[;\/]\s*(LVTEL\-)?(V1[12])\s+build/i                     // LvTel Phones
		], [[VENDOR, 'LvTel'], MODEL, [TYPE, MOBILE]], [

			/android.+;\s(PH-1)\s/i
		], [MODEL, [VENDOR, 'Essential'], [TYPE, MOBILE]], [                // Essential PH-1

			/android.+[;\/]\s*(V(100MD|700NA|7011|917G).*\b)\s+build/i          // Envizen Tablets
		], [MODEL, [VENDOR, 'Envizen'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(Le[\s\-]+Pan)[\s\-]+(\w{1,9})\s+build/i          // Le Pan Tablets
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/android.+[;\/]\s*(Trio[\s\-]*.*)\s+build/i                         // MachSpeed Tablets
		], [MODEL, [VENDOR, 'MachSpeed'], [TYPE, TABLET]], [

			/android.+[;\/]\s*(Trinity)[\-\s]*(T\d{3})\s+build/i                // Trinity Tablets
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/android.+[;\/]\s*TU_(1491)\s+build/i                               // Rotor Tablets
		], [MODEL, [VENDOR, 'Rotor'], [TYPE, TABLET]], [

			/android.+(KS(.+))\s+build/i                                        // Amazon Kindle Tablets
		], [MODEL, [VENDOR, 'Amazon'], [TYPE, TABLET]], [

			/android.+(Gigaset)[\s\-]+(Q\w{1,9})\s+build/i                      // Gigaset Tablets
		], [VENDOR, MODEL, [TYPE, TABLET]], [

			/\s(tablet|tab)[;\/]/i,                                             // Unidentifiable Tablet
			/\s(mobile)(?:[;\/]|\ssafari)/i                                     // Unidentifiable Mobile
		], [[TYPE, util.lowerize], VENDOR, MODEL], [

			/[\s\/\(](smart-?tv)[;\)]/i                                         // SmartTV
		], [[TYPE, SMARTTV]], [

			/(android[\w\.\s\-]{0,9});.+build/i                                 // Generic Android Device
		], [MODEL, [VENDOR, 'Generic']]
		],

		engine: [[

			/windows.+\sedge\/([\w\.]+)/i                                       // EdgeHTML
		], [VERSION, [NAME, 'EdgeHTML']], [

			/webkit\/537\.36.+chrome\/(?!27)/i                                  // Blink
		], [[NAME, 'Blink']], [

			/(presto)\/([\w\.]+)/i,                                             // Presto
			/(webkit|trident|netfront|netsurf|amaya|lynx|w3m|goanna)\/([\w\.]+)/i,
			// WebKit/Trident/NetFront/NetSurf/Amaya/Lynx/w3m/Goanna
			/(khtml|tasman|links)[\/\s]\(?([\w\.]+)/i,                          // KHTML/Tasman/Links
			/(icab)[\/\s]([23]\.[\d\.]+)/i                                      // iCab
		], [NAME, VERSION], [

			/rv\:([\w\.]{1,9}).+(gecko)/i                                       // Gecko
		], [VERSION, NAME]
		],

		os: [[

			// Windows based
			/microsoft\s(windows)\s(vista|xp)/i                                 // Windows (iTunes)
		], [NAME, VERSION], [
			/(windows)\snt\s6\.2;\s(arm)/i,                                     // Windows RT
			/(windows\sphone(?:\sos)*)[\s\/]?([\d\.\s\w]*)/i,                   // Windows Phone
			/(windows\smobile|windows)[\s\/]?([ntce\d\.\s]+\w)/i
		], [NAME, [VERSION, mapper.str, maps.os.windows.version]], [
			/(win(?=3|9|n)|win\s9x\s)([nt\d\.]+)/i
		], [[NAME, 'Windows'], [VERSION, mapper.str, maps.os.windows.version]], [

			// Mobile/Embedded OS
			/\((bb)(10);/i                                                      // BlackBerry 10
		], [[NAME, 'BlackBerry'], VERSION], [
			/(blackberry)\w*\/?([\w\.]*)/i,                                     // Blackberry
			/(tizen)[\/\s]([\w\.]+)/i,                                          // Tizen
			/(android|webos|palm\sos|qnx|bada|rim\stablet\sos|meego|contiki)[\/\s-]?([\w\.]*)/i,
			// Android/WebOS/Palm/QNX/Bada/RIM/MeeGo/Contiki
			/linux;.+(sailfish);/i                                              // Sailfish OS
		], [NAME, VERSION], [
			/(symbian\s?os|symbos|s60(?=;))[\/\s-]?([\w\.]*)/i                  // Symbian
		], [[NAME, 'Symbian'], VERSION], [
			/\((series40);/i                                                    // Series 40
		], [NAME], [
			/mozilla.+\(mobile;.+gecko.+firefox/i                               // Firefox OS
		], [[NAME, 'Firefox OS'], VERSION], [

			// Console
			/(nintendo|playstation)\s([wids34portablevu]+)/i,                   // Nintendo/Playstation

			// GNU/Linux based
			/(mint)[\/\s\(]?(\w*)/i,                                            // Mint
			/(mageia|vectorlinux)[;\s]/i,                                       // Mageia/VectorLinux
			/(joli|[kxln]?ubuntu|debian|suse|opensuse|gentoo|(?=\s)arch|slackware|fedora|mandriva|centos|pclinuxos|redhat|zenwalk|linpus)[\/\s-]?(?!chrom)([\w\.-]*)/i,
			// Joli/Ubuntu/Debian/SUSE/Gentoo/Arch/Slackware
			// Fedora/Mandriva/CentOS/PCLinuxOS/RedHat/Zenwalk/Linpus
			/(hurd|linux)\s?([\w\.]*)/i,                                        // Hurd/Linux
			/(gnu)\s?([\w\.]*)/i                                                // GNU
		], [NAME, VERSION], [

			/(cros)\s[\w]+\s([\w\.]+\w)/i                                       // Chromium OS
		], [[NAME, 'Chromium OS'], VERSION], [

			// Solaris
			/(sunos)\s?([\w\.\d]*)/i                                            // Solaris
		], [[NAME, 'Solaris'], VERSION], [

			// BSD based
			/\s([frentopc-]{0,4}bsd|dragonfly)\s?([\w\.]*)/i                    // FreeBSD/NetBSD/OpenBSD/PC-BSD/DragonFly
		], [NAME, VERSION], [

			/(haiku)\s(\w+)/i                                                   // Haiku
		], [NAME, VERSION], [

			/cfnetwork\/.+darwin/i,
			/ip[honead]{2,4}(?:.*os\s([\w]+)\slike\smac|;\sopera)/i             // iOS
		], [[VERSION, /_/g, '.'], [NAME, 'iOS']], [

			/(mac\sos\sx)\s?([\w\s\.]*)/i,
			/(macintosh|mac(?=_powerpc)\s)/i                                    // Mac OS
		], [[NAME, 'Mac OS'], [VERSION, /_/g, '.']], [

			// Other
			/((?:open)?solaris)[\/\s-]?([\w\.]*)/i,                             // Solaris
			/(aix)\s((\d)(?=\.|\)|\s)[\w\.])*/i,                                // AIX
			/(plan\s9|minix|beos|os\/2|amigaos|morphos|risc\sos|openvms|fuchsia)/i,
			// Plan9/Minix/BeOS/OS2/AmigaOS/MorphOS/RISCOS/OpenVMS/Fuchsia
			/(unix)\s?([\w\.]*)/i                                               // UNIX
		], [NAME, VERSION]
		]
	};

	var UAParser = function (uastring, extensions) {

		if (typeof uastring === 'object') {
			extensions = uastring;
			uastring = undefined;
		}

		if (!(this instanceof UAParser)) {
			return new UAParser(uastring, extensions).getResult();
		}

		var ua = uastring || ((window && window.navigator && window.navigator.userAgent) ? window.navigator.userAgent : EMPTY);
		var rgxmap = extensions ? util.extend(regexes, extensions) : regexes;

		this.getBrowser = function () {
			var browser = { name: undefined, version: undefined };
			mapper.rgx.call(browser, ua, rgxmap.browser);
			browser.major = util.major(browser.version); // deprecated
			return browser;
		};
		this.getCPU = function () {
			var cpu = { architecture: undefined };
			mapper.rgx.call(cpu, ua, rgxmap.cpu);
			return cpu;
		};
		this.getDevice = function () {
			var device = { vendor: undefined, model: undefined, type: undefined };
			mapper.rgx.call(device, ua, rgxmap.device);
			return device;
		};
		this.getEngine = function () {
			var engine = { name: undefined, version: undefined };
			mapper.rgx.call(engine, ua, rgxmap.engine);
			return engine;
		};
		this.getOS = function () {
			var os = { name: undefined, version: undefined };
			mapper.rgx.call(os, ua, rgxmap.os);
			return os;
		};
		this.getResult = function () {
			return {
				ua: this.getUA(),
				browser: this.getBrowser(),
				engine: this.getEngine(),
				os: this.getOS(),
				device: this.getDevice(),
				cpu: this.getCPU()
			};
		};
		this.getUA = function () {
			return ua;
		};
		this.setUA = function (uastring) {
			ua = uastring;
			return this;
		};
		return this;
	};

	UAParser.VERSION = LIBVERSION;
	UAParser.BROWSER = {
		NAME: NAME,
		MAJOR: MAJOR, // deprecated
		VERSION: VERSION
	};
	UAParser.CPU = {
		ARCHITECTURE: ARCHITECTURE
	};
	UAParser.DEVICE = {
		MODEL: MODEL,
		VENDOR: VENDOR,
		TYPE: TYPE,
		CONSOLE: CONSOLE,
		MOBILE: MOBILE,
		SMARTTV: SMARTTV,
		TABLET: TABLET,
		WEARABLE: WEARABLE,
		EMBEDDED: EMBEDDED
	};
	UAParser.ENGINE = {
		NAME: NAME,
		VERSION: VERSION
	};
	UAParser.OS = {
		NAME: NAME,
		VERSION: VERSION
	};
	if (!window.UAParser) {
		window.UAParser = UAParser;
	}

}(window));
/**
 * v 1.0.0
 * 前端性能监控工具，引用Boomerang
 * 向外暴露一个plugs数组以及一个init方法
 * plugs数组用来表示可以进行配置的参数
 * 
 * init方法用来初始化监控的可配置参数
 * 可选参数包括：
 *      Errors, Memory, Mobile, Resourcetiming, Spa
 * 使用方法：
 *      Errors: 如果只是开启Errors监控，不需要进行任何配置时，使用Errors: 'enable'；
 *              如果需要进行配置时，使用： 	Errors: {
 *                                          monitorGlobal: true,  //监控全局错误
 *                                          monitorNetwork: true,  //监控网络错误
 *                                          monitorConsole: true,  //监控console的错误
 *                                          monitorEvents: true,  //监控事件错误
 *                                          monitorTimeout: true,  //监控setTimout 和 setInterval错误
 *                                          sendAfterOnload: true,  //开启页面加载完成之后发送错误信息
 *                                          sendInterval: true,  //如果sendAfterOnload为true时，收集所有错误后进行发送
 *                                          maxErrors: 10,  //监控页面最大错误数，默认10
 *                                      }
 *      Momory: 如果开启Memory监控时，配置Errors: 'enable'即可，不需要进行Memory监控时，不进行配置
 *      Mobile：如果开启Mobile监控时，配置Mobile: 'enable'即可，不需要进行Mobile监控时，不进行配置
 *      Resourcetiming： 开启时使用Resourcetiming: 'enable'；
 *      Spa：   如果页面为单页应用时，配置Spa: 'enable'即可，不是单页应用不进行配置            
 */
(function (w) {
	var _TRUE = true,
		_FALSE = false,
		_ENABLE = 'enable',
		_P_URL = 'UpUrl',
		_P_AUTOXHR = 'AutoXHR',
		_P_ERRORS = 'Errors',
		_P_HISTORY = 'History',
		_P_MEMORY = 'Memory',
		_P_MOBILE = 'Mobile',
		_P_NAVIGATIONTIMING = 'NavigationTiming',
		_P_RESOURCETIMING = 'ResourceTiming',
		_P_RT = 'RT',
		_P_SPA = 'SPA',
		_P_USERID = 'UserId',
		_P_USERNAME = 'UserName',
        _P_SERVICENAME = 'ServiceName';
	/**
     * 约定用户可以根据自己的情况进行自选配置的插件
     * 其中AutoXHR可以通过excludes字段进行过滤配置，Errors通过对象进行配置
     * Errors接收的是对象
     * AutoXHR的excludes字段接收的是url数组
     * 其他不可以进行过滤配置，只是进行是否打开配置
	 * 使用示例：
	 * 
	 *  INSIGHT.init({
            AutoXHR: {
                instrument_xhr: true,
                alwaysSendXhr: function(urls){
                    console.log(urls, urls.indexOf('.html') , urls.indexOf('operationMonitor/addTimeMonitor'))
                    if (urls.indexOf('.html') > -1 || urls.indexOf('operationMonitor/addTimeMonitor') > -1) {
                        return false;
                    }
                    return true;
                },
                monitorFetch: true,
                captureXhrRequestResponse: true
            },
            SPA: 'enable',
            // Errors: {
            //     monitorConsole: true,
            //     monitorGlobal: true,
            //     monitorNetwork: true,
            //     monitorEvents: true,
            //     monitorTimeout: true,
            //     sendAfterOnload: true,
            //     sendInterval: true
            // },
            History: {
                enable: true,
                auto: true
            },
            // Memory: 'enable',
            // Mobile: 'enable',
            // NavigationTiming: 'enable',
            // ResourceTiming: 'enable',
            // RT: 'enable',
            UserId: function () {
                return 'admin';
            },
            UserName: function (){
                return '爆锤张大大';
            },
            SystemName: function(){
                return 'tyyy_pc';
            }
        });
     */
	var _plugs = [
		'UpUrl',
		'AutoXHR',
		'Errors',
		'History',
		'Memory',
		'Mobile',
		'NavigationTiming',
		'ResourceTiming',
		'RT',
		'SPA',
		'UserId',
		'UserName',
		'ServiceName'
	];

	var _p_addArr = {
		uid: 'UserId',
		uname: 'UserName',
		sn: 'ServiceName'
	}


	var _p_boomerang_plugin = Object.assign(BOOMR.plugins, {});
	var _boomerang_plugin = {};
    /**
     * 配置初始化，只初始化上报数据的地址以及Boomerang的debug日志不进行输出
     */
	var base_config = {
		beacon_type: "POST",
		log: false
	};

	function initEnd(config, del_plugs) {
		var o = {};
		for (var k in config) {
			if (k == 'Spa') {
				o['History'] = {
					auto: true,
					enabled: true
				}
			} else {
				o[k] = config[k];
			}
		}
		Object.keys(_p_boomerang_plugin).forEach(function (key) {
			if (del_plugs.indexOf(key) == -1) {
				_boomerang_plugin[key] = _p_boomerang_plugin[key];
			}
		})
		if (o.hasOwnProperty(_P_AUTOXHR) && o[_P_AUTOXHR].enable === true) {
			if (!_boomerang_plugin.hasOwnProperty(_P_RT)) {
				_boomerang_plugin = Object.assign(_boomerang_plugin, { RT: _p_boomerang_plugin[_P_RT] });
			}
		}
		BOOMR.window.BOOMR.plugins = Object.assign({}, _boomerang_plugin);
		BOOMR.window.BOOMR.subscribe('xhr_send', function (req) {
			if (config[_P_USERID]) {
				req.setRequestHeader('P-User-Id', config[_P_USERID]());
			}
            req.setRequestHeader('P-Request-Id', BOOMR.rid);
            req.setRequestHeader('P-Page-Id', BOOMR.window.BOOMR.pageId);
		});
		BOOMR.window.BOOMR.init(o);
		var ua = new UAParser(w.navigator.userAgent);
		BOOMR.window.BOOMR.addVar('o.n', ua.getOS().name)
			.addVar('o.v', ua.getOS().version)
			.addVar('b.n', ua.getBrowser().name)
			.addVar('b.v', ua.getBrowser().version)
			.addVar('b.m', ua.getBrowser().major);
		for (var k in _p_addArr) {
			BOOMR.window.BOOMR.addVar(k, config[_p_addArr[k]]())
		}			
	}

	function _openPlugs(p, c, config) {
		var _pConfig = {};
		switch (p) {
			case _P_URL:
				_pConfig['beacon_url'] = c;
				break;
			case _P_AUTOXHR:
				_pConfig['instrument_xhr'] = _TRUE;
				_pConfig['autorun'] = _TRUE;
				_pConfig[_P_AUTOXHR] = {
					enable: _TRUE,
					alwaysSendXhr: c['alwaysSendXhr'] || _FALSE,
					monitorFetch: c['monitorFetch'] || _FALSE,
					captureXhrRequestResponse: c['captureXhrRequestResponse'] || _FALSE
				};
				break;
			case _P_ERRORS:
				var fn = c['onError'] || _FALSE;
				_pConfig[_P_ERRORS] = {
					onError: fn ? fn : function () { return true },
					monitorGlobal: c['monitorGlobal'] || _FALSE,
					monitorNetwork: c['monitorNetwork'] || _FALSE,
					monitorConsole: c['monitorConsole'] || _FALSE,
					monitorEvents: c['monitorEvents'] || _FALSE,
					monitorTimeout: c['monitorTimeout'] || _FALSE,
					sendAfterOnload: c['sendAfterOnload'] || _FALSE,
					sendInterval: c['sendInterval'] || _FALSE,
					maxErrors: c['maxErrors'] || 50
				};
				break;
			case _P_HISTORY:
				_pConfig[_P_HISTORY] = {
					enabled: true,
					auto: c['auto'] || false
				};
				break;
			case _P_MEMORY:
				break;
			case _P_MOBILE:
				break;
			case _P_NAVIGATIONTIMING:
				break;
			case _P_RESOURCETIMING:
				_pConfig[_P_RESOURCETIMING] = {
					trimUrls: c['trimUrls'] || []
				};
				break;
			// rt未进行实现
			case _P_RT:
				break;
			case _P_SPA:
				_pConfig = {
					instrument_xhr: true,
					autorun: true,
					SPA: 'enable'
				};
				break;
				case _P_USERID:
				_pConfig[_P_USERID] = c;
				break;
			case _P_USERNAME:
				_pConfig[_P_USERNAME] = c;
				break;
			case _P_SERVICENAME:
				_pConfig[_P_SERVICENAME] = c;
				break;
			default:
				break;
		}
		return _pConfig;
	}

	function _parseConfig(c, p) {
		base_config = Object.assign(_openPlugs(p, c), base_config);
	}

	var INSIGHT = {
		plugs: _plugs,
        /**
         * 初始化用户配置
         * @param {用户配置} config 
         * 通过遍历提供的插件与用户配置进行匹配判断
         * 如果是对象的化，判断是否是AutoXHR,Errors
         */
		init: function (config) {
			var del_plugs = [];
			var _user_config = Object.assign({}, config);
			for (var i = 0, ilth = _plugs.length; i < ilth; i++) {
				var _plug = _plugs[i];
				var _config = _user_config[_plug];
				// 先判断支持的插件中是否包含用户配置的插件
				if (_plug === 'UpUrl') {
					_parseConfig(_config, _plug, config);
				} else if (_config !== undefined) {
					// 判断用户配置的插件的值是对象还是字符串
					if (Object.prototype.toString.call(_config) === '[object Object]' && _config != {}) {
						// 如果是对象的话，解析对象中的值
						if (_config[_ENABLE] !== false || _config[_ENABLE] !== undefined) {
							_parseConfig(_config, _plug, config);
						} else {
							// 插件关闭，不进行配置
							del_plugs.push(_plug);
						}
					} else if (Object.prototype.toString.call(_config) === '[object String]') {
						// 如果是字符串的话，将插件的默认配置添加至配置中
						if (_config === _ENABLE) {
							_parseConfig(_config, _plug, config);
						} else {
							del_plugs.push(_plug);
						}
					} else if (Object.prototype.toString.call(_config) === '[object Function]') {
						if (_plug === _P_USERID || _plug === _P_SERVICENAME || _plug === _P_USERNAME) {
							_parseConfig(_config, _plug, config);
						}
					}
				} else {
					del_plugs.push(_plug);
				}
				delete _user_config[_plug];
			}
			// if (Object.prototype.toString.call(_user_config) === '[object Object]' && _user_config != {}) {
			// 	if (_user_config['xhr_excludes'] !== undefined) {
			// 		base_config = Object.assign(base_config, { xhr_excludes: _user_config['xhr_excludes'] });
			// 	}
			// }
			initEnd(base_config, del_plugs);
		}
	};

	if (!w.INSIGHT) {
		w.INSIGHT = INSIGHT;
	}

	function pIsListAndNoNull(list) {
		if (!isArrayFn(list)) {
			return false;
		}
		if (!list.length && list.length < 1) {
			return false;
		}
		return true;
	}

	function isArrayFn(value) {
		if (typeof Array.isArray === "function") {
			return Array.isArray(value);
		} else {
			return Object.prototype.toString.call(value) === "[object Array]";
		}
	}
}(window));