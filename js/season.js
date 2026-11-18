/*
 * 季节切换器 + 全站背景图
 * 取代原来的暗色模式开关：点一下切换季节，同时改变粒子特效与背景图。
 * 四季图片来自 img/season/{spring,summer,autumn,winter}.webp。
 */
(function () {
	var SEASONS = [
		{ key: 'spring', label: '春', img: 'spring.webp' },
		{ key: 'summer', label: '夏', img: 'summer.webp' },
		{ key: 'autumn', label: '秋', img: 'autumn.webp' },
		{ key: 'winter', label: '冬', img: 'winter.webp' }
	];
	var BASE = '/iepl.github.io/img/season/';
	var STORAGE_KEY = 'TachikaSeason';

	// 这些页面部署在 /iepl.github.io/ 子路径下，背景图用绝对路径
	function seasonOf(key) {
		for (var i = 0; i < SEASONS.length; i++) {
			if (SEASONS[i].key === key) {
				return SEASONS[i];
			}
		}
		return null;
	}

	function readSaved() {
		try {
			return window.localStorage.getItem(STORAGE_KEY) || '';
		} catch (e) {
			return '';
		}
	}

	function writeSaved(key) {
		try {
			window.localStorage.setItem(STORAGE_KEY, key);
		} catch (e) {
			/* 隐私模式忽略 */
		}
	}

	// 与 sakura.js 保持一致的判定顺序：已保存偏好 > 地址栏预览 > 当前月份
	function activeSeason() {
		if (window.TachikaSeason) {
			return window.TachikaSeason.current();
		}
		var saved = readSaved();
		if (seasonOf(saved)) {
			return saved;
		}
		var m = new Date().getMonth() + 1;
		if (m === 12 || m <= 2) return 'winter';
		if (m <= 5) return 'spring';
		if (m <= 8) return 'summer';
		return 'autumn';
	}

	// 背景层：固定在最底层，位于粒子画布（z-index:-2）之下
	function ensureBackdrop() {
		var el = document.getElementById('season-backdrop');
		if (el) {
			return el;
		}

		var style = document.createElement('style');
		style.id = 'season-backdrop-style';
		style.textContent =
			/* ---------- 背景与交叉淡入 ---------- */
			'#season-backdrop{' +
			'position:fixed;inset:0;z-index:-3;pointer-events:none;' +
			'overflow:hidden;background:var(--body-background,#f5f5fa);' +
			'}' +
			// 每张图一个独立层，切换时新层淡入盖住旧层再删旧层，避免硬切
			'#season-backdrop .season-bg{' +
			'position:absolute;inset:-20px;' +
			'background-size:cover;background-position:center center;background-repeat:no-repeat;' +
			'filter:blur(2px) saturate(1.02);' +
			'opacity:0;transition:opacity .7s ease;' +
			'will-change:opacity;' +
			'}' +
			'#season-backdrop .season-bg.is-shown{opacity:1}' +
			// 蒙版只压低一点对比，让美术图仍然看得见
			'#season-backdrop .season-veil{' +
			'position:absolute;inset:0;' +
			'background:linear-gradient(180deg,rgba(245,245,250,.34) 0%,rgba(245,245,250,.5) 100%);' +
			'}' +
			'html[data-scheme="dark"] #season-backdrop .season-veil{' +
			'background:linear-gradient(180deg,rgba(12,14,18,.55) 0%,rgba(12,14,18,.68) 100%);' +
			'}' +
			/* ---------- 左侧栏：半透明面板 ---------- */
			// 侧栏自带层叠上下文，伪元素负 z-index 才不会掉到背景层后面
			'.sidebar.left-sidebar{position:relative;z-index:1;isolation:isolate}' +
			'.sidebar.left-sidebar::before{' +
			'content:"";position:absolute;inset:-10px -6px;z-index:-1;pointer-events:none;' +
			'background:rgba(252,252,254,.9);' +
			'border:1px solid rgba(255,255,255,.9);' +
			'border-radius:16px;' +
			'box-shadow:0 4px 24px rgba(40,50,70,.1);' +
			'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
			'}' +
			'html[data-scheme="dark"] .sidebar.left-sidebar::before{' +
			'background:rgba(20,22,28,.82);border-color:rgba(255,255,255,.1)' +
			'}' +
			/* ---------- 菜单：图标与文字等距、整行对齐 ---------- */
			':root{--menu-icon-separation:14px}' +
			'#main-menu{align-items:stretch}' +
			'#main-menu li{width:100%}' +
			// 用 ID+元素选择器压过主题的 #main-menu li a 规则
			'#main-menu li > a,#main-menu li#season-toggle{' +
			'display:flex;align-items:center;gap:14px;' +
			'width:100%;box-sizing:border-box;min-height:36px;' +
			'padding:6px 10px;border-radius:10px;' +
			'transition:background-color .18s ease,color .18s ease' +
			'}' +
			'#main-menu li#season-toggle{cursor:pointer;user-select:none}' +
			'#main-menu li > a:hover,#main-menu li#season-toggle:hover{' +
			'background:rgba(52,73,94,.08)' +
			'}' +
			'html[data-scheme="dark"] #main-menu li > a:hover,' +
			'html[data-scheme="dark"] #main-menu li#season-toggle:hover{background:rgba(255,255,255,.09)}' +
			// 图标固定宽高且不收缩，文字起点因此完全一致
			// 用 ID + 类名压过主题的 #main-menu li span{flex:1}
			'#main-menu li svg{flex:0 0 auto;width:20px;height:20px}' +
			'#main-menu li span.season-toggle-icon{' +
			'display:inline-flex;align-items:center;justify-content:center;' +
			'flex:0 0 20px;width:20px;min-width:20px;max-width:20px;height:20px' +
			'}' +
			'#main-menu li#season-toggle > span:last-child{' +
			'flex:0 0 auto;line-height:1.25' +
			'}' +
			'#main-menu li > a > span{flex:0 0 auto;line-height:1.25}' +
			// 收窄菜单项之间的间距，视觉上成组
			'#main-menu,#main-menu .menu-bottom-section ol{gap:4px}' +
			'.menu-social{justify-content:flex-start;padding-left:10px}' +
			/* 当前季节高亮 */
			'.season-current-label{margin-left:.45rem;font-weight:700;color:var(--accent-color);' +
			'display:inline-block;transition:transform .18s ease}' +
			'.season-current-label.is-bump{animation:season-bump .42s ease}' +
			'@keyframes season-bump{' +
			'0%{transform:translateY(4px) scale(.9);opacity:.2}' +
			'60%{transform:translateY(0) scale(1.08);opacity:1}' +
			'100%{transform:translateY(0) scale(1)}' +
			'}' +
			/* ---------- 转圈反馈 ---------- */
			'.season-spinner{' +
			'display:none;width:18px;height:18px;box-sizing:border-box;' +
			'border:2px solid currentColor;border-top-color:transparent;' +
			'border-radius:50%;opacity:.75' +
			'}' +
			'#season-toggle.is-loading .season-sun{display:none}' +
			'#season-toggle.is-loading .season-spinner{display:block;animation:season-spin .7s linear infinite}' +
			'#season-toggle.is-loading{pointer-events:none;opacity:.8}' +
			'@keyframes season-spin{to{transform:rotate(360deg)}}' +
			'@media (prefers-reduced-motion:reduce){' +
			'#season-backdrop .season-bg{transition:none}' +
			'#season-toggle.is-loading .season-spinner{animation-duration:2s}' +
			'}' +
			/* ---------- 正文卡片 ---------- */
			'.article-list > article{background:var(--card-background,#fff);' +
			'border-radius:var(--card-border-radius,10px);box-shadow:0 1px 4px rgba(0,0,0,.08)}' +
			'main > article{background:var(--card-background,#fff)}' +
			'html[data-scheme="dark"] .article-list > article,' +
			'html[data-scheme="dark"] main > article{' +
			'background:var(--card-background,#2a2a2e)' +
			'}';
		document.head.appendChild(style);

		el = document.createElement('div');
		el.id = 'season-backdrop';
		el.setAttribute('aria-hidden', 'true');
		el.innerHTML = '<div class="season-veil"></div>';
		document.body.insertBefore(el, document.body.firstChild);
		return el;
	}

	var preloaded = {};
	var FADE_MS = 700;
	var activeLayer = null;   // 当前应保持可见的层
	var fadeTimer = null;

	// 交叉淡入：新层盖在旧层之上淡入，结束后移除旧层
	function setBackdrop(key, done) {
		var s = seasonOf(key);
		if (!s) {
			if (done) {
				done();
			}
			return;
		}
		var el = ensureBackdrop();
		var veil = el.querySelector('.season-veil');
		if (!veil) {
			if (done) {
				done();
			}
			return;
		}
		var url = BASE + s.img;

		var swap = function () {
			var old = Array.prototype.slice.call(el.querySelectorAll('.season-bg'));
			var layer = document.createElement('div');
			layer.className = 'season-bg';
			layer.style.backgroundImage = 'url("' + url + '")';
			el.insertBefore(layer, veil);
			activeLayer = layer;

			// 强制一次同步回流，让初始 opacity:0 生效
			void layer.offsetWidth;
			// 用 setTimeout 而非 requestAnimationFrame：后台标签页会冻结 rAF，
			// 那样 is-shown 永远加不上，背景就会一直是透明的
			window.setTimeout(function () {
				layer.classList.add('is-shown');
			}, 30);

			// 新层完全显示后清掉旧层；只删本轮之前的层，绝不碰 activeLayer
			if (fadeTimer) {
				window.clearTimeout(fadeTimer);
			}
			fadeTimer = window.setTimeout(function () {
				old.forEach(function (o) {
					if (o !== activeLayer && o.parentNode) {
						o.parentNode.removeChild(o);
					}
				});
				if (done) {
					done();
				}
			}, FADE_MS + 60);
		};

		if (preloaded[s.img]) {
			swap();
			return;
		}
		var probe = new Image();
		probe.onload = function () {
			preloaded[s.img] = true;
			swap();
		};
		probe.onerror = function () {
			// 图挂了就保持底色，不切换
			if (done) {
				done();
			}
		};
		probe.src = url;
	}

	function currentLabel(key) {
		var s = seasonOf(key);
		return s ? s.label : '';
	}

	// 把菜单里的季节切换项填上内容并接管交互
	// 静态 HTML 里已经是 #season-toggle（空标签），旧的 #dark-mode-toggle 作为兜底
	function buildToggler(season) {
		var li = document.getElementById('season-toggle') || document.getElementById('dark-mode-toggle');
		if (!li) {
			return null;
		}
		li.id = 'season-toggle';
		li.setAttribute('role', 'button');
		li.setAttribute('tabindex', '0');
		li.setAttribute('title', '切换季节');
		li.setAttribute('aria-live', 'polite');
		var label = li.querySelector('.season-current-label');
		if (!label) {
			li.innerHTML =
				'<span class="season-toggle-icon" aria-hidden="true">' +
				// 太阳图标（常态）
				'<svg class="season-sun icon icon-tabler icon-tabler-sun" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
				'<path stroke="none" d="M0 0h24v24H0z" fill="none"/>' +
				'<circle cx="12" cy="12" r="4" />' +
				'<path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" />' +
				'</svg>' +
				// 转圈图标（切换中）
				'<span class="season-spinner"></span>' +
				'</span>' +
				'<span>季节<b class="season-current-label"></b></span>';
		}
		refreshLabel(season);
		return li;
	}

	function refreshLabel(key) {
		var el = document.querySelector('.season-current-label');
		if (el) {
			var next = currentLabel(key || activeSeason());
			if (el.textContent !== next) {
				el.textContent = next;
				// 标签变化时轻微弹一下，作为切换成功的视觉回执
				el.classList.remove('is-bump');
				void el.offsetWidth;
				el.classList.add('is-bump');
			}
		}
	}

	function setLoading(li, on) {
		if (!li) {
			return;
		}
		li.classList.toggle('is-loading', !!on);
		li.setAttribute('aria-busy', on ? 'true' : 'false');
	}

	function applySeason(key, li, done) {
		writeSaved(key);
		// 背景图与粒子特效各自独立，必须都切
		setBackdrop(key, function () {
			refreshLabel(key);
			if (done) {
				done();
			}
		});
		if (window.TachikaSeason) {
			window.TachikaSeason.set(key);
		}
	}

	function bind(li) {
		var busy = false;
		var next = function () {
			if (busy) {
				return;
			}
			busy = true;
			setLoading(li, true);

			var cur = activeSeason();
			var idx = 0;
			for (var i = 0; i < SEASONS.length; i++) {
				if (SEASONS[i].key === cur) {
					idx = i;
					break;
				}
			}
			var target = SEASONS[(idx + 1) % SEASONS.length].key;

			// 转圈至少显示这么久，否则瞬间切完看不到反馈
			var startedAt = Date.now();
			var MIN_SPIN = 420;
			applySeason(target, li, function () {
				var left = MIN_SPIN - (Date.now() - startedAt);
				window.setTimeout(function () {
					setLoading(li, false);
					busy = false;
				}, Math.max(0, left));
			});
		};
		li.addEventListener('click', next);
		li.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
				e.preventDefault();
				next();
			}
		});
	}

	function init() {
		var season = activeSeason();
		setBackdrop(season);
		var li = buildToggler(season);
		if (li) {
			bind(li);
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	// 供 sakura.js 之外的脚本或调试使用
	window.TachikaSeasonUI = { set: applySeason, current: activeSeason };
}());
