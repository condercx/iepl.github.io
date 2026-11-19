/*
 * Tachika 四季景深氛围粒子引擎（轻量离屏精灵版）
 * - 春：3 层景深 3D 翻滚桃/樱花瓣 + 周期阵风
 * - 夏：亮色柔和金色光尘 / 暗色自动切换呼吸萤火虫（响应 onColorSchemeChange 与 MutationObserver）
 * - 秋：丹枫 + 银杏双剪影钟摆飘落（修复旧版 r > 12 消失缺陷）
 * - 冬：3 层离屏径向渐变柔雪 + 近景焦外大雪片（禁用 shadowBlur）
 * - 支持 HiDPI（DPR≤2）、visibilitychange 停帧、prefers-reduced-motion、150ms resize 防抖、移动端粒子减半
 */
(function () {
	'use strict';

	var SEASONS = ['spring', 'summer', 'autumn', 'winter'];
	var STORAGE_KEY = 'TachikaSeason';
	var reducedMql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

	var sessionSeason = '';
	var canvas = null, ctx = null, width = 0, height = 0, dpr = 1;
	var rafId = 0, lastTime = 0, sceneKey = '', schemeKey = '', paused = false;
	var particles = [], sprites = {}, fadeTimer = null, resizeTimer = null;

	function byMonth(m) {
		return (m === 12 || m <= 2) ? 'winter' : (m <= 5 ? 'spring' : (m <= 8 ? 'summer' : 'autumn'));
	}

	function resolveSeason() {
		if (sessionSeason && SEASONS.indexOf(sessionSeason) >= 0) return sessionSeason;
		try {
			var saved = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
			if (SEASONS.indexOf(saved) >= 0) return saved;
		} catch (e) {}
		try {
			var q = (new URLSearchParams(location.search).get('season') || '').toLowerCase();
			if (SEASONS.indexOf(q) >= 0) return q;
		} catch (e) {}
		return byMonth(new Date().getMonth() + 1);
	}

	function isDark() { return document.documentElement.dataset.scheme === 'dark'; }
	function isReduced() { return !!(reducedMql && reducedMql.matches); }
	function rand(a, b) { return a + Math.random() * (b - a); }
	function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
	function pickLayer() { var r = Math.random(); return r < 0.44 ? 0 : (r < 0.82 ? 1 : 2); }

	function mkCanvas(size) {
		var c = document.createElement('canvas');
		c.width = c.height = size;
		return c;
	}

	function petalSprite(c1, c2) {
		var c = mkCanvas(36), g = c.getContext('2d');
		g.translate(18, 18);
		var gr = g.createLinearGradient(-10, -14, 10, 14);
		gr.addColorStop(0, c1);
		gr.addColorStop(1, c2);
		g.fillStyle = gr;
		g.beginPath();
		g.moveTo(0, 13);
		g.bezierCurveTo(-11, 6, -12, -8, -4.5, -13);
		g.quadraticCurveTo(-1.2, -10.2, 0, -8.5);
		g.quadraticCurveTo(1.2, -10.2, 4.5, -13);
		g.bezierCurveTo(12, -8, 11, 6, 0, 13);
		g.closePath();
		g.fill();
		return c;
	}

	function mapleSprite(fill, vein) {
		var c = mkCanvas(44), g = c.getContext('2d');
		g.translate(22, 22);
		g.fillStyle = fill;
		g.beginPath();
		g.moveTo(0, -17); g.lineTo(3.2, -7.5); g.lineTo(12.5, -10); g.lineTo(7.2, -1.8);
		g.lineTo(16, 2.5); g.lineTo(5.8, 5.2); g.lineTo(8.5, 11.5); g.lineTo(1.2, 8.8);
		g.lineTo(0, 16.5); g.lineTo(-1.2, 8.8); g.lineTo(-8.5, 11.5); g.lineTo(-5.8, 5.2);
		g.lineTo(-16, 2.5); g.lineTo(-7.2, -1.8); g.lineTo(-12.5, -10); g.lineTo(-3.2, -7.5);
		g.closePath();
		g.fill();
		g.strokeStyle = vein;
		g.lineWidth = 0.9;
		g.beginPath();
		g.moveTo(0, -13); g.lineTo(0, 15);
		g.moveTo(0, 1); g.lineTo(9, -5);
		g.moveTo(0, 1); g.lineTo(-9, -5);
		g.stroke();
		return c;
	}

	function ginkgoSprite(fill, vein) {
		var c = mkCanvas(40), g = c.getContext('2d');
		g.translate(20, 22);
		g.fillStyle = fill;
		g.beginPath();
		g.moveTo(0, 12);
		g.bezierCurveTo(-14, 2, -15, -12, -3, -15);
		g.quadraticCurveTo(-1, -11, 0, -10);
		g.quadraticCurveTo(1, -11, 3, -15);
		g.bezierCurveTo(15, -12, 14, 2, 0, 12);
		g.closePath();
		g.fill();
		g.strokeStyle = vein;
		g.lineWidth = 1;
		g.beginPath();
		g.moveTo(0, 11); g.lineTo(0, 16);
		g.stroke();
		return c;
	}

	function glowSprite(size, inner, mid, outer) {
		var c = mkCanvas(size), g = c.getContext('2d'), h = size / 2;
		var gr = g.createRadialGradient(h, h, 0, h, h, h);
		gr.addColorStop(0, inner);
		gr.addColorStop(0.35, mid);
		gr.addColorStop(1, outer);
		g.fillStyle = gr;
		g.beginPath();
		g.arc(h, h, h, 0, Math.PI * 2);
		g.fill();
		return c;
	}

	function getSprites(key) {
		if (sprites[key]) return sprites[key];
		if (key === 'spring') {
			sprites[key] = [
				petalSprite('rgba(255,232,239,.95)', 'rgba(244,175,197,.88)'),
				petalSprite('rgba(252,214,226,.94)', 'rgba(232,146,174,.86)'),
				petalSprite('rgba(255,241,244,.92)', 'rgba(246,194,206,.84)')
			];
		} else if (key === 'autumn') {
			sprites[key] = [
				mapleSprite('rgba(196,68,34,.92)', 'rgba(122,34,16,.45)'),
				mapleSprite('rgba(218,102,42,.90)', 'rgba(138,56,20,.42)'),
				ginkgoSprite('rgba(226,172,48,.92)', 'rgba(148,102,22,.45)'),
				ginkgoSprite('rgba(238,194,78,.90)', 'rgba(156,114,30,.40)')
			];
		} else if (key === 'winter') {
			sprites[key] = [
				glowSprite(16, 'rgba(255,255,255,.95)', 'rgba(226,240,255,.55)', 'rgba(226,240,255,0)'),
				glowSprite(26, 'rgba(255,255,255,.92)', 'rgba(214,234,252,.48)', 'rgba(214,234,252,0)'),
				glowSprite(52, 'rgba(255,255,255,.58)', 'rgba(218,236,252,.22)', 'rgba(218,236,252,0)')
			];
		} else if (key === 'summer-light') {
			sprites[key] = [
				glowSprite(34, 'rgba(255,248,214,.85)', 'rgba(255,232,164,.34)', 'rgba(255,232,164,0)'),
				glowSprite(44, 'rgba(255,252,232,.72)', 'rgba(216,245,222,.26)', 'rgba(216,245,222,0)')
			];
		} else {
			sprites[key] = [
				glowSprite(40, 'rgba(252,255,216,.98)', 'rgba(202,246,132,.46)', 'rgba(162,236,118,0)'),
				glowSprite(34, 'rgba(255,250,204,.96)', 'rgba(250,224,124,.42)', 'rgba(250,224,124,0)'),
				glowSprite(36, 'rgba(224,255,238,.94)', 'rgba(130,234,196,.38)', 'rgba(130,234,196,0)')
			];
		}
		return sprites[key];
	}

	function mkSpring(init) {
		var l = pickLayer();
		var sp = [rand(0.32, 0.58), rand(0.68, 1.08), rand(1.15, 1.65)][l];
		return {
			l: l, sp: pick(getSprites('spring')),
			x: init ? rand(0, width) : (Math.random() > 0.3 ? rand(0, width * 1.15) : width + rand(10, 40)),
			y: init ? rand(0, height) : (Math.random() > 0.3 ? -rand(16, 60) : rand(0, height * 0.55)),
			s: [rand(0.28, 0.45), rand(0.52, 0.78), rand(0.88, 1.18)][l],
			vx: -sp * rand(0.55, 1.05), vy: sp * rand(0.85, 1.35),
			rot: rand(0, 6.28), vrot: rand(-0.022, 0.022),
			tilt: rand(0, 6.28), vtilt: rand(0.025, 0.055),
			a: [rand(0.35, 0.55), rand(0.62, 0.82), rand(0.78, 0.94)][l]
		};
	}

	function mkAutumn(init) {
		var l = pickLayer();
		return {
			l: l, sp: pick(getSprites('autumn')),
			x: rand(-20, width + 20), y: init ? rand(0, height) : -rand(24, height * 0.25),
			s: [rand(0.32, 0.48), rand(0.56, 0.80), rand(0.88, 1.16)][l],
			vy: [rand(0.38, 0.65), rand(0.68, 1.05), rand(1.05, 1.52)][l],
			drift: rand(0.12, 0.34), sway: rand(0, 6.28),
			swayV: rand(0.014, 0.028), swayA: rand(0.55, 1.45) * (0.7 + l * 0.25),
			rot: rand(-0.6, 0.6), tilt: rand(0, 6.28), vtilt: rand(0.012, 0.028),
			a: [rand(0.40, 0.60), rand(0.68, 0.86), rand(0.82, 0.96)][l]
		};
	}

	function mkWinter(init) {
		var l = pickLayer();
		return {
			l: l, sp: getSprites('winter')[l],
			x: rand(0, width), y: init ? rand(0, height) : -rand(16, 60),
			sz: [rand(5, 9), rand(10, 17), rand(26, 44)][l],
			vy: [rand(0.30, 0.58), rand(0.65, 1.15), rand(1.15, 1.75)][l],
			drift: rand(0.18, 0.65), ph: rand(0, 6.28), phV: rand(0.008, 0.02),
			a: [rand(0.42, 0.68), rand(0.68, 0.90), rand(0.30, 0.52)][l]
		};
	}

	function mkSummerLight(init) {
		var l = pickLayer();
		return {
			l: l, sp: pick(getSprites('summer-light')),
			x: rand(0, width), y: init ? rand(0, height) : height + rand(12, 50),
			sz: [rand(10, 18), rand(18, 30), rand(32, 48)][l],
			vx: rand(-0.18, 0.26), vy: -rand(0.14, 0.42) * (0.75 + l * 0.25),
			ph: rand(0, 6.28), phV: rand(0.008, 0.02),
			a: l === 2 ? rand(0.24, 0.44) : rand(0.32, 0.62)
		};
	}

	function mkFirefly() {
		var l = pickLayer();
		return {
			l: l, sp: pick(getSprites('summer-dark')),
			x: rand(0, width), y: rand(height * 0.12, height * 0.95),
			sz: [rand(12, 18), rand(18, 28), rand(28, 40)][l],
			ang: rand(0, 6.28), turn: rand(-0.022, 0.022),
			spd: rand(0.22, 0.56) * (0.7 + l * 0.22),
			ph: rand(0, 6.28), phV: rand(0.014, 0.034),
			a: l === 2 ? rand(0.75, 0.96) : rand(0.55, 0.85)
		};
	}

	function buildParticles(season, dark) {
		var k = width < 768 ? 0.5 : 1, list = [], n, fn;
		if (season === 'spring') { n = 44; fn = mkSpring; }
		else if (season === 'autumn') { n = 28; fn = mkAutumn; }
		else if (season === 'winter') { n = 54; fn = mkWinter; }
		else if (dark) { n = 30; fn = mkFirefly; }
		else { n = 34; fn = mkSummerLight; }
		for (var i = 0; i < Math.round(n * k); i++) list.push(fn(true));
		list.sort(function (a, b) { return a.l - b.l; });
		return list;
	}

	function tick(now) {
		if (!canvas || !ctx || paused) { rafId = 0; return; }
		if (!lastTime) lastTime = now;
		var dt = Math.min(2.5, Math.max(0.25, (now - lastTime) / 16.6667));
		lastTime = now;
		ctx.clearRect(0, 0, width, height);

		var i, p, w, h;
		if (sceneKey === 'spring') {
			var gust = Math.sin(now * 0.00042) * 0.45 + Math.sin(now * 0.0011) * 0.18;
			for (i = 0; i < particles.length; i++) {
				p = particles[i];
				p.x += (p.vx + gust * (0.5 + p.l * 0.35)) * dt;
				p.y += p.vy * dt;
				p.rot += p.vrot * dt;
				p.tilt += p.vtilt * dt;
				if (p.y > height + 36 || p.x < -48 || p.x > width + 60) {
					var f = mkSpring(false);
					p.x = f.x; p.y = f.y; p.vx = f.vx; p.vy = f.vy;
				}
				w = p.sp.width * p.s; h = p.sp.height * p.s;
				ctx.save();
				ctx.globalAlpha = p.a;
				ctx.translate(p.x, p.y);
				ctx.rotate(p.rot);
				ctx.scale(0.28 + 0.72 * Math.abs(Math.cos(p.tilt)), 1);
				ctx.drawImage(p.sp, -w / 2, -h / 2, w, h);
				ctx.restore();
			}
		} else if (sceneKey === 'autumn') {
			for (i = 0; i < particles.length; i++) {
				p = particles[i];
				p.sway += p.swayV * dt;
				p.tilt += p.vtilt * dt;
				var sw = Math.sin(p.sway);
				p.x += (sw * p.swayA + p.drift) * dt;
				p.y += p.vy * dt;
				p.rot = sw * 0.55;
				if (p.y > height + 40 || p.x < -64 || p.x > width + 64) {
					var fa = mkAutumn(false);
					p.x = fa.x; p.y = fa.y; p.sway = fa.sway;
				}
				w = p.sp.width * p.s; h = p.sp.height * p.s;
				ctx.save();
				ctx.globalAlpha = p.a;
				ctx.translate(p.x, p.y);
				ctx.rotate(p.rot);
				ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.cos(p.tilt)));
				ctx.drawImage(p.sp, -w / 2, -h / 2, w, h);
				ctx.restore();
			}
		} else if (sceneKey === 'winter') {
			var breeze = Math.sin(now * 0.0003) * 0.22;
			for (i = 0; i < particles.length; i++) {
				p = particles[i];
				p.ph += p.phV * dt;
				p.x += (Math.sin(p.ph) * p.drift + breeze * (0.6 + p.l * 0.3)) * dt;
				p.y += p.vy * dt;
				if (p.y > height + p.sz) { p.y = -p.sz; p.x = rand(0, width); }
				if (p.x < -p.sz) p.x = width + p.sz * 0.5;
				else if (p.x > width + p.sz) p.x = -p.sz * 0.5;
				ctx.globalAlpha = p.a;
				ctx.drawImage(p.sp, p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
			}
			ctx.globalAlpha = 1;
		} else if (schemeKey === 'dark') {
			ctx.save();
			ctx.globalCompositeOperation = 'lighter';
			for (i = 0; i < particles.length; i++) {
				p = particles[i];
				p.ph += p.phV * dt;
				p.ang += (p.turn + Math.sin(p.ph * 0.6) * 0.01) * dt;
				p.x += Math.cos(p.ang) * p.spd * dt;
				p.y += Math.sin(p.ang) * p.spd * dt - 0.04 * dt;
				if (p.x < -30) p.x = width + 24; else if (p.x > width + 30) p.x = -24;
				if (p.y < -30) p.y = height + 24; else if (p.y > height + 30) p.y = -24;
				var br = 0.5 + 0.5 * Math.sin(p.ph);
				ctx.globalAlpha = p.a * (0.12 + 0.88 * br * br);
				ctx.drawImage(p.sp, p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
			}
			ctx.restore();
		} else {
			for (i = 0; i < particles.length; i++) {
				p = particles[i];
				p.ph += p.phV * dt;
				p.x += (p.vx + Math.sin(p.ph) * 0.16) * dt;
				p.y += p.vy * dt;
				if (p.y < -p.sz) { p.y = height + p.sz; p.x = rand(0, width); }
				if (p.x < -p.sz) p.x = width + p.sz; else if (p.x > width + p.sz) p.x = -p.sz;
				ctx.globalAlpha = p.a * (0.55 + 0.45 * Math.sin(p.ph));
				ctx.drawImage(p.sp, p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
			}
			ctx.globalAlpha = 1;
		}
		rafId = window.requestAnimationFrame(tick);
	}

	function resizeCanvas() {
		if (!canvas || !ctx) return;
		width = window.innerWidth;
		height = window.innerHeight;
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.max(1, Math.floor(width * dpr));
		canvas.height = Math.max(1, Math.floor(height * dpr));
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	function ensureCanvas() {
		if (canvas && canvas.parentNode) return canvas;
		canvas = document.getElementById('canvas_sakura');
		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.id = 'canvas_sakura';
			canvas.setAttribute('aria-hidden', 'true');
			canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:-2;opacity:0;';
			document.body.appendChild(canvas);
		}
		ctx = canvas.getContext('2d');
		resizeCanvas();
		return canvas;
	}

	function stopEngine() {
		if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
		if (fadeTimer) { window.clearTimeout(fadeTimer); fadeTimer = null; }
		if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
		canvas = ctx = null;
		particles = [];
		lastTime = 0;
	}

	function applyScene(season, smooth) {
		if (isReduced()) { stopEngine(); return; }
		var el = ensureCanvas();
		var dark = isDark();
		var nextScheme = dark ? 'dark' : 'light';

		var swap = function () {
			sceneKey = season;
			schemeKey = nextScheme;
			el.setAttribute('data-season', season);
			particles = buildParticles(season, dark);
			lastTime = 0;
			if (!rafId && !paused) rafId = window.requestAnimationFrame(tick);
			window.requestAnimationFrame(function () { if (canvas) canvas.style.opacity = '1'; });
		};

		if (fadeTimer) { window.clearTimeout(fadeTimer); fadeTimer = null; }
		if (smooth && sceneKey) {
			el.style.opacity = '0';
			fadeTimer = window.setTimeout(function () { fadeTimer = null; swap(); }, 260);
		} else {
			swap();
		}
	}

	function setSeason(season) {
		if (SEASONS.indexOf(season) < 0) return;
		sessionSeason = season;
		try { localStorage.setItem(STORAGE_KEY, season); } catch (e) {}
		document.documentElement.dataset.season = season;
		if (document.body) applyScene(season, true);
	}

	function syncSummerScheme() {
		var next = isDark() ? 'dark' : 'light';
		if (sceneKey === 'summer' && next !== schemeKey && !isReduced()) applyScene('summer', true);
		else schemeKey = next;
	}

	window.addEventListener('onColorSchemeChange', syncSummerScheme);
	if (typeof MutationObserver === 'function') {
		new MutationObserver(function (ms) {
			for (var i = 0; i < ms.length; i++) {
				if (ms[i].attributeName === 'data-scheme') { syncSummerScheme(); break; }
			}
		}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] });
	}

	document.addEventListener('visibilitychange', function () {
		paused = !!document.hidden;
		if (paused) {
			if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
		} else if (canvas && !isReduced() && !rafId) {
			lastTime = 0;
			rafId = window.requestAnimationFrame(tick);
		}
	});

	window.addEventListener('resize', function () {
		if (resizeTimer) window.clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(function () {
			resizeTimer = null;
			if (!canvas || isReduced()) return;
			var prevMob = width < 768;
			resizeCanvas();
			if (prevMob !== (width < 768) && sceneKey) particles = buildParticles(sceneKey, isDark());
		}, 150);
	}, { passive: true });

	if (reducedMql && typeof reducedMql.addEventListener === 'function') {
		reducedMql.addEventListener('change', function () {
			if (isReduced()) stopEngine();
			else if (document.body) applyScene(resolveSeason(), false);
		});
	}

	window.TachikaSeason = {
		names: SEASONS.slice(),
		current: resolveSeason,
		set: setSeason,
		byMonth: byMonth
	};

	function boot() {
		var s = resolveSeason();
		document.documentElement.dataset.season = s;
		applyScene(s, false);
	}
	if (document.body) boot();
	else document.addEventListener('DOMContentLoaded', boot);
}());
