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
		// 图片放在独立子层上直接加模糊：backdrop-filter 在这种固定层里不生效
		style.textContent =
			'#season-backdrop{' +
			'position:fixed;inset:0;z-index:-3;pointer-events:none;' +
			'overflow:hidden;' +
			'background:var(--body-background,#f5f5fa);' +
			'}' +
			'#season-backdrop .season-bg{' +
			'position:absolute;inset:-20px;' +
			'background-size:cover;background-position:center center;background-repeat:no-repeat;' +
			'filter:blur(2px) saturate(1.02);' +
			'opacity:0;transition:opacity .6s ease;' +
			'}' +
			'#season-backdrop.is-ready .season-bg{opacity:1}' +
			// 蒙版只压低一点对比，让美术图仍然看得见
			'#season-backdrop .season-veil{' +
			'position:absolute;inset:0;' +
			'background:linear-gradient(180deg,rgba(245,245,250,.34) 0%,rgba(245,245,250,.5) 100%);' +
			'}' +
			'html[data-scheme="dark"] #season-backdrop .season-veil{' +
			'background:linear-gradient(180deg,rgba(12,14,18,.55) 0%,rgba(12,14,18,.68) 100%);' +
			'}' +
			'.sidebar.left-sidebar{position:relative}' +
			// 侧栏与右栏给一层半透明白，文字压在美术图上也不糊
			'.sidebar.left-sidebar::before{' +
			'content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;' +
			'background:rgba(250,250,253,.72);border-radius:12px;' +
			'}' +
			'html[data-scheme="dark"] .sidebar.left-sidebar::before{' +
			'background:rgba(20,22,28,.72)' +
			'}' +
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
		el.innerHTML = '<div class="season-bg"></div><div class="season-veil"></div>';
		document.body.insertBefore(el, document.body.firstChild);
		return el;
	}

	var preloaded = {};

	function setBackdrop(key) {
		var s = seasonOf(key);
		if (!s) {
			return;
		}
		var el = ensureBackdrop();
		var layer = el.querySelector('.season-bg');
		if (!layer) {
			return;
		}
		var url = BASE + s.img;

		// 先预载，加载完成后淡入，避免切换时闪白
		var apply = function () {
			layer.style.backgroundImage = 'url("' + url + '")';
			el.classList.add('is-ready');
		};
		if (preloaded[s.img]) {
			apply();
			return;
		}
		var probe = new Image();
		probe.onload = function () {
			preloaded[s.img] = true;
			apply();
		};
		probe.onerror = function () {
			// 图挂了就保持底色，不要留下半透明层
			el.classList.remove('is-ready');
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
		var label = li.querySelector('.season-current-label');
		if (!label) {
			li.innerHTML =
				'<span class="season-toggle-icon" aria-hidden="true">' +
				'<svg xmlns="http://www.w3.org/2000/svg" class="icon icon-tabler icon-tabler-sun" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
				'<path stroke="none" d="M0 0h24v24H0z" fill="none"/>' +
				'<circle cx="12" cy="12" r="4" />' +
				'<path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" />' +
				'</svg></span>' +
				'<span>季节<b class="season-current-label"></b></span>';
		}
		refreshLabel(season);
		return li;
	}

	function refreshLabel(key) {
		var el = document.querySelector('.season-current-label');
		if (el) {
			el.textContent = currentLabel(key || activeSeason());
		}
	}

	function applySeason(key) {
		writeSaved(key);
		// 背景图与粒子特效各自独立，必须都切
		setBackdrop(key);
		if (window.TachikaSeason) {
			window.TachikaSeason.set(key);
		}
		refreshLabel(key);
	}

	function bind(li) {
		var next = function () {
			var cur = activeSeason();
			var idx = 0;
			for (var i = 0; i < SEASONS.length; i++) {
				if (SEASONS[i].key === cur) {
					idx = i;
					break;
				}
			}
			var target = SEASONS[(idx + 1) % SEASONS.length].key;
			applySeason(target);
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
