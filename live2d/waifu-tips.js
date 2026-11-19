/*
 * Tachika Live2D Widget Controller (Rice)
 * - WebGL2 预检：不支持时静默销毁 #waifu，绝不触发 live2d-sdk.js 清空 document.body
 * - sessionStorage['tachika:waifu-state'] 折叠态管理：跨页延后初始化防 0x0 死画布，同页 opacity/visibility 保活
 * - 精简 4 枚圆钮工具栏（一言 / 互动动作 / 拍照 / 收起），自动过滤单模型无效按钮
 * - 修复拖拽（addEventListener + 锁定 left/top/width 清空 right/bottom）、首页路径识别、closest 文本提取与优先级数值比较
 * - 监听 tachika:seasonchange 以优先级 12 播报四季专属台词
 */
(function () {
	'use strict';

	var STATE_KEY = 'tachika:waifu-state';
	var PRIORITY_KEY = 'waifu-text';
	var DEFAULT_SEASON_LINES = {
		spring: '樱花开了呢～换上<span>春季</span>的模样，一起看书吧。',
		summer: '进入<span>夏日</span>竹影了，记得多喝水避暑哦。',
		autumn: '满院丹枫与银杏～<span>秋天</span>最适合慢慢读文章了。',
		winter: '下雪啦～换上<span>冬日</span>雪景，注意保暖哦。'
	};

	var messageTimer = null;
	var tipsData = null;
	var homePathConfig = '/';
	var widgetMounted = false;
	var listenersBound = false;
	var collapsed = false;

	function pickRandom(val) {
		return Array.isArray(val) ? val[Math.floor(Math.random() * val.length)] : val;
	}

	function escapeHtml(str) {
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function readSession(key) {
		try {
			return window.sessionStorage.getItem(key);
		} catch (e) {
			return null;
		}
	}

	function writeSession(key, val) {
		try {
			window.sessionStorage.setItem(key, String(val));
		} catch (e) {
			/* 忽略 */
		}
	}

	function removeSession(key) {
		try {
			window.sessionStorage.removeItem(key);
		} catch (e) {
			/* 忽略 */
		}
	}

	function hasWebGL2Support() {
		try {
			var probe = document.createElement('canvas');
			var gl = probe.getContext('webgl2');
			return !!gl;
		} catch (e) {
			return false;
		}
	}

	function saveBlob(blob) {
		if (!blob) return;
		var link = document.createElement('a');
		var url = window.URL.createObjectURL(blob);
		link.href = url;
		link.download = 'live2d-rice.png';
		link.click();
		window.setTimeout(function () {
			window.URL.revokeObjectURL(url);
		}, 1000);
	}

	function showMessage(text, timeout, priority) {
		if (!text || collapsed) return;
		var stored = readSession(PRIORITY_KEY);
		var curPri = stored !== null ? Number(stored) : -Infinity;
		var nextPri = Number(priority || 0);
		if (!isNaN(curPri) && curPri > nextPri) {
			return;
		}
		var box = document.getElementById('waifu-tips');
		if (!box) return;

		if (messageTimer) {
			window.clearTimeout(messageTimer);
			messageTimer = null;
		}
		var picked = pickRandom(text);
		if (!picked) return;

		writeSession(PRIORITY_KEY, nextPri);
		box.innerHTML = picked;
		box.classList.add('waifu-tips-active');
		messageTimer = window.setTimeout(function () {
			removeSession(PRIORITY_KEY);
			box.classList.remove('waifu-tips-active');
			messageTimer = null;
		}, timeout || 4000);
	}

	function ModelManager(config) {
		this.cdnPath = config.cdnPath;
		this.isOrderSwitch = config.switchType === 'order';
		this.modelList = null;
	}

	ModelManager.prototype.loadModelList = async function () {
		if (this.modelList) return this.modelList;
		var res = await fetch(this.cdnPath + 'model_list.json');
		this.modelList = await res.json();
		return this.modelList;
	};

	ModelManager.prototype.loadModel = async function (modelId, texturesId, message) {
		try {
			localStorage.setItem('modelId', modelId);
			localStorage.setItem('modelTexturesId', texturesId);
		} catch (e) {
			/* 忽略 */
		}
		await this.loadModelList();
		if (message) {
			showMessage(message, 4000, 10);
		}
		var models = this.modelList && this.modelList.models;
		if (!models || !models.length) return;
		var row = models[modelId];
		var target = row && row[texturesId];
		if (target === undefined) {
			if (parseInt(modelId, 10) === 0 && parseInt(texturesId, 10) === 0) return;
			var fallbackMsg = this.modelList.messages && this.modelList.messages[0] && this.modelList.messages[0][0];
			await this.loadModel(0, 0, fallbackMsg);
			return;
		}
		window.live2d.loadModel(this.cdnPath + 'model/' + target + '/');
	};

	ModelManager.prototype.switchTextures = async function () {
		var modelId = parseInt(localStorage.getItem('modelId') || '0', 10) || 0;
		var texId = parseInt(localStorage.getItem('modelTexturesId') || '0', 10) || 0;
		await this.loadModelList();
		var count = (this.modelList.models[modelId] || []).length;
		if (count <= 1) return;
		if (this.isOrderSwitch) {
			texId = (texId + 1) % count;
		} else {
			var randIdx;
			do {
				randIdx = Math.floor(Math.random() * count);
			} while (randIdx === texId);
			texId = randIdx;
		}
		this.loadModel(modelId, texId, this.modelList.messages[modelId][texId]);
	};

	ModelManager.prototype.switchModel = async function () {
		var modelId = parseInt(localStorage.getItem('modelId') || '0', 10) || 0;
		await this.loadModelList();
		var count = this.modelList.models.length;
		if (count <= 1) return;
		var nextId = (modelId + 1) % count;
		this.loadModel(nextId, 0, this.modelList.messages[nextId][0]);
	};

	/* ---------------- 精简线性图标 ---------------- */

	var ICONS = {
		hitokoto:
			'<svg viewBox="0 0 24 24" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M21 11.5a8.38 8.38 0 0 1 -.9 3.8a8.5 8.5 0 0 1 -7.6 4.7a8.38 8.38 0 0 1 -3.8 -.9L3 21l1.9 -5.7a8.38 8.38 0 0 1 -.9 -3.8a8.5 8.5 0 0 1 4.7 -7.6a8.38 8.38 0 0 1 3.8 -.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
			'</svg>',
		express:
			'<svg viewBox="0 0 24 24" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9 -4.6L5.5 9.5l4.6 -1.9z"/>' +
			'<path d="M19 15l.9 2.1L22 18l-2.1 .9L19 21l-.9 -2.1L16 18l2.1 -.9z"/>' +
			'</svg>',
		photo:
			'<svg viewBox="0 0 24 24" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M23 19a2 2 0 0 1 -2 2H3a2 2 0 0 1 -2 -2V8a2 2 0 0 1 2 -2h4l2 -3h6l2 3h4a2 2 0 0 1 2 2z"/>' +
			'<circle cx="12" cy="13" r="4"/>' +
			'</svg>',
		quit:
			'<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
			'<polyline points="6 9 12 15 18 9"/>' +
			'</svg>',
		toggle:
			'<svg viewBox="0 0 24 24" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M12 3l1.8 4.4L18.2 9.2l-4.4 1.8L12 15.4l-1.8 -4.4L5.8 9.2l4.4 -1.8z"/>' +
			'<path d="M5 19h14"/>' +
			'</svg>'
	};

	function fetchHitokoto() {
		fetch('https://v1.hitokoto.cn')
			.then(function (r) {
				if (!r.ok) throw new Error('hitokoto ' + r.status);
				return r.json();
			})
			.then(function (res) {
				if (!res || !res.hitokoto) throw new Error('empty');
				var from = escapeHtml(res.from || '一言');
				var creator = escapeHtml(res.creator || '匿名');
				showMessage(escapeHtml(res.hitokoto), 6000, 9);
				window.setTimeout(function () {
					showMessage('这句一言来自 <span>「' + from + '」</span>，由 <span>' + creator + '</span> 分享。', 4000, 9);
				}, 6000);
			})
			.catch(function () {
				var fallback = (tipsData && tipsData.message && tipsData.message.default) || '今天也要元气满满地阅读呀～';
				showMessage(fallback, 4500, 9);
			});
	}

	function triggerRandomInteraction() {
		try {
			if (window.live2d && typeof window.live2d.randomExpression === 'function') {
				window.live2d.randomExpression();
			}
		} catch (e) {
			/* 单模型无表情时忽略 */
		}
		// 触发 Rice 的 TapBody 随机动作（桌面端 live2d-sdk.js 监听 canvas mouseup）
		var canvas = document.getElementById('live2d');
		if (canvas && !('ontouchend' in canvas)) {
			try {
				var rect = canvas.getBoundingClientRect();
				canvas.dispatchEvent(new MouseEvent('mouseup', {
					bubbles: false,
					cancelable: true,
					clientX: rect.left + rect.width * 0.5,
					clientY: rect.top + rect.height * 0.5
				}));
			} catch (e) {
				/* 忽略 */
			}
		}
		var expressLines = (tipsData && tipsData.message && tipsData.message.express) ||
			['翻一页书，换个好心情～', '诶嘿，你看我这招怎么样？', '读累了就歇一会儿吧，我陪着你呢。'];
		showMessage(expressLines, 4200, 10);
	}

	/* ---------------- 首页识别与欢迎词 ---------------- */

	function isHomePage() {
		var p = (window.location.pathname || '/').replace(/index\.html$/i, '');
		if (p === '' || p === '/' || p === '/iepl.github.io' || p === '/iepl.github.io/') {
			return true;
		}
		if (homePathConfig) {
			var normHome = homePathConfig.replace(/index\.html$/i, '');
			if (p === normHome || p === normHome + '/') {
				return true;
			}
		}
		return false;
	}

	function buildWelcomeMessage() {
		if (!tipsData) return '';
		if (isHomePage() && Array.isArray(tipsData.time)) {
			var nowHour = new Date().getHours();
			for (var i = 0; i < tipsData.time.length; i++) {
				var entry = tipsData.time[i];
				var parts = String(entry.hour).split('-');
				var startH = Number(parts[0]);
				var endH = parts.length > 1 ? Number(parts[1]) : startH;
				if (nowHour >= startH && nowHour <= endH) {
					return entry.text;
				}
			}
		}
		var pageTitle = escapeHtml((document.title || '').split(' - ')[0] || '这里');
		var base = '欢迎阅读<span>「' + pageTitle + '」</span>';
		if (document.referrer) {
			try {
				var refUrl = new URL(document.referrer);
				if (refUrl.hostname && refUrl.hostname !== window.location.hostname) {
					var domain = refUrl.hostname.split('.')[1];
					var known = { baidu: '百度', so: '360搜索', google: '谷歌搜索', bing: '必应' };
					var source = escapeHtml(known[domain] || refUrl.hostname);
					return '你好呀！来自 <span>' + source + '</span> 的朋友<br>' + base;
				}
			} catch (e) {
				/* 非法 referrer 忽略 */
			}
		}
		return base;
	}

	/* ---------------- 折叠 / 展开（同页保活画布 + 跨页延后挂载） ---------------- */

	function setCollapsedState(nextCollapsed, skipMessage) {
		collapsed = !!nextCollapsed;
		writeSession(STATE_KEY, collapsed ? 'collapsed' : 'open');
		document.body.classList.toggle('waifu-collapsed', collapsed);

		var waifu = document.getElementById('waifu');
		var toggle = document.getElementById('waifu-toggle');
		if (waifu) {
			waifu.classList.toggle('waifu-hidden', collapsed);
		}
		if (toggle) {
			toggle.classList.toggle('waifu-toggle-active', collapsed);
		}
		if (!collapsed && !skipMessage) {
			var backLines = (tipsData && tipsData.message && tipsData.message.welcomeBack) || '我回来啦～继续陪你逛博客吧！';
			showMessage(backLines, 4200, 11);
		}
	}

	/* ---------------- 拖拽修复（addEventListener + 锁定 left/top/width） ---------------- */

	function bindDrag(config) {
		if (config.dragEnable === false) return;
		var waifu = document.getElementById('waifu');
		var canvas = document.getElementById('live2d');
		if (!waifu || !canvas) return;

		var allowAll = !Array.isArray(config.dragDirection) || config.dragDirection.length === 0;
		var allowX = allowAll || config.dragDirection.indexOf('x') >= 0;
		var allowY = allowAll || config.dragDirection.indexOf('y') >= 0;

		var dragging = false;
		var moved = false;
		var startX = 0;
		var startY = 0;
		var originLeft = 0;
		var originTop = 0;
		var boxWidth = 0;
		var boxHeight = 0;

		canvas.addEventListener('mousedown', function (ev) {
			if (ev.button !== 0) return;
			if (ev.target && ev.target.closest && ev.target.closest('#waifu-tool')) return;
			var rect = waifu.getBoundingClientRect();
			dragging = true;
			moved = false;
			startX = ev.clientX;
			startY = ev.clientY;
			originLeft = rect.left;
			originTop = rect.top;
			boxWidth = rect.width || canvas.clientWidth || 300;
			boxHeight = rect.height || canvas.clientHeight || 300;
		});

		window.addEventListener('mousemove', function (ev) {
			if (!dragging) return;
			var dx = ev.clientX - startX;
			var dy = ev.clientY - startY;
			if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) {
				return;
			}
			if (!moved) {
				moved = true;
				waifu.classList.add('waifu-dragging');
				waifu.style.left = originLeft + 'px';
				waifu.style.top = originTop + 'px';
				waifu.style.width = boxWidth + 'px';
				waifu.style.right = 'auto';
				waifu.style.bottom = 'auto';
			}
			if (allowX) {
				var maxLeft = Math.max(0, window.innerWidth - boxWidth);
				var nextLeft = Math.min(maxLeft, Math.max(0, originLeft + dx));
				waifu.style.left = nextLeft + 'px';
			}
			if (allowY) {
				var maxTop = Math.max(0, window.innerHeight - boxHeight + 10);
				var nextTop = Math.min(maxTop, Math.max(20, originTop + dy));
				waifu.style.top = nextTop + 'px';
			}
		});

		window.addEventListener('mouseup', function () {
			if (!dragging) return;
			dragging = false;
			if (moved) {
				waifu.classList.remove('waifu-dragging');
				moved = false;
			}
		});
	}

	/* ---------------- 交互监听（悬浮 / 点击 / 四季切换 / 节气节日） ---------------- */

	function bindTipsEvents(data) {
		tipsData = data;
		if (listenersBound) {
			showMessage(buildWelcomeMessage(), 6500, 11);
			return;
		}
		listenersBound = true;

		var userAction = false;
		var idleTimer = null;
		var idleLines = (data.message && Array.isArray(data.message.default)) ? data.message.default.slice() : [];

		window.addEventListener('mousemove', function () { userAction = true; }, { passive: true });
		window.addEventListener('keydown', function () { userAction = true; }, { passive: true });

		window.setInterval(function () {
			if (collapsed) return;
			if (userAction) {
				userAction = false;
				if (idleTimer) {
					window.clearInterval(idleTimer);
					idleTimer = null;
				}
			} else if (!idleTimer && idleLines.length) {
				idleTimer = window.setInterval(function () {
					if (!collapsed) {
						showMessage(idleLines, 6000, 9);
					}
				}, 22000);
			}
		}, 1000);

		// 节日彩蛋（数值比较月/日，避免字符串比较 Bug）
		if (Array.isArray(data.seasons)) {
			var now = new Date();
			var curMonth = now.getMonth() + 1;
			var curDay = now.getDate();
			data.seasons.forEach(function (item) {
				var range = String(item.date || '').split('-');
				var start = range[0].split('/');
				var end = (range[1] || range[0]).split('/');
				var sM = Number(start[0]);
				var sD = Number(start[1]);
				var eM = Number(end[0]);
				var eD = Number(end[1]);
				var afterStart = curMonth > sM || (curMonth === sM && curDay >= sD);
				var beforeEnd = curMonth < eM || (curMonth === eM && curDay <= eD);
				if (afterStart && beforeEnd) {
					var line = pickRandom(item.text);
					if (line) {
						idleLines.push(line.replace('{year}', String(now.getFullYear())));
					}
				}
			});
		}

		// 防抖悬停提示（使用 closest(selector)?.textContent?.trim() 避免 SVG 吐 undefined）
		var lastHoverEl = null;
		window.addEventListener('mouseover', function (ev) {
			if (collapsed || !ev.target || !ev.target.closest || !Array.isArray(data.mouseover)) return;
			for (var i = 0; i < data.mouseover.length; i++) {
				var rule = data.mouseover[i];
				var match = ev.target.closest(rule.selector);
				if (match) {
					if (match === lastHoverEl) return;
					lastHoverEl = match;
					var rawText = (match.textContent || '').replace(/\s+/g, ' ').trim();
					var msg = pickRandom(rule.text);
					if (msg) {
						msg = msg.replace(/\{text\}/g, escapeHtml(rawText || '这里'));
						showMessage(msg, 4000, 8);
					}
					return;
				}
			}
			lastHoverEl = null;
		}, { passive: true });

		window.addEventListener('click', function (ev) {
			if (collapsed || !ev.target || !ev.target.closest || !Array.isArray(data.click)) return;
			for (var i = 0; i < data.click.length; i++) {
				var rule = data.click[i];
				var match = ev.target.closest(rule.selector);
				if (match) {
					var rawText = (match.textContent || '').replace(/\s+/g, ' ').trim();
					var msg = pickRandom(rule.text);
					if (msg) {
						msg = msg.replace(/\{text\}/g, escapeHtml(rawText || '这里'));
						showMessage(msg, 4000, 8);
					}
					return;
				}
			}
		});

		window.addEventListener('copy', function () {
			if (data.message && data.message.copy) {
				showMessage(data.message.copy, 5500, 9);
			}
		});

		window.addEventListener('visibilitychange', function () {
			if (!document.hidden && data.message && data.message.visibilitychange) {
				showMessage(data.message.visibilitychange, 5500, 9);
			}
		});

		// 监听四季切换事件，以最高优先级 12 播报春夏秋冬专属台词
		window.addEventListener('tachika:seasonchange', function (ev) {
			var season = ev && ev.detail && ev.detail.season;
			if (!season) return;
			var pool = (data.seasonChange && data.seasonChange[season]) || DEFAULT_SEASON_LINES[season];
			if (pool) {
				showMessage(pool, 5500, 12);
			}
		});

		showMessage(buildWelcomeMessage(), 6500, 11);
	}

	/* ---------------- 挂载看板娘主体 ---------------- */

	function mountWaifu(config) {
		if (widgetMounted) {
			setCollapsedState(false, false);
			return;
		}
		// 严格先探测 WebGL2，不支持则静默退出，绝不让 live2d-sdk.js 清空页面
		if (!hasWebGL2Support() || !window.live2d || typeof window.live2d.init !== 'function') {
			var existing = document.getElementById('waifu');
			if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
			var toggle = document.getElementById('waifu-toggle');
			if (toggle && toggle.parentNode) toggle.parentNode.removeChild(toggle);
			document.body.classList.remove('waifu-collapsed');
			document.body.classList.add('no-waifu');
			return;
		}

		widgetMounted = true;
		collapsed = false;
		try {
			localStorage.removeItem('waifu-display');
		} catch (e) {
			/* 忽略 */
		}
		removeSession(PRIORITY_KEY);

		document.body.insertAdjacentHTML(
			'beforeend',
			'<div id="waifu" class="waifu-entering">' +
				'<div id="waifu-tips" role="status" aria-live="polite"></div>' +
				'<canvas id="live2d" width="800" height="800"></canvas>' +
				'<div id="waifu-tool"></div>' +
			'</div>'
		);

		window.requestAnimationFrame(function () {
			var w = document.getElementById('waifu');
			if (w) w.classList.remove('waifu-entering');
		});

		var modelManager = new ModelManager(config);
		var toolBar = document.getElementById('waifu-tool');

		var toolDefs = {
			hitokoto: {
				icon: ICONS.hitokoto,
				label: '听一句一言',
				callback: fetchHitokoto
			},
			express: {
				icon: ICONS.express,
				label: '互动一下',
				callback: triggerRandomInteraction
			},
			photo: {
				icon: ICONS.photo,
				label: '合影留念',
				callback: async function () {
					showMessage('照好了嘛，是不是很可爱呢？', 5000, 10);
					try {
						if (window.live2d && typeof window.live2d.getCanvasBlob === 'function') {
							saveBlob(await window.live2d.getCanvasBlob());
						}
					} catch (e) {
						/* 忽略 */
					}
				}
			},
			quit: {
				icon: ICONS.quit,
				label: '收起看板娘',
				callback: function () {
					showMessage('先去书桌边歇一会儿，点右下角胶囊随时叫我哦～', 1200, 12);
					window.setTimeout(function () {
						setCollapsedState(true, true);
					}, 850);
				}
			}
		};

		// 固定呈现精简 4 枚优雅圆钮，并自动过滤单模型无效的 switch-model / switch-texture
		var activeTools = ['hitokoto', 'express', 'photo', 'quit'];
		activeTools.forEach(function (name) {
			var def = toolDefs[name];
			if (!def || !toolBar) return;
			var btn = document.createElement('button');
			btn.type = 'button';
			btn.id = 'waifu-tool-' + name;
			btn.className = 'waifu-tool-btn';
			btn.setAttribute('aria-label', def.label);
			btn.setAttribute('title', def.label);
			btn.innerHTML = def.icon;
			btn.addEventListener('click', function (ev) {
				ev.stopPropagation();
				def.callback();
			});
			toolBar.appendChild(btn);
		});

		// 初始化 Live2D 模型
		var modelId = localStorage.getItem('modelId');
		var texId = localStorage.getItem('modelTexturesId');
		if (modelId === null) {
			modelId = 0;
			texId = 0;
		}
		Promise.resolve()
			.then(function () {
				window.live2d.init(config.cdnPath + 'model/');
			})
			.then(function () {
				return modelManager.loadModel(modelId, texId);
			})
			.catch(function () {
				/* 静默容错 */
			});

		fetch(config.waifuPath)
			.then(function (r) { return r.json(); })
			.then(bindTipsEvents)
			.catch(function () {
				/* JSON 加载失败不影响模型渲染 */
			});

		bindDrag(config);
	}

	/* ---------------- 全局入口 initWidget / showWelcomeMessage ---------------- */

	function initWidget(config, apiPath) {
		if (typeof config === 'string') {
			config = { waifuPath: config, apiPath: apiPath };
		}
		config = config || {};
		homePathConfig = config.homePath || '/';

		try {
			localStorage.removeItem('waifu-display');
		} catch (e) {
			/* 忽略 */
		}

		// 若无 WebGL2 支持，直接静默退出并不挂载胶囊与画布
		if (!hasWebGL2Support() || !window.live2d || typeof window.live2d.init !== 'function') {
			document.body.classList.add('no-waifu');
			return;
		}

		var toggle = document.getElementById('waifu-toggle');
		if (!toggle) {
			toggle = document.createElement('button');
			toggle.type = 'button';
			toggle.id = 'waifu-toggle';
			toggle.setAttribute('aria-label', '展开看板娘 Rice');
			toggle.setAttribute('title', '召唤看板娘 Rice');
			toggle.innerHTML = ICONS.toggle + '<span>Rice</span>';
			document.body.appendChild(toggle);
		}

		toggle.addEventListener('click', function () {
			if (!widgetMounted) {
				writeSession(STATE_KEY, 'open');
				document.body.classList.remove('waifu-collapsed');
				toggle.classList.remove('waifu-toggle-active');
				mountWaifu(config);
			} else {
				setCollapsedState(false, false);
			}
		});

		// 跨页若本会话处于 collapsed，只展示迷你胶囊并延后初始化（防 0x0 死画布）
		if (readSession(STATE_KEY) === 'collapsed') {
			collapsed = true;
			document.body.classList.add('waifu-collapsed');
			toggle.classList.add('waifu-toggle-active');
			return;
		}

		mountWaifu(config);
	}

	function showWelcomeMessage() {
		showMessage(buildWelcomeMessage(), 6500, 11);
	}

	window.initWidget = initWidget;
	window.showWelcomeMessage = showWelcomeMessage;
}());
