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