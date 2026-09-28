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
    toast: $('toast'), restoreInput: $('restore-input'), conflict: $('conflict')
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

  var state = defaults(); // 真正的数据在 init() 里从浏览器存储异步读出

  function valid(s) { return s && Array.isArray(s.books) && s.books.length; }
  function readLocalStorage(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // 两层保存：浏览器 IndexedDB 作即时缓存（容量远大于 localStorage 的 5MB）；
  // 关联了电脑文件时，再自动写入该文件。IndexedDB 不可用时退回 localStorage。
  var saveTimer = null;
  var storageOk = true;
  var useIdb = !!window.indexedDB;
  var PENDING = KEY + '-pending'; // 关页面时来不及写进 IndexedDB 的当前章节，临时放 localStorage
  var channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('wn-editor') : null;
  var tabId = uid();

  function loadState() {
    var fromLs = readLocalStorage(KEY);
    if (!useIdb) return Promise.resolve(valid(fromLs) ? fromLs : null);
    return idb('readonly', function (s) { return s.get('state'); }).then(function (s) {
      if (valid(s)) return s;
      if (!valid(fromLs)) return null;
      // 首次升级：把 localStorage 里的稿件搬进 IndexedDB，确认写好后再删掉旧的
      return idb('readwrite', function (st) { return st.put(fromLs, 'state'); }).then(function () {
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        return fromLs;
      });
    }, function () {
      useIdb = false; // 隐私模式等情况下 IndexedDB 打不开
      return valid(fromLs) ? fromLs : null;
    });
  }

  function saveLocal() {
    if (!useIdb) {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        storageOk = true;
      } catch (e) {
        storageOk = false;
      }
      return Promise.resolve(storageOk);
    }
    return idb('readwrite', function (s) { return s.put(state, 'state'); }).then(function () {
      storageOk = true;
      try { localStorage.removeItem(PENDING); } catch (e) { /* ignore */ }
      if (channel) channel.postMessage({ type: 'saved', from: tabId });
      return true;
    }, function () {
      storageOk = false;
      return false;
    }).then(function (ok) { renderSaveState(); return ok; });
  }
  function save() {
    saveTimer = null;
    if (!ready) return; // 稿件还没读出来，别用默认空稿覆盖它
    saveLocal();
    queueFileWrite();
    renderSaveState();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
    renderSaveState();
  }
  function flush() { if (saveTimer) { clearTimeout(saveTimer); save(); } }

  // 关闭页面时 IndexedDB 的异步写入不一定来得及完成，
  // 把正在写的章节（数据量小）同步存进 localStorage，下次打开时补回去
  function savePending() {
    if (!useIdb || !ready) return;
    var b = book(), c = chapter();
    try {
      localStorage.setItem(PENDING, JSON.stringify({
        bookId: b.id, notes: b.notes, chapterId: c.id, title: c.title, content: c.content, updated: c.updated
      }));
    } catch (e) { /* ignore */ }
  }
  function applyPending(s) {
    var p = readLocalStorage(PENDING);
    if (!p) return false;
    var b = s.books.find(function (x) { return x.id === p.bookId; });
    var c = b && b.chapters.find(function (x) { return x.id === p.chapterId; });
    if (!c || !(p.updated > c.updated)) return false;
    c.title = p.title; c.content = p.content; c.updated = p.updated;
    b.notes = p.notes;
    return true;
  }

  // 申请持久存储，降低浏览器在空间紧张或长期未访问时清掉稿件的可能
  var persistAsked = false;
  function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(function (p) { if (!p) return navigator.storage.persist(); }).catch(function () {});
    }
  }

  // ---------- 保存到电脑文件 ----------
  var fsSupported = typeof window.showSaveFilePicker === 'function';
  // known：上次读写该文件后它的 lastModified；conflict：待用户处理的版本冲突
  var file = { handle: null, dirty: false, writing: false, needPerm: false, timer: null, savedAt: null, known: null, conflict: null };
  var FILE_TYPES = [{ description: '网文稿件', accept: { 'application/json': ['.json'] } }];

  // IndexedDB 里存两样东西：稿件（state）和关联的文件句柄（file）
  var dbPromise = null;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open('wn-editor', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onerror = function () { reject(req.error); };
        req.onsuccess = function () {
          var db = req.result;
          db.onversionchange = function () { db.close(); dbPromise = null; };
          resolve(db);
        };
      });
      dbPromise.catch(function () { dbPromise = null; });
    }
    return dbPromise;
  }
  function idb(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, r;
        try {
          tx = db.transaction('kv', mode);
          r = fn(tx.objectStore('kv'));
        } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(r && r.result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('写入被中止')); }; // 空间不足时事务会被中止
      });
    });
  }
  function rememberHandle(h) {
    return idb('readwrite', function (s) { return h ? s.put(h, 'file') : s.delete('file'); }).catch(function () {});
  }

  function renderSaveState() {
    var t, cls = '';
    if (!storageOk && !file.handle) { t = '浏览器存储失败！请立即保存到文件'; cls = 'bad'; }
    else if (file.handle && file.conflict) { t = file.handle.name + ' 在别处被修改，请选择保留哪一份'; cls = 'bad'; }
    else if (file.handle && file.needPerm) { t = '点「保存」继续写入 ' + file.handle.name; cls = 'warn'; }
    else if (saveTimer || file.dirty || file.writing) { t = '保存中…'; }
    else if (file.handle) { t = '✓ 已存到 ' + file.handle.name + (file.savedAt ? ' · ' + file.savedAt : ''); cls = 'ok'; }
    else { t = '仅存于浏览器'; cls = 'warn'; }
    els.saveState.textContent = t;
    els.saveState.className = 'save-state ' + cls;
    els.saveState.title = file.handle
      ? '稿件会自动写入电脑上的「' + file.handle.name + '」'
      : '稿件目前只在这个浏览器里，点「保存」存到电脑文件更安全';
  }

  function queueFileWrite() {
    if (!file.handle) return;
    file.dirty = true;
    clearTimeout(file.timer);
    file.timer = setTimeout(writeFile, 1200);
  }

  // 读、写文件依次排队，避免“检查”读到写了一半的状态
  var fileChain = Promise.resolve();
  function serial(fn) {
    var p = fileChain.then(fn);
    fileChain = p.catch(function () {});
    return p;
  }

  // 防止旧稿覆盖新稿：每次写入文件都带一个版本号 syncRev，本地记住自己基于哪个版本。
  // 写之前先看文件：版本号对不上（在另一台电脑、另一个浏览器里写过）就不写，交给用户选择。
  // 返回 null 表示可以安全写入，否则返回冲突信息。
  function checkFile(h) {
    return h.getFile().then(function (f) {
      if (file.known !== null && f.lastModified === file.known) return null; // 上次读写之后没被动过
      if (!f.size) return null; // 刚新建的空文件
      return f.text().then(function (text) {
        var s = null;
        try { s = JSON.parse(text); } catch (e) { /* 内容无法识别，按冲突处理 */ }
        if (s && (!Array.isArray(s.books) || !s.books.length)) s = null;
        if (s && (s.syncRev || null) === (state.syncRev || null) && (s.syncRev || sameBooks(s, state))) {
          file.known = f.lastModified;
          return null;
        }
        // 版本号不同但内容一样（比如同一份稿件被复制过），直接接上文件的版本号
        if (s && sameBooks(s, state)) {
          state.syncRev = s.syncRev;
          saveLocal();
          file.known = f.lastModified;
          return null;
        }
        return { name: h.name, text: text, s: s, lastModified: f.lastModified };
      });
    });
  }
  function sameBooks(a, b) { return JSON.stringify(a.books) === JSON.stringify(b.books); }

  function writeFile() {
    if (!file.handle || file.needPerm || file.conflict) return Promise.resolve(false);
    return serial(doWriteFile);
  }
  function doWriteFile() {
    if (!file.handle || file.needPerm || file.conflict) return false;
    file.writing = true;
    file.dirty = false;
    renderSaveState();
    var h = file.handle;
    var rev = uid();
    return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
      if (p !== 'granted') { file.needPerm = true; file.dirty = true; return false; }
      return checkFile(h).then(function (c) {
        if (c) { file.dirty = true; showConflict(c); return false; }
        var data = JSON.stringify(Object.assign({}, state, { syncRev: rev }), null, 2);
        return h.createWritable().then(function (w) {
          return w.write(data).then(function () { return w.close(); });
        }).then(function () {
          state.syncRev = rev;
          saveLocal();
          file.savedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
          return h.getFile().then(function (f) { file.known = f.lastModified; }, function () { file.known = null; });
        }).then(function () { return true; });
      });
    }).catch(function (e) {
      file.dirty = true;
      toast('写入文件失败：' + e.message);
      return false;
    }).then(function (ok) {
      file.writing = false;
      renderSaveState();
      return ok;
    });
  }

  // 不写入，只看看文件有没有在别处被改过（打开编辑器、切回标签页时）
  function checkFileNow() {
    var h = file.handle;
    if (!h || file.conflict) return Promise.resolve();
    return serial(function () {
      if (file.handle !== h || file.conflict) return;
      return h.queryPermission({ mode: 'read' }).then(function (p) {
        if (p !== 'granted') return;
        return checkFile(h).then(function (c) { if (c) showConflict(c); });
      }).catch(function () {});
    });
  }

  // ---------- 版本冲突 ----------
  function summary(s) {
    var chars = 0, latest = 0;
    s.books.forEach(function (b) {
      b.chapters.forEach(function (c) {
        chars += count(c.content);
        if (c.updated > latest) latest = c.updated;
      });
    });
    return { books: s.books.length, chars: chars, latest: latest };
  }
  function describe(x) {
    return x.books + ' 部作品，共 ' + x.chars.toLocaleString('zh-CN') + ' 字' +
      (x.latest ? '，最后修改于 ' + new Date(x.latest).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  }

  function showConflict(c) {
    flush();
    file.conflict = c;
    var local = summary(state);
    var remote = c.s ? summary(c.s) : null;
    $('cf-name').textContent = c.name;
    $('cf-local-info').textContent = describe(local);
    $('cf-file-info').textContent = remote ? describe(remote) : '文件内容无法识别，不能载入';
    $('cf-file').disabled = !remote;
    // 标出最后修改时间更晚的一份
    var newer = remote && remote.latest > local.latest ? 'cf-file' : 'cf-local';
    $('cf-file').classList.toggle('newer', newer === 'cf-file');
    $('cf-local').classList.toggle('newer', newer === 'cf-local');
    renderSaveState();
    if (!els.conflict.open) els.conflict.showModal();
  }

  function stamp() {
    var d = new Date();
    return today() + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  }

  // 用文件里的版本：浏览器里的版本先下载成备份
  function useFileVersion() {
    var c = file.conflict;
    if (!c || !c.s) return;
    flush();
    download('浏览器版本备份-' + stamp() + '.json', JSON.stringify(state, null, 2), 'application/json');
    state = Object.assign(defaults(), c.s);
    file.known = c.lastModified;
    file.conflict = null;
    file.dirty = false;
    els.conflict.close();
    renderAll(); saveLocal(); renderSaveState();
    toast('已载入文件里的版本，浏览器里的旧版本已下载为备份');
  }

  // 用浏览器里的版本：文件里的版本先下载成备份，再覆盖文件
  function useLocalVersion() {
    var c = file.conflict;
    if (!c) return;
    var h = file.handle;
    // requestPermission 必须在用户点击中直接调用
    var perm = h.requestPermission({ mode: 'readwrite' });
    download('文件版本备份-' + stamp() + '.json', c.text, 'application/json');
    file.known = c.lastModified;
    file.conflict = null;
    els.conflict.close();
    perm.then(function (p) {
      if (p !== 'granted') { file.needPerm = true; renderSaveState(); toast('没有获得写入权限'); return; }
      file.needPerm = false;
      return writeFile().then(function (ok) { if (ok) toast('已用浏览器里的版本覆盖文件，文件里的旧版本已下载为备份'); });
    }).catch(function (e) { toast('保存失败：' + e.message); });
  }

  // 稍后决定：暂停写入文件，下次点「保存」时再检查
  function decideLater() {
    if (!file.conflict) return;
    file.conflict = null;
    file.needPerm = true;
    file.known = null;
    if (els.conflict.open) els.conflict.close();
    renderSaveState();
  }

  function linkFile(h) {
    file.handle = h; file.needPerm = false; file.savedAt = null; file.known = null; file.conflict = null;
    rememberHandle(h);
    // 「另存为」时用户已确认过替换所选文件，不再做冲突检查
    return h.getFile().then(function (f) { file.known = f.lastModified; }, function () {}).then(writeFile);
  }

  function saveAsNewFile(note) {
    if (!fsSupported) return downloadBackup(note);
    flush();
    return window.showSaveFilePicker({ suggestedName: '网文稿件.json', types: FILE_TYPES })
      .then(linkFile)
      .then(function (ok) { if (ok) toast(withNote('已保存到电脑文件，之后会自动保存到这里', note)); })
      .catch(function (e) { if (e.name !== 'AbortError') toast('保存失败：' + e.message); });
  }

  // 「保存」按钮 / Ctrl+S
  function saveNow(note) {
    flush();
    if (!fsSupported) return downloadBackup(note);
    if (!file.handle) return saveAsNewFile(note);
    if (file.conflict) { showConflict(file.conflict); return; }
    var h = file.handle;
    // requestPermission 必须在用户点击中直接调用
    return h.requestPermission({ mode: 'readwrite' }).then(function (p) {
      if (p !== 'granted') { toast('没有获得写入权限'); return; }
      file.needPerm = false;
      clearTimeout(file.timer);
      return writeFile().then(function (ok) { if (ok) toast(withNote('已保存到 ' + h.name, note)); });
    }).catch(function (e) { toast('保存失败：' + e.message); });
  }

  function openFromFile() {
    if (!fsSupported) { els.restoreInput.click(); return; }
    window.showOpenFilePicker({ types: FILE_TYPES }).then(function (hs) {
      var h = hs[0];
      var modified = null;
      return h.getFile().then(function (f) { modified = f.lastModified; return f.text(); }).then(function (text) {
        var s = JSON.parse(text);
        if (!s || !Array.isArray(s.books) || !s.books.length) throw new Error('不是网文稿件文件');
        if (!confirm('打开「' + h.name + '」（' + s.books.length + ' 部作品），替换编辑器里的当前内容？')) return;
        flush();
        state = Object.assign(defaults(), s);
        file.handle = h; file.needPerm = true; file.savedAt = null; file.known = modified; file.conflict = null;
        rememberHandle(h);
        renderAll(); save();
        toast('已打开，点一次「保存」授权后会自动写回这个文件');
      });
    }).catch(function (e) { if (e.name !== 'AbortError') alert('无法打开文件：' + e.message); });
  }

  function unlinkFile() {
    if (!file.handle) { toast('当前没有关联文件'); return; }
    var name = file.handle.name;
    file.handle = null; file.dirty = false; file.needPerm = false; file.known = null; file.conflict = null;
    clearTimeout(file.timer);
    rememberHandle(null);
    renderSaveState();
    toast('已取消关联「' + name + '」，文件本身不受影响');
  }

  function restoreHandle() {
    if (!fsSupported || !window.indexedDB) { renderSaveState(); return; }
    idb('readonly', function (s) { return s.get('file'); }).then(function (h) {
      if (!h) return;
      file.handle = h;
      return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
        file.needPerm = p !== 'granted';
      });
    }).catch(function () {}).then(function () {
      renderSaveState();
      // 能读就先看一眼文件，别让人在旧稿上继续写
      return checkFileNow();
    });
  }

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
    toast.t = setTimeout(function () { els.toast.classList.remove('show'); }, Math.min(5000, 2200 + msg.length * 40));
  }

  // ---------- 编辑 ----------
  var lastLen = 0;
  function onTextChange() {
    if (!ready) return;
    askPersist();
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
    if (!ready) return;
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

  function safeName(name) { return name.replace(/[\\/:*?"<>|]/g, '_'); }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeName(name);
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function downloadBackup(note) {
    flush();
    download('网文备份-' + today() + '.json', JSON.stringify(state, null, 2), 'application/json');
    toast(withNote(fsSupported ? '已下载备份' : '已下载备份文件（当前浏览器不支持直接写入文件，推荐用电脑版 Chrome / Edge）', note));
  }
  function withNote(msg, note) { return typeof note === 'string' && note ? msg + '；' + note : msg; }

  // ---------- 本章另存为 md ----------
  // 文件名：第几章-章节名-保存时间.md，如「第3章-风起云涌-20260929-1530.md」
  var CH_NO = /^\s*(第[0-9０-９零〇一二三四五六七八九十百千万两]+[章节回])\s*[:：、.．\-—_]*\s*/;
  function chapterMdName(b, c) {
    var title = c.title.trim();
    var m = title.match(CH_NO);
    var no = m ? m[1] : '第' + (b.chapters.indexOf(c) + 1) + '章';
    var name = (m ? title.slice(m[0].length) : title).trim() || '无标题';
    var d = new Date();
    var time = today().replace(/-/g, '') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    return safeName(no + '-' + name.replace(/\s+/g, ' ') + '-' + time + '.md');
  }
  function chapterMarkdown(c) {
    // Markdown 里单个换行不分段，段落之间空一行
    var paras = c.content.split('\n').filter(function (p) { return p.trim(); });
    return '# ' + (c.title.trim() || '无标题') + '\n\n' + paras.join('\n\n') + '\n';
  }
  function saveChapterMd() {
    var name = chapterMdName(book(), chapter());
    download(name, chapterMarkdown(chapter()), 'text/markdown;charset=utf-8');
    return name;
  }

  // 「保存」按钮 / Ctrl+S：保存整部稿件，同时把本章另存为 md
  function saveClick() {
    flush();
    var note = '本章已另存为 ' + saveChapterMd();
    toast(note);
    return saveNow(note);
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
    'save-as': saveAsNewFile,
    'open-file': openFromFile,
    'unlink-file': unlinkFile,
    'backup': downloadBackup,
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
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveClick(); }
    else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    else if (e.key === 'Escape') {
      if (els.app.classList.contains('focus')) els.app.classList.remove('focus');
      else if (!els.findbar.hidden) closeFind();
      else if (!els.notes.hidden) els.notes.hidden = true;
      closeMenus();
    }
  });

  $('save-btn').addEventListener('click', saveClick);

  window.addEventListener('beforeunload', function (e) {
    flush();
    savePending();
    // 还有内容没写进电脑文件时，关闭前提醒
    if (file.handle && (file.dirty || file.writing || file.needPerm)) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', function () { flush(); savePending(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { flush(); savePending(); }
    else checkFileNow(); // 切回来时，文件可能已在别处被改过
  });

  $('cf-file').addEventListener('click', useFileVersion);
  $('cf-local').addEventListener('click', useLocalVersion);
  $('cf-later').addEventListener('click', decideLater);
  els.conflict.addEventListener('cancel', function (e) { e.preventDefault(); decideLater(); });

  // 其他标签页修改了数据时同步（IndexedDB 模式靠 BroadcastChannel 通知，localStorage 模式靠 storage 事件）
  function syncFromOtherTab(s) {
    if (!valid(s)) return;
    state = Object.assign(defaults(), s);
    renderAll();
    toast('已同步其他标签页的修改');
  }
  if (channel) {
    channel.onmessage = function (e) {
      if (!ready || !useIdb || !e.data || e.data.type !== 'saved' || e.data.from === tabId) return;
      idb('readonly', function (s) { return s.get('state'); }).then(syncFromOtherTab, function () {});
    };
  }
  window.addEventListener('storage', function (e) {
    if (useIdb || e.key !== KEY || !e.newValue) return;
    try { syncFromOtherTab(JSON.parse(e.newValue)); } catch (err) { /* ignore */ }
  });

  // ---------- 启动 ----------
  var ready = false;
  if (!fsSupported) document.querySelectorAll('.fs-only').forEach(function (el) { el.hidden = true; });
  // 稿件读出来之前不允许输入，免得写进默认的空白稿
  els.text.readOnly = true; els.title.readOnly = true;
  loadState().then(function (s) {
    if (s) state = Object.assign(defaults(), s);
    var recovered = applyPending(state);
    if (window.innerWidth < 800) state.sideOpen = false;
    ready = true;
    els.text.readOnly = false; els.title.readOnly = false;
    renderAll();
    if (recovered) { saveLocal(); toast('已找回上次关闭页面前未保存的内容'); }
    else if (!useIdb) renderSaveState();
    restoreHandle();
  });
})();
