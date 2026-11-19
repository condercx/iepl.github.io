/*
 * Tachika 全站主题与交互控制器
 * - 四季背景切换（保留 f865d5f 新层垫底 + 旧层淡出防闪白机制，智能转圈与邻季预载）
 * - 左栏底部双胶囊控制行：#season-toggle（四季）+ #scheme-toggle（明暗，绝不与 Stack 原生 #dark-mode-toggle 冲突）
 * - 跨标签 storage 同步 & 权威 matchMedia 复写（压过 ts/main.js 的旧监听器）
 * - 全局带进度环返回顶部 #site-backtop（清理旧 #backTopBtn）、文章阅读进度条 .reading-progress 与首屏以下渐显
 */
(function () {
	'use strict';

	var SEASONS = [
		{ key: 'spring', label: '春', fullLabel: '春季', img: 'spring.webp' },
		{ key: 'summer', label: '夏', fullLabel: '夏季', img: 'summer.webp' },
		{ key: 'autumn', label: '秋', fullLabel: '秋季', img: 'autumn.webp' },
		{ key: 'winter', label: '冬', fullLabel: '冬季', img: 'winter.webp' }
	];

	var SEASON_KEY = 'TachikaSeason';
	var SCHEME_KEY = 'StackColorScheme';
	var FADE_MS = 700;
	var SPIN_DELAY_MS = 120;
	var SWITCH_TRANSITION_MS = 450;

	// 通过 document.currentScript 自动推导站点根路径，同时兼容 /iepl.github.io/ 与本地 / 预览
	var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
	function resolveSiteBase() {
		if (SCRIPT_SRC) {
			try {
				var baseUrl = new URL('../', SCRIPT_SRC);
				var path = baseUrl.pathname || '/';
				return path.charAt(path.length - 1) === '/' ? path : path + '/';
			} catch (e) {
				/* 回退到 pathname 判定 */
			}
		}
		var locPath = window.location.pathname || '/';
		if (locPath === '/iepl.github.io' || locPath.indexOf('/iepl.github.io/') === 0) {
			return '/iepl.github.io/';
		}
		return '/';
	}

	var SITE_BASE = resolveSiteBase();
	var IMG_BASE = SITE_BASE + 'img/season/';

	var SEASON_ICONS = {
		spring:
			'<svg class="season-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0"/>' +
			'<path d="M12 3.5c2 0 3.2 1.8 2.4 3.8c1.9 -.6 4 .4 4.4 2.4c.4 2 -1 3.7 -3 3.7c1.2 1.6 .8 4 -1 5c-1.8 1 -3.8 .2 -4.8 -1.5c-1 1.7 -3 2.5 -4.8 1.5c-1.8 -1 -2.2 -3.4 -1 -5c-2 0 -3.4 -1.7 -3 -3.7c.4 -2 2.5 -3 4.4 -2.4c-.8 -2 .4 -3.8 2.4 -3.8z"/>' +
			'</svg>',
		summer:
			'<svg class="season-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
			'<circle cx="12" cy="12" r="4"/>' +
			'<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42"/>' +
			'</svg>',
		autumn:
			'<svg class="season-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M12 20v-7"/>' +
			'<path d="M12 4l2.2 4.3l4.3 -1.3l-1.6 4.2l3.1 2.3l-4.5 1.1l-.5 2.9l-3 -1.8l-3 1.8l-.5 -2.9l-4.5 -1.1l3.1 -2.3l-1.6 -4.2l4.3 1.3z"/>' +
			'</svg>',
		winter:
			'<svg class="season-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>' +
			'<path d="M10 5l2 2l2 -2M10 19l2 -2l2 2M5 10l2.5 -.6l-.7 -2.4M19 14l-2.5 .6l.7 2.4M19 10l-2.5 -.6l.7 -2.4M5 14l2.5 .6l-.7 2.4"/>' +
			'</svg>'
	};

	var SCHEME_ICONS = {
		light:
			'<svg class="scheme-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
			'<circle cx="12" cy="12" r="4"/>' +
			'<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42"/>' +
			'</svg>',
		dark:
			'<svg class="scheme-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/>' +
			'</svg>'
	};

	var darkMql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
	var reducedMotionMql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

	function seasonOf(key) {
		for (var i = 0; i < SEASONS.length; i++) {
			if (SEASONS[i].key === key) {
				return SEASONS[i];
			}
		}
		return null;
	}

	function seasonIndex(key) {
		for (var i = 0; i < SEASONS.length; i++) {
			if (SEASONS[i].key === key) {
				return i;
			}
		}
		return 0;
	}

	function readStorage(key) {
		try {
			return window.localStorage.getItem(key) || '';
		} catch (e) {
			return '';
		}
	}

	function writeStorage(key, val) {
		try {
			window.localStorage.setItem(key, val);
		} catch (e) {
			/* 隐私模式忽略 */
		}
	}

	function seasonForMonth(m) {
		if (m === 12 || m <= 2) return 'winter';
		if (m <= 5) return 'spring';
		if (m <= 8) return 'summer';
		return 'autumn';
	}

	// 契约 1：localStorage['TachikaSeason'] > URL ?season= > 当前月份
	function resolveSeason() {
		var saved = readStorage(SEASON_KEY).toLowerCase();
		if (seasonOf(saved)) {
			return saved;
		}
		try {
			var param = (new URLSearchParams(window.location.search).get('season') || '').toLowerCase();
			if (seasonOf(param)) {
				return param;
			}
		} catch (e) {
			/* 忽略 */
		}
		return seasonForMonth(new Date().getMonth() + 1);
	}

	var currentSeasonKey = resolveSeason();
	// 同步写入 html[data-season]，避免首帧令牌闪烁
	document.documentElement.dataset.season = currentSeasonKey;

	function activeSeason() {
		return currentSeasonKey;
	}

	// 临时开启主题切换过渡（避免常驻全站 transition）
	var switchTransitionTimer = null;
	function pulseThemeTransition() {
		if (reducedMotionMql && reducedMotionMql.matches) {
			return;
		}
		var root = document.documentElement;
		root.classList.add('is-theme-switching');
		if (switchTransitionTimer) {
			window.clearTimeout(switchTransitionTimer);
		}
		switchTransitionTimer = window.setTimeout(function () {
			root.classList.remove('is-theme-switching');
			switchTransitionTimer = null;
		}, SWITCH_TRANSITION_MS);
	}

	/* ---------------- 明暗模式权威控制（#scheme-toggle） ---------------- */

	function computeAuthoritativeScheme() {
		var saved = readStorage(SCHEME_KEY);
		var sysDark = !!(darkMql && darkMql.matches);
		if (saved === 'dark') return 'dark';
		if (saved === 'light') return 'light';
		return sysDark ? 'dark' : 'light';
	}

	function currentScheme() {
		var attr = document.documentElement.dataset.scheme;
		if (attr === 'dark' || attr === 'light') {
			return attr;
		}
		return computeAuthoritativeScheme();
	}

	function dispatchSchemeEvent(scheme) {
		try {
			window.dispatchEvent(new CustomEvent('onColorSchemeChange', { detail: scheme }));
		} catch (e) {
			/* 忽略 */
		}
	}

	function refreshSchemeButton(scheme) {
		var btn = document.getElementById('scheme-toggle');
		if (!btn) {
			return;
		}
		var isDark = scheme === 'dark';
		var iconWrap = btn.querySelector('.scheme-toggle-icon');
		var labelEl = btn.querySelector('.scheme-label-text');
		if (iconWrap) {
			iconWrap.innerHTML = isDark ? SCHEME_ICONS.dark : SCHEME_ICONS.light;
		}
		if (labelEl) {
			labelEl.textContent = isDark ? '深色' : '浅色';
		}
		btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
		btn.setAttribute('aria-label', isDark ? '切换为浅色模式（当前：深色）' : '切换为深色模式（当前：浅色）');
		btn.setAttribute('title', isDark ? '切换为浅色模式' : '切换为深色模式');
	}

	function applyAuthoritativeScheme(animate) {
		var next = computeAuthoritativeScheme();
		var prev = document.documentElement.dataset.scheme;
		if (animate && prev !== next) {
			pulseThemeTransition();
		}
		if (prev !== next) {
			document.documentElement.dataset.scheme = next;
			dispatchSchemeEvent(next);
		}
		refreshSchemeButton(next);
		return next;
	}

	function setScheme(target, animate) {
		if (target !== 'light' && target !== 'dark' && target !== 'auto') {
			return;
		}
		writeStorage(SCHEME_KEY, target);
		applyAuthoritativeScheme(animate !== false);
	}

	function toggleScheme() {
		var next = currentScheme() === 'dark' ? 'light' : 'dark';
		setScheme(next, true);
	}

	// 监听系统明暗变化：用 queueMicrotask + 零延迟宏任务双保险压过 ts/main.js 的旧 E(null) 监听器
	function handleSystemSchemeChange() {
		var enforce = function () {
			applyAuthoritativeScheme(false);
		};
		if (typeof queueMicrotask === 'function') {
			queueMicrotask(enforce);
		} else {
			Promise.resolve().then(enforce);
		}
		window.setTimeout(enforce, 0);
	}

	if (darkMql && typeof darkMql.addEventListener === 'function') {
		darkMql.addEventListener('change', handleSystemSchemeChange);
		// window.load 后晚于 main.js 再挂一次末尾权威校对，确保顺序永远压过 main.js
		window.addEventListener('load', function () {
			window.setTimeout(function () {
				darkMql.removeEventListener('change', handleSystemSchemeChange);
				darkMql.addEventListener('change', handleSystemSchemeChange);
				applyAuthoritativeScheme(false);
			}, 30);
		});
	}

	/* ---------------- 四季背景交叉淡出层（保留 f865d5f 防闪白） ---------------- */

	var preloaded = {};
	var activeLayer = null;
	var fadeTimer = null;
	var backdropSeq = 0;

	function ensureBackdrop() {
		var el = document.getElementById('season-backdrop');
		if (el) {
			return el;
		}
		el = document.createElement('div');
		el.id = 'season-backdrop';
		el.setAttribute('aria-hidden', 'true');
		el.innerHTML = '<div class="season-veil"></div>';
		document.body.insertBefore(el, document.body.firstChild);
		return el;
	}

	function preloadAdjacentSeasons(key) {
		try {
			var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
			if (conn && (conn.saveData || conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) {
				return;
			}
		} catch (e) {
			/* 忽略 */
		}
		var idx = seasonIndex(key);
		var targets = [
			SEASONS[(idx + 1) % SEASONS.length],
			SEASONS[(idx + SEASONS.length - 1) % SEASONS.length]
		];
		var run = function () {
			targets.forEach(function (s) {
				if (preloaded[s.img]) {
					return;
				}
				var probe = new Image();
				probe.onload = function () {
					preloaded[s.img] = true;
				};
				probe.src = IMG_BASE + s.img;
			});
		};
		if (typeof window.requestIdleCallback === 'function') {
			window.requestIdleCallback(run, { timeout: 2500 });
		} else {
			window.setTimeout(run, 1200);
		}
	}

	function setBackdrop(key, callbacks) {
		var s = seasonOf(key);
		var opts = typeof callbacks === 'function' ? { onDone: callbacks } : (callbacks || {});
		if (!s) {
			if (opts.onDone) opts.onDone();
			return;
		}
		var el = ensureBackdrop();
		var veil = el.querySelector('.season-veil');
		if (!veil) {
			if (opts.onDone) opts.onDone();
			return;
		}
		var url = IMG_BASE + s.img;
		var mySeq = ++backdropSeq;

		var swap = function () {
			if (mySeq !== backdropSeq) {
				return;
			}
			var old = Array.prototype.slice.call(el.querySelectorAll('.season-bg'));
			var layer = document.createElement('div');
			layer.className = 'season-bg is-shown';
			layer.style.backgroundImage = 'url("' + url + '")';
			// 新层 opacity:1 直接垫在旧层下方，旧层在上方淡出，杜绝切屏闪白
			layer.style.opacity = '1';
			el.insertBefore(layer, old.length ? old[0] : veil);
			activeLayer = layer;

			old.forEach(function (o) {
				o.classList.remove('is-shown');
				o.style.opacity = '0';
			});

			if (fadeTimer) {
				window.clearTimeout(fadeTimer);
			}
			var token = layer;
			var waitMs = (reducedMotionMql && reducedMotionMql.matches) ? 20 : (FADE_MS + 60);
			fadeTimer = window.setTimeout(function () {
				if (token !== activeLayer) {
					return;
				}
				old.forEach(function (o) {
					if (o !== activeLayer && o.parentNode) {
						o.parentNode.removeChild(o);
					}
				});
			}, waitMs);

			if (opts.onReady) opts.onReady();
			if (opts.onDone) opts.onDone();
			preloadAdjacentSeasons(key);
		};

		if (preloaded[s.img]) {
			swap();
			return;
		}

		var spinTimer = null;
		if (opts.onSlow) {
			spinTimer = window.setTimeout(function () {
				if (mySeq === backdropSeq) {
					opts.onSlow();
				}
			}, SPIN_DELAY_MS);
		}

		var probe = new Image();
		probe.onload = function () {
			if (spinTimer) window.clearTimeout(spinTimer);
			preloaded[s.img] = true;
			swap();
		};
		probe.onerror = function () {
			if (spinTimer) window.clearTimeout(spinTimer);
			if (mySeq === backdropSeq && opts.onDone) {
				opts.onDone();
			}
		};
		probe.src = url;
	}

	/* ---------------- 左栏双胶囊控件构建 ---------------- */

	function refreshSeasonButton(key, bump) {
		var li = document.getElementById('season-toggle');
		var s = seasonOf(key || activeSeason());
		if (!li || !s) {
			return;
		}
		var iconWrap = li.querySelector('.season-toggle-icon');
		if (iconWrap) {
			iconWrap.innerHTML = SEASON_ICONS[s.key] + '<span class="season-spinner"></span>';
		}
		var labelEl = li.querySelector('.season-current-label');
		if (labelEl) {
			if (labelEl.textContent !== s.label) {
				labelEl.textContent = s.label;
				if (bump) {
					labelEl.classList.remove('is-bump');
					void labelEl.offsetWidth;
					labelEl.classList.add('is-bump');
				}
			}
		}
		li.setAttribute('title', '切换季节（当前：' + s.fullLabel + '）');
		li.setAttribute('aria-label', '切换季节，当前为' + s.fullLabel);
	}

	function setSeasonLoading(li, on) {
		if (!li) {
			return;
		}
		li.classList.toggle('is-loading', !!on);
		li.setAttribute('aria-busy', on ? 'true' : 'false');
	}

	function buildSidebarControls(season) {
		var seasonLi = document.getElementById('season-toggle');
		if (!seasonLi) {
			var legacyToggle = document.getElementById('dark-mode-toggle');
			if (legacyToggle) {
				legacyToggle.id = 'season-toggle';
				seasonLi = legacyToggle;
			}
		}
		if (!seasonLi) {
			return null;
		}

		var row = seasonLi.parentElement;
		if (row && row.tagName === 'OL') {
			row.classList.add('sidebar-controls-row');
		}

		seasonLi.setAttribute('role', 'button');
		seasonLi.setAttribute('tabindex', '0');
		seasonLi.setAttribute('aria-live', 'polite');
		seasonLi.innerHTML =
			'<span class="season-toggle-icon" aria-hidden="true"></span>' +
			'<span class="season-label-wrap"><b class="season-current-label"></b></span>';
		refreshSeasonButton(season, false);

		var schemeLi = document.getElementById('scheme-toggle');
		if (!schemeLi && row) {
			schemeLi = document.createElement('li');
			schemeLi.id = 'scheme-toggle';
			schemeLi.setAttribute('role', 'button');
			schemeLi.setAttribute('tabindex', '0');
			schemeLi.innerHTML =
				'<span class="scheme-toggle-icon" aria-hidden="true"></span>' +
				'<span class="scheme-label-text"></span>';
			row.appendChild(schemeLi);
		}
		refreshSchemeButton(currentScheme());

		return { seasonLi: seasonLi, schemeLi: schemeLi };
	}

	function dispatchSeasonChange(nextKey, prevKey, source) {
		try {
			window.dispatchEvent(new CustomEvent('tachika:seasonchange', {
				detail: { season: nextKey, prev: prevKey, source: source || 'user' }
			}));
		} catch (e) {
			/* 忽略 */
		}
	}

	function applySeason(key, options, done) {
		var s = seasonOf(key);
		if (!s) {
			if (typeof done === 'function') done();
			return;
		}
		var opts = (options && typeof options === 'object' && !options.nodeType)
			? options
			: { li: options };
		var li = opts.li || document.getElementById('season-toggle');
		var prev = currentSeasonKey;
		currentSeasonKey = s.key;

		if (opts.persist !== false) {
			writeStorage(SEASON_KEY, s.key);
		}
		if (opts.animate !== false && prev !== s.key) {
			pulseThemeTransition();
		}
		document.documentElement.dataset.season = s.key;

		// 缓存命中瞬切图标与标签，未命中且耗时 >120ms 才转圈
		if (preloaded[s.img]) {
			refreshSeasonButton(s.key, prev !== s.key);
		}

		setBackdrop(s.key, {
			onSlow: function () {
				setSeasonLoading(li, true);
			},
			onReady: function () {
				setSeasonLoading(li, false);
				refreshSeasonButton(s.key, prev !== s.key);
			},
			onDone: function () {
				setSeasonLoading(li, false);
				if (typeof done === 'function') done();
			}
		});

		if (window.TachikaSeason && typeof window.TachikaSeason.set === 'function') {
			window.TachikaSeason.set(s.key);
		}
		if (prev !== s.key) {
			dispatchSeasonChange(s.key, prev, opts.source || 'user');
		}
	}

	function bindControls(controls) {
		if (!controls) {
			return;
		}
		var seasonLi = controls.seasonLi;
		var schemeLi = controls.schemeLi;

		if (seasonLi && !seasonLi.dataset.bound) {
			seasonLi.dataset.bound = '1';
			var onSeasonClick = function () {
				var nextIdx = (seasonIndex(activeSeason()) + 1) % SEASONS.length;
				applySeason(SEASONS[nextIdx].key, { li: seasonLi, source: 'user' });
			};
			seasonLi.addEventListener('click', onSeasonClick);
			seasonLi.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
					e.preventDefault();
					onSeasonClick();
				}
			});
		}

		if (schemeLi && !schemeLi.dataset.bound) {
			schemeLi.dataset.bound = '1';
			schemeLi.addEventListener('click', toggleScheme);
			schemeLi.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
					e.preventDefault();
					toggleScheme();
				}
			});
		}
	}

	// 跨标签同步：监听其他页面修改 TachikaSeason / StackColorScheme
	window.addEventListener('storage', function (e) {
		if (!e) return;
		if (e.key === SEASON_KEY && e.newValue && seasonOf(e.newValue.toLowerCase())) {
			applySeason(e.newValue.toLowerCase(), { persist: false, source: 'storage' });
		} else if (e.key === SCHEME_KEY) {
			applyAuthoritativeScheme(true);
		}
	});

	/* ---------------- 返回顶部（带阅读进度环）+ 顶部阅读进度条 ---------------- */

	function cleanupLegacyBackTop() {
		var oldBtn = document.getElementById('backTopBtn');
		if (oldBtn && oldBtn.parentNode) {
			oldBtn.parentNode.removeChild(oldBtn);
		}
		if (typeof window.onscroll === 'function') {
			window.onscroll = null;
		}
	}

	function mountScrollChrome() {
		cleanupLegacyBackTop();
		window.addEventListener('load', cleanupLegacyBackTop, { once: true });

		var backTop = document.getElementById('site-backtop');
		var ringRadius = 19;
		var circumference = 2 * Math.PI * ringRadius;
		if (!backTop) {
			backTop = document.createElement('button');
			backTop.id = 'site-backtop';
			backTop.type = 'button';
			backTop.setAttribute('aria-label', '返回顶部');
			backTop.setAttribute('title', '返回顶部');
			backTop.innerHTML =
				'<svg class="site-backtop__ring" viewBox="0 0 42 42" aria-hidden="true">' +
				'<circle class="site-backtop__track" cx="21" cy="21" r="' + ringRadius + '"/>' +
				'<circle class="site-backtop__progress" cx="21" cy="21" r="' + ringRadius + '" stroke-dasharray="' + circumference.toFixed(2) + '" stroke-dashoffset="' + circumference.toFixed(2) + '"/>' +
				'</svg>' +
				'<svg class="site-backtop__arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
				'<path d="M12 19V5M5 12l7-7 7 7"/>' +
				'</svg>';
			document.body.appendChild(backTop);

			backTop.addEventListener('click', function () {
				var reduce = !!(reducedMotionMql && reducedMotionMql.matches);
				window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
			});
		}

		var progressBar = null;
		if (document.body.classList.contains('article-page')) {
			var existingWrap = document.querySelector('.reading-progress');
			if (!existingWrap) {
				existingWrap = document.createElement('div');
				existingWrap.className = 'reading-progress';
				existingWrap.setAttribute('aria-hidden', 'true');
				existingWrap.innerHTML = '<div class="reading-progress__bar"></div>';
				document.body.appendChild(existingWrap);
			}
			progressBar = existingWrap.querySelector('.reading-progress__bar');
		}

		var ringCircle = backTop.querySelector('.site-backtop__progress');
		var rafPending = false;

		var updateScrollUI = function () {
			rafPending = false;
			var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
			var maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
			var ratio = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0;

			backTop.classList.toggle('is-visible', scrollTop > 240);
			if (ringCircle) {
				ringCircle.style.strokeDashoffset = (circumference * (1 - ratio)).toFixed(2);
			}
			if (progressBar) {
				progressBar.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
			}
		};

		var onScroll = function () {
			if (!rafPending) {
				rafPending = true;
				window.requestAnimationFrame(updateScrollUI);
			}
		};

		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });
		updateScrollUI();
	}

	/* ---------------- 首屏以下卡片轻渐显 ---------------- */

	function initBelowFoldReveal() {
		if ((reducedMotionMql && reducedMotionMql.matches) || !('IntersectionObserver' in window)) {
			return;
		}
		var cards = document.querySelectorAll('.article-list > article, .article-list--compact article, .work-item');
		if (!cards.length) {
			return;
		}
		var thresholdY = window.innerHeight * 0.95;
		var targets = [];
		for (var i = 0; i < cards.length; i++) {
			var rect = cards[i].getBoundingClientRect();
			if (rect.top >= thresholdY) {
				cards[i].classList.add('reveal-pending');
				targets.push(cards[i]);
			}
		}
		if (!targets.length) {
			return;
		}

		var cleanup = function (el) {
			el.classList.remove('reveal-pending', 'is-revealed');
		};

		var io = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (!entry.isIntersecting) {
					return;
				}
				var el = entry.target;
				io.unobserve(el);
				el.classList.add('is-revealed');
				var cleaned = false;
				var finish = function () {
					if (cleaned) return;
					cleaned = true;
					el.removeEventListener('transitionend', onEnd);
					cleanup(el);
				};
				var onEnd = function (ev) {
					if (ev.target === el && (ev.propertyName === 'opacity' || ev.propertyName === 'transform')) {
						finish();
					}
				};
				el.addEventListener('transitionend', onEnd);
				window.setTimeout(finish, 650);
			});
		}, { rootMargin: '0px 0px -20px 0px', threshold: 0.04 });

		targets.forEach(function (el) {
			io.observe(el);
		});
	}

	/* ---------------- 初始化入口 ---------------- */

	function init() {
		applyAuthoritativeScheme(false);
		setBackdrop(currentSeasonKey);
		var controls = buildSidebarControls(currentSeasonKey);
		bindControls(controls);
		mountScrollChrome();
		initBelowFoldReveal();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	window.TachikaSeasonUI = {
		set: applySeason,
		current: activeSeason,
		setScheme: setScheme,
		currentScheme: currentScheme
	};
}());
