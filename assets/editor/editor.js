(function () {
  'use strict';

  var KEY = 'wn-editor-v1';
  var INDENT = '　　'; // 两个全角空格

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    app: $('app'), side: $('side'), notes: $('notes'),
    bookSelect: $('book-select'), chapters: $('chapters'),
    title: $('chapter-title'), text: $('text'), notesText: $('notes-text'),
    chapterCount: $('chapter-count'), bookCount: $('book-count'), chapterTotal: $('chapter-total'),
    todayCount: $('today-count'), todayBar: $('today-bar'), goal: $('goal'),
    saveState: $('save-state'), cursorPos: $('cursor-pos'), updatedAt: $('updated-at'),
    findbar: $('findbar'), findInput: $('find-input'), replaceInput: $('replace-input'),
    findCount: $('find-count'), replaceBook: $('replace-book'),
    bookMenu: $('book-menu'), moreMenu: $('more-menu'), indentState: $('indent-state'),
    toast: $('toast'), restoreInput: $('restore-input')
  };

  // ---------- 数据 ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function newChapter(n) { return { id: uid(), title: '第' + n + '章 ', content: '', updated: Date.now() }; }
  function newBook(title) {
    return { id: uid(), title: title || '未命名作品', notes: '', chapters: [newChapter(1)], created: Date.now() };
  }
  function defaults() {
    var b = newBook('我的第一本书');
    return { v: 1, books: [b], bookId: b.id, chapterId: b.chapters[0].id, daily: {}, goal: 4000, fontSize: 19, autoIndent: true, sideOpen: true };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.books) && s.books.length) return Object.assign(defaults(), s);
      }
    } catch (e) { /* 存储不可用时退回默认数据 */ }
    return defaults();
  }

  var saveTimer = null;
  var storageOk = true;
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
      setSaveState('已保存');
    } catch (e) {
      storageOk = false;
      setSaveState('保存失败！请立即备份', true);
    }
  }
  function scheduleSave() {
    setSaveState('保存中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }
  function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(); } }
  function setSaveState(t, bad) { els.saveState.textContent = t; els.saveState.classList.toggle('bad', !!bad); }

  function book() {
    return state.books.find(function (b) { return b.id === state.bookId; }) || state.books[0];
  }
  function chapter() {
    var b = book();
    return b.chapters.find(function (c) { return c.id === state.chapterId; }) || b.chapters[0];
  }

  // 网文字数：不计空白字符
  function count(s) { return s ? s.replace(/\s/g, '').length : 0; }
  function bookTotal(b) { return b.chapters.reduce(function (n, c) { return n + count(c.content); }, 0); }

  // ---------- 渲染 ----------
  function renderBooks() {
    els.bookSelect.innerHTML = '';
    state.books.forEach(function (b) {
      var o = document.createElement('option');
      o.value = b.id; o.textContent = b.title;
      els.bookSelect.appendChild(o);
    });
    els.bookSelect.value = book().id;
  }

  function renderChapters() {
    var b = book(), cur = chapter();
    els.chapters.innerHTML = '';
    b.chapters.forEach(function (c) {
      var li = document.createElement('li');
      li.dataset.id = c.id;
      if (c.id === cur.id) li.className = 'active';
      var t = document.createElement('span');
      t.className = 't';
      t.textContent = c.title.trim() || '（无标题）';
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = count(c.content);
      li.appendChild(t); li.appendChild(n);
      els.chapters.appendChild(li);
    });
    els.chapterTotal.textContent = b.chapters.length;
  }

  function renderEditor() {
    var c = chapter();
    state.chapterId = c.id;
    els.title.value = c.title;
    els.text.value = c.content;
    els.notesText.value = book().notes || '';
    lastLen = count(c.content);
    renderCounts();
    renderUpdated();
  }

  function renderCounts() {
    var c = chapter();
    els.chapterCount.textContent = count(c.content);
    els.bookCount.textContent = bookTotal(book());
    var t = state.daily[today()] || 0;
    els.todayCount.textContent = t;
    els.goal.textContent = state.goal;
    els.todayBar.style.width = Math.min(100, state.goal ? t / state.goal * 100 : 0) + '%';
    els.todayBar.parentNode.classList.toggle('done', t >= state.goal);
    var active = els.chapters.querySelector('li.active .n');
    if (active) active.textContent = count(c.content);
  }

  function renderUpdated() {
    var d = new Date(chapter().updated);
    els.updatedAt.textContent = '修改于 ' + d.toLocaleString('zh-CN', { hour12: false });
  }

  function applySettings() {
    document.documentElement.style.setProperty('--editor-size', state.fontSize + 'px');
    els.indentState.textContent = state.autoIndent ? '开' : '关';
    els.app.classList.toggle('side-closed', !state.sideOpen);
  }

  function renderAll() { renderBooks(); renderChapters(); renderEditor(); applySettings(); }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { els.toast.classList.remove('show'); }, 2200);
  }

  // ---------- 编辑 ----------
  var lastLen = 0;
  function onTextChange() {
    var c = chapter();
    c.content = els.text.value;
    c.updated = Date.now();
    var len = count(c.content);
    var delta = len - lastLen;
    lastLen = len;
    // 今日字数记净增量（删改会相应扣减，但不低于 0）
    var d = today();
    state.daily[d] = Math.max(0, (state.daily[d] || 0) + delta);
    renderCounts();
    renderUpdated();
    scheduleSave();
  }

  // 用 insertText 替换选区，保留浏览器的撤销记录
  function replaceText(start, end, str) {
    els.text.focus();
    els.text.setSelectionRange(start, end);
    var ok = false;
    try { ok = document.execCommand('insertText', false, str); } catch (e) { ok = false; }
    if (!ok) {
      var v = els.text.value;
      els.text.value = v.slice(0, start) + str + v.slice(end);
      els.text.setSelectionRange(start + str.length, start + str.length);
      onTextChange();
    }
  }

  els.text.addEventListener('input', onTextChange);
  els.text.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && state.autoIndent && !e.isComposing && !e.shiftKey) {
      e.preventDefault();
      replaceText(els.text.selectionStart, els.text.selectionEnd, '\n' + INDENT);
    }
  });
  els.text.addEventListener('focus', function () {
    if (!els.text.value && state.autoIndent) replaceText(0, 0, INDENT);
  });
  ['keyup', 'click', 'select'].forEach(function (ev) {
    els.text.addEventListener(ev, function () {
      var s = els.text.selectionStart, e = els.text.selectionEnd;
      var line = els.text.value.slice(0, s).split('\n').length;
      els.cursorPos.textContent = s !== e ? '已选 ' + count(els.text.value.slice(s, e)) + ' 字' : '第 ' + line + ' 行';
    });
  });

  els.title.addEventListener('input', function () {
    var c = chapter();
    c.title = els.title.value;
    c.updated = Date.now();
    var t = els.chapters.querySelector('li.active .t');
    if (t) t.textContent = c.title.trim() || '（无标题）';
    scheduleSave();
  });

  els.notesText.addEventListener('input', function () {
    book().notes = els.notesText.value;
    scheduleSave();
  });

  // ---------- 章节 ----------
  els.chapters.addEventListener('click', function (e) {
    var li = e.target.closest('li');
    if (!li) return;
    flush();
    state.chapterId = li.dataset.id;
    renderChapters(); renderEditor(); save();
    if (window.innerWidth < 800) { state.sideOpen = false; applySettings(); }
    els.text.focus();
  });

  $('new-chapter').addEventListener('click', function () {
    var b = book();
    var c = newChapter(b.chapters.length + 1);
    var i = b.chapters.findIndex(function (x) { return x.id === state.chapterId; });
    b.chapters.splice(i + 1, 0, c);
    state.chapterId = c.id;
    renderChapters(); renderEditor(); save();
    els.title.focus();
    els.title.setSelectionRange(els.title.value.length, els.title.value.length);
  });

  function moveChapter(dir) {
    var b = book();
    var i = b.chapters.findIndex(function (x) { return x.id === state.chapterId; });
    var j = i + dir;
    if (j < 0 || j >= b.chapters.length) return;
    var tmp = b.chapters[i]; b.chapters[i] = b.chapters[j]; b.chapters[j] = tmp;
    renderChapters(); save();
  }
  $('ch-up').addEventListener('click', function () { moveChapter(-1); });
  $('ch-down').addEventListener('click', function () { moveChapter(1); });

  $('ch-del').addEventListener('click', function () {
    var b = book(), c = chapter();
    if (!confirm('删除「' + (c.title.trim() || '无标题') + '」（' + count(c.content) + ' 字）？此操作无法撤销。')) return;
    var i = b.chapters.indexOf(c);
    b.chapters.splice(i, 1);
    if (!b.chapters.length) b.chapters.push(newChapter(1));
    state.chapterId = b.chapters[Math.max(0, i - 1)].id;
    renderChapters(); renderEditor(); save();
    toast('已删除');
  });

  // ---------- 作品 ----------
  els.bookSelect.addEventListener('change', function () {
    flush();
    state.bookId = els.bookSelect.value;
    state.chapterId = book().chapters[0].id;
    renderAll(); save();
  });

  function toggleMenu(menu, btn) {
    var open = menu.hidden;
    closeMenus();
    if (open) {
      var r = btn.getBoundingClientRect();
      menu.style.top = r.bottom + 4 + 'px';
      if (menu.classList.contains('right')) menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
      else menu.style.left = r.left + 'px';
      menu.hidden = false;
    }
  }
  function closeMenus() { els.bookMenu.hidden = true; els.moreMenu.hidden = true; }
  $('book-menu-btn').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(els.bookMenu, e.currentTarget); });
  $('more-btn').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(els.moreMenu, e.currentTarget); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu')) closeMenus(); });

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|]/g, '_');
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  var actions = {
    'new-book': function () {
      var t = prompt('新作品名称', '未命名作品');
      if (t === null) return;
      flush();
      var b = newBook(t.trim() || '未命名作品');
      state.books.push(b);
      state.bookId = b.id; state.chapterId = b.chapters[0].id;
      renderAll(); save();
    },
    'rename-book': function () {
      var b = book();
      var t = prompt('作品名称', b.title);
      if (t === null || !t.trim()) return;
      b.title = t.trim();
      renderBooks(); save();
    },
    'delete-book': function () {
      var b = book();
      if (!confirm('删除作品《' + b.title + '》及全部 ' + b.chapters.length + ' 章（' + bookTotal(b) + ' 字）？\n建议先导出备份。此操作无法撤销。')) return;
      state.books = state.books.filter(function (x) { return x.id !== b.id; });
      if (!state.books.length) state.books.push(newBook('未命名作品'));
      state.bookId = state.books[0].id; state.chapterId = state.books[0].chapters[0].id;
      renderAll(); save();
      toast('已删除作品');
    },
    'export-chapter': function () {
      flush();
      var c = chapter();
      download(book().title + ' - ' + (c.title.trim() || '无标题') + '.txt', c.title.trim() + '\n\n' + c.content + '\n');
    },
    'export-book': function () {
      flush();
      var b = book();
      var out = b.title + '\n\n\n' + b.chapters.map(function (c) {
        return c.title.trim() + '\n\n' + c.content.replace(/\s+$/, '');
      }).join('\n\n\n') + '\n';
      download(b.title + '.txt', out);
    },
    'backup': function () {
      flush();
      download('网文备份-' + today() + '.json', JSON.stringify(state, null, 2), 'application/json');
      toast('已导出备份');
    },
    'restore': function () { els.restoreInput.click(); },
    'font-down': function () { state.fontSize = Math.max(14, state.fontSize - 1); applySettings(); save(); },
    'font-up': function () { state.fontSize = Math.min(30, state.fontSize + 1); applySettings(); save(); },
    'toggle-indent': function () { state.autoIndent = !state.autoIndent; applySettings(); save(); },
    'set-goal': function () {
      var g = prompt('每日字数目标', state.goal);
      if (g === null) return;
      var n = parseInt(g, 10);
      if (n > 0) { state.goal = n; renderCounts(); save(); }
    }
  };
  document.querySelectorAll('.menu button').forEach(function (b) {
    b.addEventListener('click', function () {
      closeMenus();
      var fn = actions[b.dataset.act];
      if (fn) fn();
    });
  });
  $('today-box').addEventListener('click', actions['set-goal']);

  els.restoreInput.addEventListener('change', function () {
    var f = els.restoreInput.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var s = JSON.parse(r.result);
        if (!s || !Array.isArray(s.books) || !s.books.length) throw new Error('格式不对');
        if (!confirm('用备份中的 ' + s.books.length + ' 部作品覆盖当前全部数据？')) return;
        state = Object.assign(defaults(), s);
        renderAll(); save();
        toast('已恢复备份');
      } catch (e) {
        alert('无法读取备份文件：' + e.message);
      }
      els.restoreInput.value = '';
    };
    r.readAsText(f);
  });

  // ---------- 一键排版 ----------
  $('format-btn').addEventListener('click', function () {
    var paras = els.text.value.split(/\n+/)
      .map(function (p) { return p.replace(/^[\s　]+|[\s　]+$/g, ''); })
      .filter(Boolean);
    var out = paras.map(function (p) { return INDENT + p; }).join('\n');
    if (out === els.text.value) { toast('已经很整齐了'); return; }
    replaceText(0, els.text.value.length, out);
    toast('已排版（可 Ctrl+Z 撤销）');
  });

  // ---------- 查找替换 ----------
  var findFrom = 0;
  function openFind() {
    els.findbar.hidden = false;
    var sel = els.text.value.slice(els.text.selectionStart, els.text.selectionEnd);
    if (sel && sel.indexOf('\n') < 0) els.findInput.value = sel;
    els.findInput.focus(); els.findInput.select();
    updateFindCount();
  }
  function closeFind() { els.findbar.hidden = true; els.text.focus(); }
  function occurrences(hay, needle) { return needle ? hay.split(needle).length - 1 : 0; }
  function updateFindCount() {
    var q = els.findInput.value;
    if (!q) { els.findCount.textContent = ''; return; }
    var n = els.replaceBook.checked
      ? book().chapters.reduce(function (s, c) { return s + occurrences(c.content, q); }, 0)
      : occurrences(els.text.value, q);
    els.findCount.textContent = n + ' 处';
  }
  function findNext() {
    var q = els.findInput.value;
    if (!q) return;
    var v = els.text.value;
    var i = v.indexOf(q, findFrom);
    if (i < 0) i = v.indexOf(q);
    if (i < 0) { toast('本章没有找到'); return; }
    els.text.focus();
    els.text.setSelectionRange(i, i + q.length);
    // 滚动到选中位置
    var before = v.slice(0, i).split('\n').length;
    var lines = v.split('\n').length;
    els.text.scrollTop = Math.max(0, (before / lines) * els.text.scrollHeight - els.text.clientHeight / 2);
    findFrom = i + q.length;
  }
  function replaceAll() {
    var q = els.findInput.value, r = els.replaceInput.value;
    if (!q) return;
    var total = 0;
    if (els.replaceBook.checked) {
      if (!confirm('在全书所有章节中把「' + q + '」替换为「' + r + '」？')) return;
      book().chapters.forEach(function (c) {
        var n = occurrences(c.content, q);
        if (n && c.id !== chapter().id) { c.content = c.content.split(q).join(r); c.updated = Date.now(); }
        total += n;
      });
    } else {
      total = occurrences(els.text.value, q);
    }
    var curN = occurrences(els.text.value, q);
    if (curN) replaceText(0, els.text.value.length, els.text.value.split(q).join(r));
    renderChapters(); renderCounts(); save();
    updateFindCount();
    toast('已替换 ' + total + ' 处');
  }
  $('find-btn').addEventListener('click', openFind);
  $('find-close').addEventListener('click', closeFind);
  $('find-next').addEventListener('click', findNext);
  $('replace-all').addEventListener('click', replaceAll);
  els.findInput.addEventListener('input', function () { findFrom = 0; updateFindCount(); });
  els.replaceBook.addEventListener('change', updateFindCount);
  els.findInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); findNext(); }
  });

  // ---------- 面板与模式 ----------
  // 小屏上点正文区域收起章节栏
  document.querySelector('.main').addEventListener('click', function () {
    if (window.innerWidth < 800 && state.sideOpen) { state.sideOpen = false; applySettings(); }
  });
  $('toggle-side').addEventListener('click', function () { state.sideOpen = !state.sideOpen; applySettings(); save(); });
  $('notes-btn').addEventListener('click', function () { els.notes.hidden = !els.notes.hidden; if (!els.notes.hidden) els.notesText.focus(); });
  $('notes-close').addEventListener('click', function () { els.notes.hidden = true; });
  $('focus-btn').addEventListener('click', function () {
    els.app.classList.add('focus');
    els.text.focus();
    toast('专注模式，按 Esc 退出');
  });

  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flush(); save(); toast(storageOk ? '已保存' : '保存失败，请立即备份'); }
    else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    else if (e.key === 'Escape') {
      if (els.app.classList.contains('focus')) els.app.classList.remove('focus');
      else if (!els.findbar.hidden) closeFind();
      else if (!els.notes.hidden) els.notes.hidden = true;
      closeMenus();
    }
  });

  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  // 其他标签页修改了数据时同步
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    try { state = Object.assign(defaults(), JSON.parse(e.newValue)); renderAll(); toast('已同步其他标签页的修改'); } catch (err) { /* ignore */ }
  });

  if (window.innerWidth < 800) state.sideOpen = false;
  renderAll();
})();
