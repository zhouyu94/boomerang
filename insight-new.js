(function (w) {
	// this is commons
	var _p_commons = {
		TRUE: true,
		FALSE: false,
		ENABLE: "enable",
		UPURL: "UpUrl",
		AUTOXHR: {
			name: "AutoXHR",
			alwaysSendXhr: "alwaysSendXhr",
			monitorFetch: "monitorFetch",
			captureXhrRequestResponse: "captureXhrRequestResponse"
		},
		ERRORS: {
			name: "Errors",
			onError: "onError",
			monitorGlobal: "monitorGlobal",
			monitorNetwork: "monitorNetwork",
			monitorConsole: "monitorConsole",
			monitorEvents: "monitorEvents",
			monitorTimeout: "monitorTimeout",
			sendAfterOnload: "sendAfterOnload",
			sendInterval: "sendInterval",
			maxErrors: "maxErrors",
			maxErrorsDefaultNum: 50

		},
		SPA: {name: "SPA"},
		HISTORY: { name: "History", auto: "auto" },
		RESOURCETIMING: {
			name: "ResourceTiming",
			trimUrls: "trimUrls",
			defaultTrimUrls: []
		},
		RT: "RT",
		USERID: "UserId",
		USERNAME: "UserName",
		SERVICENAME: "ServiceName",
		TOEXTEND: function toExtend(o,n){
			for (var p in n){
				if(n.hasOwnProperty(p) && (!o.hasOwnProperty(p) ))
					o[p]=n[p];
			}
			return o;
		},
		TOPLAINOBJECT: function (v) {
			var value = Object(v);
			var result = {};
			for (var key in value) {
				result[key] = value[key]
			}
			return result;
		}

	};
	// this is use to declare variable
	// _p_plugs: this is all allow config plugs
	// _p_addvars: this is allow add fields to BOOMERANG
	// _p_del_plugs: this is remove plugs from BOOMERANG
	// _p_enable_plugs: this is open plugs from BOOMERANG
	// _p_boomerang_plugs: this is all package BOOMERANG plugs
	var _p_plugs = [], _p_addvars = {}, _p_del_plugs = [], _p_enable_plugs = {},_p_boomerang_plugs;

	// base config, to init BOOMERANG
	var base_config = {
		beacon_type: "POST",
		log: false
	};

	// register config, add param to any plugs
	var _register = {
		UpUrl: function (c) {
			base_config = _p_commons.TOEXTEND({beacon_url: c}, base_config);
		},
		AutoXHR: function (c) {
			var _c = {
				instrument_xhr: _p_commons.TRUE,
				autorun: _p_commons.TRUE,
				AutoXHR: {
					enable: _p_commons.TRUE,
					alwaysSendXhr: c[_p_commons.AUTOXHR.alwaysSendXhr] || _p_commons.FALSE,
					monitorFetch: c[_p_commons.AUTOXHR.monitorFetch] || _p_commons.FALSE,
					captureXhrRequestResponse: c[_p_commons.AUTOXHR.captureXhrRequestResponse] || _p_commons.FALSE
				}
			};
			base_config = _p_commons.TOEXTEND(_c, base_config);
		},
		Errors: function (c) {
			var _c = {
				Errors: {
					onError: (c[_p_commons.ERRORS.onError] || _p_commons.FALSE) ? c[_p_commons.ERRORS.onError] : function () {return true},
					monitorGlobal: c[_p_commons.ERRORS.monitorGlobal] || _p_commons.FALSE,
					monitorNetwork: c[_p_commons.ERRORS.monitorNetwork] || _p_commons.FALSE,
					monitorConsole: c[_p_commons.ERRORS.monitorConsole] || _p_commons.FALSE,
					monitorEvents: c[_p_commons.ERRORS.monitorEvents] || _p_commons.FALSE,
					monitorTimeout: c[_p_commons.ERRORS.monitorTimeout] || _p_commons.FALSE,
					sendAfterOnload: c[_p_commons.ERRORS.sendAfterOnload] || _p_commons.FALSE,
					sendInterval: c[_p_commons.ERRORS.sendInterval] || _p_commons.FALSE,
					maxErrors: c[_p_commons.ERRORS.maxErrors] || _p_commons.ERRORS.maxErrorsDefaultNum
				}
			};
			base_config = _p_commons.TOEXTEND(_c, base_config);
		},
		History: function (c) {
			var _c = {
				instrument_xhr: true,
				autorun: true,
				History: {
					enabled: _p_commons.TRUE,
					auto: c[_p_commons.HISTORY.auto] || _p_commons.FALSE
				},
				Spa: _p_commons.ENABLE
			};
			base_config = _p_commons.TOEXTEND(_c, base_config);
		},
		ResourceTiming: function (c) {
			var _c = {
				ResourceTiming: {
					trimUrls: c[_p_commons.RESOURCETIMING.trimUrls] || _p_commons.RESOURCETIMING.defaultTrimUrls
				}
			};
			base_config = _p_commons.TOEXTEND(_c, base_config);
		},
		Spa: function (c) {
			var _c = {
				instrument_xhr: true,
				autorun: true,
				SPA: _p_commons.ENABLE,
				History: {
					auto: true,
					enabled: _p_commons.TRUE
				}
			};
			base_config = _p_commons.TOEXTEND(_c, base_config);
		},
		UserId: function (c) {
			base_config = _p_commons.TOEXTEND({UserId: c}, base_config);
		},
		UserName: function (c) {
			base_config = _p_commons.TOEXTEND({UserName: c}, base_config);
		},
		ServiceName: function (c) {
			base_config = _p_commons.TOEXTEND({ServiceName: c}, base_config);
		},
		StringConfig: function(f, c) {
			var _c = {};
			_c[f] = c;
			base_config = _p_commons.TOEXTEND(_c, base_config);
		}
	};

	// init BOOMERANG plugs
	var initPlugs = function () {
		if (_p_del_plugs.indexOf(_p_commons.SPA.name) > -1 || _p_del_plugs.indexOf(_p_commons.HISTORY.name) >-1) {
			_g.removeDelPlugs(_p_commons.SPA.name);
			_g.removeDelPlugs(_p_commons.HISTORY.name);
		}
		Object.keys(_p_boomerang_plugs).forEach(function (key) {
			if (_p_del_plugs.indexOf(key) === -1) {
				_p_enable_plugs[key] = _p_boomerang_plugs[key];
			}
		});
		if (_p_enable_plugs.hasOwnProperty(_p_commons.AUTOXHR) && _p_enable_plugs[_p_commons.AUTOXHR.name].enable === _p_commons.TRUE) {
			if (!_p_enable_plugs.hasOwnProperty(_p_commons.RT)) {
				_p_enable_plugs = _p_commons.TOEXTEND(_p_enable_plugs, {RT: _p_boomerang_plugs[_p_commons.RT]});
			}
		}
		BOOMR.window.BOOMR.plugins = _p_commons.TOPLAINOBJECT(_p_enable_plugs);
	};
	var addHeaders = function () {
		BOOMR.window.BOOMR.subscribe('xhr_send', function (req) {
			if (req && req.resource && req.resource.type === 'xhr') {
				if (base_config[_p_commons.USERID]) {
					req.setRequestHeader('P-User-Id', base_config[_p_commons.USERID]());
				}
				req.setRequestHeader('P-Request-Id', BOOMR.rid);
				req.setRequestHeader('P-Page-Id', BOOMR.window.BOOMR.pageId);
			} else if (req && req.resource && req.resource.type === 'fetch') {
				BOOMR['rid'] = BOOMR.utils.generateId(10);
				req.resource['rid'] = BOOMR.rid;
				var header = {'P-Request-Id': BOOMR.rid, 'P-Page-Id': BOOMR.window.BOOMR.pageId};
				if (base_config[_p_commons.USERID]) {
					header = _p_commons.TOEXTEND(header, {'P-User-Id': base_config[_p_commons.USERID]()});
				}
				req.resource.headers = header;
			}
		});
	};

	var addVars = function () {
		var ua = new UAParser(w.navigator.userAgent);
		BOOMR.window.BOOMR.addVar('o.n', ua.getOS().name)
			.addVar('o.v', ua.getOS().version)
			.addVar('b.n', ua.getBrowser().name)
			.addVar('b.v', ua.getBrowser().version)
			.addVar('b.m', ua.getBrowser().major);
		for (var k in _p_addvars) {
			BOOMR.window.BOOMR.addVar(k, base_config[_p_addvars[k]]())
		}
	};

	var _g = {
		checkConfig: function (f, c) {
			return c.hasOwnProperty(f);
		},
		doConfig: function (f, c) {
			var __config = c[f];
			if (__config !== {} && Object.prototype.toString.call(__config) === "[object Object]") {
				_g.objectConfig(f, __config);
			} else if (__config !== "" && Object.prototype.toString.call(__config) === "[object String]") {
				_g.stringConfig(f, __config);
			} else if (Object.prototype.toString.call(__config) === "[object Function]") {
				_g.functionConfig(f, __config)
			} else {
				_p_del_plugs.push(f);
			}
		},
		stringConfig: function(f, c) {
			if (c === _p_commons.ENABLE) {
				_register.StringConfig(f, c);
			} else if (f === _p_commons.UPURL){ 
				_register[f](c);
			} else {
				_p_del_plugs.push(f);
			}
		},
		objectConfig: function(f, c) {
			if (c[_p_commons.ENABLE] !== false || c[_p_commons.ENABLE] === undefined) {
				_register[f](c);
			} else {
				_p_del_plugs.push(f);
			}
		},
		functionConfig: function(f, c) {
			_register[f](c);
		},
		removeDelPlugs: function(f) {
			for(var i = 0, ilth = _p_del_plugs.length; i < ilth; i ++) {
				if (_p_del_plugs[i] === f) {
					_p_del_plugs.splice(i, 1);
					break;
				}
			}
		},
		init: function (c) {
			if (!_g.checkConfig(_p_commons.UPURL, c)) {
				log("not yet config UpUrl, plugin init unsuccessful");
				return;
			}
			if (!_g.checkConfig(_p_commons.SERVICENAME, c)) {
				log("not yet config ServiceName, plugin init unsuccessful");
				return;
			}
			for (var i = 0, ilth = _p_plugs.length; i < ilth; i++) {
				_g.doConfig(_p_plugs[i], c);
			}
			initPlugs();
			BOOMR.window.BOOMR.init(base_config);
			addHeaders();
			addVars();
		},
	};

	var INSIGHT = {
		plugs: _p_plugs,
		init: _g.init,
	};

	if (!w.INSIGHT) {
		w.INSIGHT = INSIGHT;
	}

	(function (w) {
		// if you want to add plugs, pls add plugs name to here
		_p_plugs = ['UpUrl', 'AutoXHR', 'Errors', 'History', 'Memory', 'Mobile', 'NavigationTiming',
			'ResourceTiming', 'RT', 'SPA', 'UserId', 'UserName', 'ServiceName'
		];
		// if you want to add request header of xhr, pls add filed to hear
		_p_addvars = {uid: 'UserId', uname: 'UserName', sn: 'ServiceName'};
		_p_boomerang_plugs = BOOMR.window.BOOMR.plugins;

	}(w));

}(window));
