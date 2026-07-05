// Lightweight localization (no build step, no dependencies).
//
// Static HTML opts in with data-i18n (textContent), data-i18n-title
// (title + aria-label), data-i18n-placeholder. Dynamic strings use t(key,
// vars). Language comes from localStorage "mw-lang", else the browser;
// setLang() persists and reloads (UI strings are cheap to re-render that way).
//
// Translations are machine-drafted (Saga, 2026-07) — native-speaker review
// welcome; corrections are one-line PRs. Server-emitted strings (API errors)
// are not yet localized.

export const LANGS = {
  en: "English",
  es: "Español",
  zh: "中文",
  hi: "हिन्दी",
  ar: "العربية",
  pt: "Português",
  fr: "Français",
  ru: "Русский",
  ja: "日本語",
  de: "Deutsch",
  ko: "한국어",
  it: "Italiano",
};

const RTL = new Set(["ar"]);

const S = {
  // -- shared chrome --
  "nav.allDocs": {
    en: "All docs", es: "Todos los documentos", zh: "所有文档", hi: "सभी दस्तावेज़", ar: "كل المستندات",
    pt: "Todos os documentos", fr: "Tous les documents", ru: "Все документы", ja: "すべてのドキュメント",
    de: "Alle Dokumente", ko: "모든 문서", it: "Tutti i documenti",
  },
  "nav.agentKeys": {
    en: "Agent keys", es: "Claves de agente", zh: "智能体密钥", hi: "एजेंट कुंजियाँ", ar: "مفاتيح الوكلاء",
    pt: "Chaves de agente", fr: "Clés d'agent", ru: "Ключи агентов", ja: "エージェントキー",
    de: "Agentenschlüssel", ko: "에이전트 키", it: "Chiavi agente",
  },
  "nav.signOut": {
    en: "Sign out", es: "Cerrar sesión", zh: "退出登录", hi: "साइन आउट", ar: "تسجيل الخروج",
    pt: "Sair", fr: "Se déconnecter", ru: "Выйти", ja: "サインアウト",
    de: "Abmelden", ko: "로그아웃", it: "Esci",
  },
  "nav.switchLight": {
    en: "Switch to light mode", es: "Cambiar a modo claro", zh: "切换到浅色模式", hi: "लाइट मोड पर जाएँ",
    ar: "التبديل إلى الوضع الفاتح", pt: "Mudar para modo claro", fr: "Passer en mode clair",
    ru: "Светлая тема", ja: "ライトモードに切り替え", de: "Zum hellen Modus wechseln",
    ko: "라이트 모드로 전환", it: "Passa al tema chiaro",
  },
  "nav.switchDark": {
    en: "Switch to dark mode", es: "Cambiar a modo oscuro", zh: "切换到深色模式", hi: "डार्क मोड पर जाएँ",
    ar: "التبديل إلى الوضع الداكن", pt: "Mudar para modo escuro", fr: "Passer en mode sombre",
    ru: "Тёмная тема", ja: "ダークモードに切り替え", de: "Zum dunklen Modus wechseln",
    ko: "다크 모드로 전환", it: "Passa al tema scuro",
  },
  "nav.language": {
    en: "Language", es: "Idioma", zh: "语言", hi: "भाषा", ar: "اللغة",
    pt: "Idioma", fr: "Langue", ru: "Язык", ja: "言語", de: "Sprache", ko: "언어", it: "Lingua",
  },

  // -- doc list --
  "list.searchPlaceholder": {
    en: "Search docs…", es: "Buscar documentos…", zh: "搜索文档…", hi: "दस्तावेज़ खोजें…", ar: "البحث في المستندات…",
    pt: "Pesquisar documentos…", fr: "Rechercher des documents…", ru: "Поиск документов…", ja: "ドキュメントを検索…",
    de: "Dokumente durchsuchen…", ko: "문서 검색…", it: "Cerca documenti…",
  },
  "list.newDoc": {
    en: "New doc", es: "Nuevo documento", zh: "新建文档", hi: "नया दस्तावेज़", ar: "مستند جديد",
    pt: "Novo documento", fr: "Nouveau document", ru: "Новый документ", ja: "新しいドキュメント",
    de: "Neues Dokument", ko: "새 문서", it: "Nuovo documento",
  },
  "list.noMatch": {
    en: "No docs match.", es: "Ningún documento coincide.", zh: "没有匹配的文档。", hi: "कोई दस्तावेज़ मेल नहीं खाता।",
    ar: "لا توجد مستندات مطابقة.", pt: "Nenhum documento corresponde.", fr: "Aucun document ne correspond.",
    ru: "Ничего не найдено.", ja: "一致するドキュメントがありません。", de: "Keine Dokumente gefunden.",
    ko: "일치하는 문서가 없습니다.", it: "Nessun documento corrisponde.",
  },
  "list.empty": {
    en: "No docs yet — create one.", es: "Aún no hay documentos: crea uno.", zh: "还没有文档——创建一个吧。",
    hi: "अभी कोई दस्तावेज़ नहीं — एक बनाएँ।", ar: "لا توجد مستندات بعد — أنشئ واحدًا.",
    pt: "Ainda não há documentos — crie um.", fr: "Pas encore de documents — créez-en un.",
    ru: "Документов пока нет — создайте первый.", ja: "まだドキュメントがありません。作成しましょう。",
    de: "Noch keine Dokumente — lege eines an.", ko: "아직 문서가 없습니다. 하나 만들어 보세요.",
    it: "Nessun documento ancora: creane uno.",
  },
  "list.delete": {
    en: "Delete", es: "Eliminar", zh: "删除", hi: "हटाएँ", ar: "حذف",
    pt: "Excluir", fr: "Supprimer", ru: "Удалить", ja: "削除", de: "Löschen", ko: "삭제", it: "Elimina",
  },
  "list.deleteConfirm": {
    en: 'Delete "{title}"? This cannot be undone.', es: '¿Eliminar «{title}»? No se puede deshacer.',
    zh: "删除“{title}”？此操作无法撤销。", hi: '"{title}" हटाएँ? इसे पूर्ववत नहीं किया जा सकता।',
    ar: "أتريد حذف «{title}»؟ لا يمكن التراجع عن ذلك.", pt: 'Excluir "{title}"? Isso não pode ser desfeito.',
    fr: "Supprimer « {title} » ? Cette action est irréversible.", ru: "Удалить «{title}»? Это действие необратимо.",
    ja: "「{title}」を削除しますか？元に戻せません。", de: "„{title}“ löschen? Das kann nicht rückgängig gemacht werden.",
    ko: '"{title}"을(를) 삭제할까요? 되돌릴 수 없습니다.', it: 'Eliminare "{title}"? L\'operazione è irreversibile.',
  },
  "list.updated": {
    en: "updated {ago}", es: "actualizado {ago}", zh: "更新于{ago}", hi: "{ago} अपडेट हुआ",
    ar: "آخر تحديث {ago}", pt: "atualizado {ago}", fr: "mis à jour {ago}", ru: "обновлено {ago}",
    ja: "{ago}に更新", de: "aktualisiert {ago}", ko: "{ago} 업데이트됨", it: "aggiornato {ago}",
  },
  "list.shared": {
    en: "shared: {access}", es: "compartido: {access}", zh: "共享：{access}", hi: "साझा: {access}",
    ar: "مشترك: {access}", pt: "compartilhado: {access}", fr: "partagé : {access}", ru: "доступ: {access}",
    ja: "共有：{access}", de: "geteilt: {access}", ko: "공유됨: {access}", it: "condiviso: {access}",
  },

  // -- agent keys dialog --
  "keys.explainer": {
    en: "API keys let agents read, edit, and comment. The label names the agent — its edits appear under that name, live.",
    es: "Las claves API permiten a los agentes leer, editar y comentar. La etiqueta nombra al agente: sus ediciones aparecen con ese nombre, en vivo.",
    zh: "API 密钥允许智能体阅读、编辑和评论。标签即智能体的名字——它的编辑会以该名字实时显示。",
    hi: "API कुंजियाँ एजेंटों को पढ़ने, संपादित करने और टिप्पणी करने देती हैं। लेबल एजेंट का नाम है — उसके संपादन उसी नाम से लाइव दिखते हैं।",
    ar: "تتيح مفاتيح API للوكلاء القراءة والتحرير والتعليق. التسمية هي اسم الوكيل — وتظهر تعديلاته بهذا الاسم مباشرة.",
    pt: "As chaves de API permitem que agentes leiam, editem e comentem. O rótulo nomeia o agente — suas edições aparecem sob esse nome, ao vivo.",
    fr: "Les clés API permettent aux agents de lire, modifier et commenter. Le libellé nomme l'agent — ses modifications apparaissent sous ce nom, en direct.",
    ru: "API-ключи позволяют агентам читать, редактировать и комментировать. Метка — это имя агента: его правки появляются под этим именем в реальном времени.",
    ja: "APIキーでエージェントが閲覧・編集・コメントできます。ラベルはエージェントの名前で、編集はその名前でライブ表示されます。",
    de: "API-Schlüssel erlauben Agenten zu lesen, zu bearbeiten und zu kommentieren. Das Label benennt den Agenten — seine Änderungen erscheinen live unter diesem Namen.",
    ko: "API 키로 에이전트가 읽기·편집·댓글을 할 수 있습니다. 라벨은 에이전트의 이름이며, 편집 내용이 그 이름으로 실시간 표시됩니다.",
    it: "Le chiavi API permettono agli agenti di leggere, modificare e commentare. L'etichetta dà il nome all'agente: le sue modifiche appaiono con quel nome, in tempo reale.",
  },
  "keys.labelPlaceholder": {
    en: "Agent name (e.g. Saga)", es: "Nombre del agente (p. ej., Saga)", zh: "智能体名称（如 Saga）",
    hi: "एजेंट का नाम (जैसे Saga)", ar: "اسم الوكيل (مثل Saga)", pt: "Nome do agente (ex.: Saga)",
    fr: "Nom de l'agent (p. ex. Saga)", ru: "Имя агента (напр., Saga)", ja: "エージェント名（例：Saga）",
    de: "Agentenname (z. B. Saga)", ko: "에이전트 이름 (예: Saga)", it: "Nome dell'agente (es. Saga)",
  },
  "keys.create": {
    en: "Create", es: "Crear", zh: "创建", hi: "बनाएँ", ar: "إنشاء",
    pt: "Criar", fr: "Créer", ru: "Создать", ja: "作成", de: "Erstellen", ko: "생성", it: "Crea",
  },
  "keys.revealNote": {
    en: "Copy this key now — it won't be shown again:", es: "Copia esta clave ahora: no volverá a mostrarse:",
    zh: "请立即复制此密钥——它不会再次显示：", hi: "यह कुंजी अभी कॉपी करें — यह दोबारा नहीं दिखेगी:",
    ar: "انسخ هذا المفتاح الآن — لن يظهر مرة أخرى:", pt: "Copie esta chave agora — ela não será mostrada de novo:",
    fr: "Copiez cette clé maintenant — elle ne sera plus affichée :", ru: "Скопируйте ключ сейчас — он больше не будет показан:",
    ja: "このキーを今コピーしてください。再表示されません：", de: "Diesen Schlüssel jetzt kopieren — er wird nicht erneut angezeigt:",
    ko: "이 키를 지금 복사하세요. 다시 표시되지 않습니다:", it: "Copia questa chiave ora: non verrà mostrata di nuovo:",
  },
  "keys.close": {
    en: "Close", es: "Cerrar", zh: "关闭", hi: "बंद करें", ar: "إغلاق",
    pt: "Fechar", fr: "Fermer", ru: "Закрыть", ja: "閉じる", de: "Schließen", ko: "닫기", it: "Chiudi",
  },
  "keys.none": {
    en: "No agent keys yet.", es: "Aún no hay claves de agente.", zh: "还没有智能体密钥。", hi: "अभी कोई एजेंट कुंजी नहीं।",
    ar: "لا توجد مفاتيح وكلاء بعد.", pt: "Ainda não há chaves de agente.", fr: "Pas encore de clés d'agent.",
    ru: "Ключей агентов пока нет.", ja: "エージェントキーはまだありません。", de: "Noch keine Agentenschlüssel.",
    ko: "아직 에이전트 키가 없습니다.", it: "Nessuna chiave agente ancora.",
  },
  "keys.revoke": {
    en: "Revoke", es: "Revocar", zh: "撤销", hi: "रद्द करें", ar: "إلغاء",
    pt: "Revogar", fr: "Révoquer", ru: "Отозвать", ja: "無効化", de: "Widerrufen", ko: "취소", it: "Revoca",
  },
  "keys.revokeConfirm": {
    en: 'Revoke key "{label}"?', es: '¿Revocar la clave «{label}»?', zh: "撤销密钥“{label}”？",
    hi: 'कुंजी "{label}" रद्द करें?', ar: "أتريد إلغاء المفتاح «{label}»؟", pt: 'Revogar a chave "{label}"?',
    fr: "Révoquer la clé « {label} » ?", ru: "Отозвать ключ «{label}»?", ja: "キー「{label}」を無効化しますか？",
    de: "Schlüssel „{label}“ widerrufen?", ko: '키 "{label}"을(를) 취소할까요?', it: 'Revocare la chiave "{label}"?',
  },

  // -- editor --
  "editor.untitled": {
    en: "untitled", es: "sin título", zh: "无标题", hi: "अनाम", ar: "بدون عنوان",
    pt: "sem título", fr: "sans titre", ru: "без названия", ja: "無題", de: "unbenannt", ko: "제목 없음", it: "senza titolo",
  },
  "editor.writeMarkdown": {
    en: "Write markdown…", es: "Escribe markdown…", zh: "编写 Markdown…", hi: "मार्कडाउन लिखें…",
    ar: "اكتب ماركداون…", pt: "Escreva markdown…", fr: "Écrivez du markdown…", ru: "Пишите markdown…",
    ja: "Markdownを書く…", de: "Markdown schreiben…", ko: "마크다운 작성…", it: "Scrivi markdown…",
  },
  "editor.shareExport": {
    en: "Share & export", es: "Compartir y exportar", zh: "共享与导出", hi: "साझा और निर्यात",
    ar: "المشاركة والتصدير", pt: "Compartilhar e exportar", fr: "Partager et exporter",
    ru: "Поделиться и экспорт", ja: "共有とエクスポート", de: "Teilen & Exportieren", ko: "공유 및 내보내기", it: "Condividi ed esporta",
  },
  "editor.private": {
    en: "Private", es: "Privado", zh: "私密", hi: "निजी", ar: "خاص",
    pt: "Privado", fr: "Privé", ru: "Личный", ja: "非公開", de: "Privat", ko: "비공개", it: "Privato",
  },
  "editor.shareView": {
    en: "Share: view", es: "Compartir: ver", zh: "共享：查看", hi: "साझा: देखें", ar: "مشاركة: عرض",
    pt: "Compartilhar: ver", fr: "Partager : lecture", ru: "Доступ: просмотр", ja: "共有：閲覧",
    de: "Teilen: ansehen", ko: "공유: 보기", it: "Condividi: visualizza",
  },
  "editor.shareComment": {
    en: "Share: comment", es: "Compartir: comentar", zh: "共享：评论", hi: "साझा: टिप्पणी", ar: "مشاركة: تعليق",
    pt: "Compartilhar: comentar", fr: "Partager : commentaire", ru: "Доступ: комментарии", ja: "共有：コメント",
    de: "Teilen: kommentieren", ko: "공유: 댓글", it: "Condividi: commenta",
  },
  "editor.shareEdit": {
    en: "Share: edit", es: "Compartir: editar", zh: "共享：编辑", hi: "साझा: संपादन", ar: "مشاركة: تحرير",
    pt: "Compartilhar: editar", fr: "Partager : édition", ru: "Доступ: правка", ja: "共有：編集",
    de: "Teilen: bearbeiten", ko: "공유: 편집", it: "Condividi: modifica",
  },
  "editor.copyLink": {
    en: "Copy link", es: "Copiar enlace", zh: "复制链接", hi: "लिंक कॉपी करें", ar: "نسخ الرابط",
    pt: "Copiar link", fr: "Copier le lien", ru: "Копировать ссылку", ja: "リンクをコピー",
    de: "Link kopieren", ko: "링크 복사", it: "Copia link",
  },
  "editor.copied": {
    en: "Copied!", es: "¡Copiado!", zh: "已复制！", hi: "कॉपी हो गया!", ar: "تم النسخ!",
    pt: "Copiado!", fr: "Copié !", ru: "Скопировано!", ja: "コピーしました！", de: "Kopiert!", ko: "복사됨!", it: "Copiato!",
  },
  "editor.downloadMd": {
    en: "Download .md", es: "Descargar .md", zh: "下载 .md", hi: ".md डाउनलोड करें", ar: "تنزيل ‎.md",
    pt: "Baixar .md", fr: "Télécharger .md", ru: "Скачать .md", ja: ".mdをダウンロード",
    de: ".md herunterladen", ko: ".md 다운로드", it: "Scarica .md",
  },
  "editor.lineNumbers": {
    en: "Line numbers", es: "Números de línea", zh: "行号", hi: "पंक्ति संख्या", ar: "أرقام الأسطر",
    pt: "Números de linha", fr: "Numéros de ligne", ru: "Номера строк", ja: "行番号",
    de: "Zeilennummern", ko: "줄 번호", it: "Numeri di riga",
  },
  "editor.modeEdit": {
    en: "Edit", es: "Editar", zh: "编辑", hi: "संपादन", ar: "تحرير",
    pt: "Editar", fr: "Éditer", ru: "Правка", ja: "編集", de: "Bearbeiten", ko: "편집", it: "Modifica",
  },
  "editor.modeSplit": {
    en: "Split", es: "Dividido", zh: "分栏", hi: "विभाजित", ar: "مقسّم",
    pt: "Dividido", fr: "Scindé", ru: "Оба", ja: "分割", de: "Geteilt", ko: "분할", it: "Diviso",
  },
  "editor.modeRead": {
    en: "Read", es: "Leer", zh: "阅读", hi: "पढ़ें", ar: "قراءة",
    pt: "Ler", fr: "Lire", ru: "Чтение", ja: "閲覧", de: "Lesen", ko: "읽기", it: "Leggi",
  },
  "editor.comments": {
    en: "Comments", es: "Comentarios", zh: "评论", hi: "टिप्पणियाँ", ar: "التعليقات",
    pt: "Comentários", fr: "Commentaires", ru: "Комментарии", ja: "コメント", de: "Kommentare", ko: "댓글", it: "Commenti",
  },
  "editor.commentOnSelection": {
    en: "Comment on selection", es: "Comentar la selección", zh: "评论所选内容", hi: "चयन पर टिप्पणी करें",
    ar: "التعليق على التحديد", pt: "Comentar a seleção", fr: "Commenter la sélection",
    ru: "Комментировать выделенное", ja: "選択範囲にコメント", de: "Auswahl kommentieren",
    ko: "선택 영역에 댓글", it: "Commenta la selezione",
  },
  "editor.noComments": {
    en: "No comments yet.", es: "Aún no hay comentarios.", zh: "还没有评论。", hi: "अभी कोई टिप्पणी नहीं।",
    ar: "لا توجد تعليقات بعد.", pt: "Ainda não há comentários.", fr: "Pas encore de commentaires.",
    ru: "Комментариев пока нет.", ja: "コメントはまだありません。", de: "Noch keine Kommentare.",
    ko: "아직 댓글이 없습니다.", it: "Nessun commento ancora.",
  },
  "editor.reply": {
    en: "Reply", es: "Responder", zh: "回复", hi: "जवाब दें", ar: "رد",
    pt: "Responder", fr: "Répondre", ru: "Ответить", ja: "返信", de: "Antworten", ko: "답글", it: "Rispondi",
  },
  "editor.resolve": {
    en: "Resolve", es: "Resolver", zh: "解决", hi: "हल करें", ar: "حل",
    pt: "Resolver", fr: "Résoudre", ru: "Решено", ja: "解決", de: "Erledigen", ko: "해결", it: "Risolvi",
  },
  "editor.reopen": {
    en: "Reopen", es: "Reabrir", zh: "重新打开", hi: "फिर खोलें", ar: "إعادة فتح",
    pt: "Reabrir", fr: "Rouvrir", ru: "Открыть снова", ja: "再開", de: "Wieder öffnen", ko: "다시 열기", it: "Riapri",
  },
  "editor.jumpToText": {
    en: "Jump to text", es: "Ir al texto", zh: "跳转到文本", hi: "पाठ पर जाएँ", ar: "الانتقال إلى النص",
    pt: "Ir para o texto", fr: "Aller au texte", ru: "К тексту", ja: "本文へ移動",
    de: "Zum Text springen", ko: "본문으로 이동", it: "Vai al testo",
  },
  "editor.replyPrompt": {
    en: "Reply:", es: "Respuesta:", zh: "回复：", hi: "जवाब:", ar: "الرد:",
    pt: "Resposta:", fr: "Réponse :", ru: "Ответ:", ja: "返信：", de: "Antwort:", ko: "답글:", it: "Risposta:",
  },
  "editor.commentPrompt": {
    en: 'Comment on:\n"{quote}"', es: 'Comentar:\n«{quote}»', zh: "评论：\n“{quote}”", hi: 'टिप्पणी करें:\n"{quote}"',
    ar: "التعليق على:\n«{quote}»", pt: 'Comentar:\n"{quote}"', fr: "Commenter :\n« {quote} »",
    ru: "Комментарий к:\n«{quote}»", ja: "コメント対象：\n「{quote}」", de: "Kommentar zu:\n„{quote}“",
    ko: '다음에 댓글:\n"{quote}"', it: 'Commenta:\n"{quote}"',
  },
  "editor.selectSomeText": {
    en: "Select some text to comment on.", es: "Selecciona texto para comentar.", zh: "请先选择要评论的文本。",
    hi: "टिप्पणी के लिए कुछ पाठ चुनें।", ar: "حدد نصًا للتعليق عليه.", pt: "Selecione um texto para comentar.",
    fr: "Sélectionnez du texte à commenter.", ru: "Выделите текст для комментария.",
    ja: "コメントするテキストを選択してください。", de: "Text zum Kommentieren auswählen.",
    ko: "댓글을 달 텍스트를 선택하세요.", it: "Seleziona del testo da commentare.",
  },
  "editor.deleteThread": {
    en: "Delete this thread?", es: "¿Eliminar este hilo?", zh: "删除此评论串？", hi: "यह थ्रेड हटाएँ?",
    ar: "أتريد حذف هذا النقاش؟", pt: "Excluir esta conversa?", fr: "Supprimer ce fil ?",
    ru: "Удалить эту ветку?", ja: "このスレッドを削除しますか？", de: "Diesen Thread löschen?",
    ko: "이 스레드를 삭제할까요?", it: "Eliminare questa discussione?",
  },
  "editor.docNotFound": {
    en: "Document not found.", es: "Documento no encontrado.", zh: "未找到文档。", hi: "दस्तावेज़ नहीं मिला।",
    ar: "المستند غير موجود.", pt: "Documento não encontrado.", fr: "Document introuvable.",
    ru: "Документ не найден.", ja: "ドキュメントが見つかりません。", de: "Dokument nicht gefunden.",
    ko: "문서를 찾을 수 없습니다.", it: "Documento non trovato.",
  },
  "editor.dragResize": {
    en: "Drag to resize", es: "Arrastra para cambiar el tamaño", zh: "拖动以调整大小", hi: "आकार बदलने के लिए खींचें",
    ar: "اسحب لتغيير الحجم", pt: "Arraste para redimensionar", fr: "Faites glisser pour redimensionner",
    ru: "Перетащите, чтобы изменить размер", ja: "ドラッグしてサイズ変更", de: "Zum Anpassen ziehen",
    ko: "드래그하여 크기 조절", it: "Trascina per ridimensionare",
  },

  // -- share page --
  "shareView.sharedDoc": {
    en: "Shared doc", es: "Documento compartido", zh: "共享文档", hi: "साझा दस्तावेज़", ar: "مستند مشترك",
    pt: "Documento compartilhado", fr: "Document partagé", ru: "Общий документ", ja: "共有ドキュメント",
    de: "Geteiltes Dokument", ko: "공유된 문서", it: "Documento condiviso",
  },
  "shareView.notFound": {
    en: "Not found", es: "No encontrado", zh: "未找到", hi: "नहीं मिला", ar: "غير موجود",
    pt: "Não encontrado", fr: "Introuvable", ru: "Не найдено", ja: "見つかりません", de: "Nicht gefunden",
    ko: "찾을 수 없음", it: "Non trovato",
  },
  "shareView.notFoundBody": {
    en: "This shared doc doesn't exist, or sharing was turned off.",
    es: "Este documento compartido no existe o se desactivó el uso compartido.",
    zh: "此共享文档不存在，或共享已关闭。", hi: "यह साझा दस्तावेज़ मौजूद नहीं है, या साझा करना बंद कर दिया गया है।",
    ar: "هذا المستند المشترك غير موجود، أو تم إيقاف المشاركة.",
    pt: "Este documento compartilhado não existe ou o compartilhamento foi desativado.",
    fr: "Ce document partagé n'existe pas, ou le partage a été désactivé.",
    ru: "Этот общий документ не существует, или доступ был отключён.",
    ja: "この共有ドキュメントは存在しないか、共有が無効になっています。",
    de: "Dieses geteilte Dokument existiert nicht, oder das Teilen wurde deaktiviert.",
    ko: "이 공유 문서는 존재하지 않거나 공유가 해제되었습니다.",
    it: "Questo documento condiviso non esiste o la condivisione è stata disattivata.",
  },
  "shareView.setName": {
    en: "Set your name", es: "Pon tu nombre", zh: "设置你的名字", hi: "अपना नाम सेट करें", ar: "حدد اسمك",
    pt: "Defina seu nome", fr: "Définir votre nom", ru: "Укажите имя", ja: "名前を設定",
    de: "Namen festlegen", ko: "이름 설정", it: "Imposta il tuo nome",
  },
  "shareView.whoAreYou": {
    en: "Who are you?", es: "¿Quién eres?", zh: "你是谁？", hi: "आप कौन हैं?", ar: "من أنت؟",
    pt: "Quem é você?", fr: "Qui êtes-vous ?", ru: "Кто вы?", ja: "あなたは誰ですか？",
    de: "Wer bist du?", ko: "누구신가요?", it: "Chi sei?",
  },
  "shareView.nameShown": {
    en: "Your name is shown with your comments and edits.",
    es: "Tu nombre aparece junto a tus comentarios y ediciones.",
    zh: "你的名字会显示在你的评论和编辑旁。", hi: "आपका नाम आपकी टिप्पणियों और संपादनों के साथ दिखता है।",
    ar: "يظهر اسمك مع تعليقاتك وتعديلاتك.", pt: "Seu nome aparece com seus comentários e edições.",
    fr: "Votre nom apparaît avec vos commentaires et modifications.",
    ru: "Ваше имя отображается рядом с комментариями и правками.",
    ja: "あなたの名前はコメントや編集と共に表示されます。",
    de: "Dein Name erscheint bei deinen Kommentaren und Änderungen.",
    ko: "이름은 댓글과 편집 내용과 함께 표시됩니다.", it: "Il tuo nome appare con i tuoi commenti e le tue modifiche.",
  },
  "shareView.yourName": {
    en: "Your name", es: "Tu nombre", zh: "你的名字", hi: "आपका नाम", ar: "اسمك",
    pt: "Seu nome", fr: "Votre nom", ru: "Ваше имя", ja: "あなたの名前", de: "Dein Name", ko: "이름", it: "Il tuo nome",
  },
  "shareView.join": {
    en: "Join", es: "Unirse", zh: "加入", hi: "शामिल हों", ar: "انضمام",
    pt: "Entrar", fr: "Rejoindre", ru: "Войти", ja: "参加", de: "Beitreten", ko: "참여", it: "Entra",
  },

  // -- login --
  "login.tagline": {
    en: "Where people and agents meet in a document.",
    es: "Donde personas y agentes se encuentran en un documento.",
    zh: "人与智能体在文档中相遇的地方。", hi: "जहाँ लोग और एजेंट एक दस्तावेज़ में मिलते हैं।",
    ar: "حيث يلتقي الناس والوكلاء داخل مستند.",
    pt: "Onde pessoas e agentes se encontram em um documento.",
    fr: "Où humains et agents se retrouvent dans un document.",
    ru: "Где люди и агенты встречаются в документе.",
    ja: "人とエージェントがドキュメントで出会う場所。",
    de: "Wo Menschen und Agenten sich in einem Dokument begegnen.",
    ko: "사람과 에이전트가 문서에서 만나는 곳.",
    it: "Dove persone e agenti si incontrano in un documento.",
  },
  "login.setupToken": {
    en: "Setup token", es: "Token de configuración", zh: "设置令牌", hi: "सेटअप टोकन", ar: "رمز الإعداد",
    pt: "Token de configuração", fr: "Jeton d'installation", ru: "Токен настройки", ja: "セットアップトークン",
    de: "Setup-Token", ko: "설정 토큰", it: "Token di configurazione",
  },
  "login.password": {
    en: "Password", es: "Contraseña", zh: "密码", hi: "पासवर्ड", ar: "كلمة المرور",
    pt: "Senha", fr: "Mot de passe", ru: "Пароль", ja: "パスワード", de: "Passwort", ko: "비밀번호", it: "Password",
  },
  "login.confirmPassword": {
    en: "Confirm password", es: "Confirmar contraseña", zh: "确认密码", hi: "पासवर्ड की पुष्टि करें",
    ar: "تأكيد كلمة المرور", pt: "Confirmar senha", fr: "Confirmer le mot de passe", ru: "Подтвердите пароль",
    ja: "パスワードの確認", de: "Passwort bestätigen", ko: "비밀번호 확인", it: "Conferma password",
  },
  "login.signIn": {
    en: "Sign in", es: "Iniciar sesión", zh: "登录", hi: "साइन इन", ar: "تسجيل الدخول",
    pt: "Entrar", fr: "Se connecter", ru: "Войти", ja: "サインイン", de: "Anmelden", ko: "로그인", it: "Accedi",
  },
  "login.setPassword": {
    en: "Set password", es: "Establecer contraseña", zh: "设置密码", hi: "पासवर्ड सेट करें", ar: "تعيين كلمة المرور",
    pt: "Definir senha", fr: "Définir le mot de passe", ru: "Задать пароль", ja: "パスワードを設定",
    de: "Passwort festlegen", ko: "비밀번호 설정", it: "Imposta password",
  },
  "login.firstVisit": {
    en: "First visit — choose an owner password.", es: "Primera visita: elige una contraseña de propietario.",
    zh: "首次访问——请设置所有者密码。", hi: "पहली बार — स्वामी पासवर्ड चुनें।",
    ar: "الزيارة الأولى — اختر كلمة مرور المالك.", pt: "Primeira visita — escolha uma senha de proprietário.",
    fr: "Première visite — choisissez un mot de passe propriétaire.",
    ru: "Первый вход — задайте пароль владельца.", ja: "初回アクセスです。オーナーパスワードを設定してください。",
    de: "Erster Besuch — wähle ein Eigentümer-Passwort.", ko: "첫 방문입니다. 소유자 비밀번호를 설정하세요.",
    it: "Prima visita: scegli una password da proprietario.",
  },

  // -- relative time --
  "time.justNow": {
    en: "just now", es: "ahora mismo", zh: "刚刚", hi: "अभी-अभी", ar: "الآن",
    pt: "agora mesmo", fr: "à l'instant", ru: "только что", ja: "たった今", de: "gerade eben", ko: "방금", it: "adesso",
  },
  "time.minutesAgo": {
    en: "{n}m ago", es: "hace {n} min", zh: "{n}分钟前", hi: "{n} मिनट पहले", ar: "قبل {n} د",
    pt: "há {n} min", fr: "il y a {n} min", ru: "{n} мин назад", ja: "{n}分前", de: "vor {n} Min.", ko: "{n}분 전", it: "{n} min fa",
  },
  "time.hoursAgo": {
    en: "{n}h ago", es: "hace {n} h", zh: "{n}小时前", hi: "{n} घंटे पहले", ar: "قبل {n} س",
    pt: "há {n} h", fr: "il y a {n} h", ru: "{n} ч назад", ja: "{n}時間前", de: "vor {n} Std.", ko: "{n}시간 전", it: "{n} h fa",
  },
  "time.daysAgo": {
    en: "{n}d ago", es: "hace {n} días", zh: "{n}天前", hi: "{n} दिन पहले", ar: "قبل {n} يوم",
    pt: "há {n} dias", fr: "il y a {n} j", ru: "{n} дн назад", ja: "{n}日前", de: "vor {n} Tagen", ko: "{n}일 전", it: "{n} g fa",
  },
};

const LANG_KEY = "mw-lang";

function detectLang() {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved && LANGS[saved]) return saved;
  for (const candidate of navigator.languages || [navigator.language]) {
    const base = String(candidate || "").toLowerCase().split("-")[0];
    if (LANGS[base]) return base;
  }
  return "en";
}

export let lang = detectLang();

/** Translate a key, substituting {vars}. Falls back to English, then the key. */
export function t(key, vars = {}) {
  const entry = S[key];
  let text = (entry && (entry[lang] || entry.en)) || key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/** Persist a language choice and reload (UI re-renders wholesale). */
export function setLang(code) {
  if (!LANGS[code]) return;
  localStorage.setItem(LANG_KEY, code);
  location.reload();
}

/** Apply translations to static HTML and set document language/direction. */
export function initI18n() {
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? "rtl" : "ltr";
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    const text = t(node.dataset.i18nTitle);
    node.title = text;
    node.setAttribute("aria-label", text);
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  const picker = document.getElementById("lang-select");
  if (picker) {
    for (const [code, name] of Object.entries(LANGS)) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = name;
      option.selected = code === lang;
      picker.append(option);
    }
    picker.title = t("nav.language");
    picker.setAttribute("aria-label", t("nav.language"));
    picker.addEventListener("change", () => setLang(picker.value));
  }
}
