/**
 * Central selector registry for the NotebookLM web UI.
 *
 * # Multilingual strategy
 *
 * Google ships NotebookLM in dozens of locales. Anchor priority:
 *
 *   1. **Class names** (`.add-source-button`, `.single-source-container`,
 *      `.submit-button`, `.create-artifact-button-container`, …) — these
 *      are Angular component selectors and identical in every locale.
 *
 *   2. **Material-Symbols icon names** (`audio_magic_eraser`, `content_paste`,
 *      `link`, `upload`, `download`, …) — Google ships them as the literal
 *      text node of `<mat-icon>` in every locale, so they are 100% language-
 *      agnostic. Most stable anchor for icon-driven controls.
 *
 *   3. **`role="dialog"`, `role="button"`** — set synchronously by Angular,
 *      no animation race.
 *
 *   4. **Locale-bound aria-labels and visible text** — last resort. Each
 *      list below covers the eight major NotebookLM locales:
 *      EN, DE, FR, ES, PT, IT, NL, JA. Adding more is mechanical; nothing
 *      breaks if a locale is missing because the class/icon anchors fire
 *      first.
 *
 * Last verified: 2026-10 against the live notebook.google.com ("Gemini
 * Notebook", formerly notebooklm.google.com) layout (EN locale).
 */

export const Selectors = {
  chat: {
    answerContainer: ".to-user-container",
    answerText: ".to-user-container .message-text-content",
    latestAnswerText: ".to-user-container:last-child .message-text-content",
    /**
     * Collapsible reasoning block ("Thoughts") rendered inside the answer
     * bubble since 2026-09. Excluded from the extracted answer text.
     */
    thinkingBlock: "thinking-chain-view, .thinking-chain",
    /** One question/answer turn (2026-09); legacy builds only had the containers. */
    turn: ".chat-message-pair, .to-user-container",
    /**
     * Chat textarea. The class is shared across locales; aria-labels are a
     * fallback for older builds where the class was different.
     */
    queryInput: [
      "textarea.query-box-input",
      'textarea[aria-label="Query box"]',
      // `:not(.query-box-textarea)` excludes the sidebar web-source search box
      // ("Discover sources based on the inputted query"), which also matches.
      'textarea:not(.query-box-textarea)[aria-label*="query" i]',
      'textarea[aria-label*="anfrag" i]',
      'textarea[aria-label*="requete" i]',
      'textarea[aria-label*="zone de requete" i]',
      'textarea[aria-label*="consulta" i]',
      'textarea[aria-label*="domanda" i]',
      'textarea[aria-label*="vraag" i]',
      'textarea[aria-label*="質問" i]',
      'textarea[aria-label*="pergunta" i]',
    ],
    /**
     * The chat submit button has the *language-bound* aria-label
     * (Send / Senden / Envoyer / Enviar / Invia / Verzenden / 送信). It also
     * has the stable class `.submit-button`. The sources web-search overlay
     * uses `.actions-enter-button` with the SAME aria-label, so we MUST
     * anchor on `.submit-button` to avoid distractor matches.
     */
    submitButton: [
      // 2026-09: the class moved to the `<nb-icon-button>` wrapper.
      "query-box .submit-button button",
      'query-box button[aria-label="Submit"]',
      "button.submit-button",
      'button.submit-button[aria-label*="send" i]',
      'button.submit-button[aria-label*="senden" i]',
      'button.submit-button[aria-label*="envoyer" i]',
      'button.submit-button[aria-label*="enviar" i]',
      'button.submit-button[aria-label*="invia" i]',
      'button.submit-button[aria-label*="verzend" i]',
      'button.submit-button[aria-label*="送信" i]',
    ],
  },

  /**
   * NotebookLM removed tabs in favour of a three-pane sidebar (2026 layout).
   * These selectors are kept only for the rare legacy layouts.
   */
  tabs: {
    discussion: [
      '[role="tab"]:has-text("Discussion")',
      '[role="tab"]:has-text("Diskussion")',
      '[role="tab"]:has-text("Diskussionen")',
      '[role="tab"]:has-text("Discusión")',
      '[role="tab"]:has-text("Discussione")',
      '[role="tab"]:has-text("Discussão")',
      '[role="tab"]:has-text("ディスカッション")',
    ],
    sources: [
      '[role="tab"]:has-text("Sources")',
      '[role="tab"]:has-text("Quellen")',
      '[role="tab"]:has-text("Fuentes")',
      '[role="tab"]:has-text("Fonti")',
      '[role="tab"]:has-text("Fontes")',
      '[role="tab"]:has-text("Bronnen")',
      '[role="tab"]:has-text("ソース")',
    ],
    activeTabClass: "mdc-tab--active",
    tabList: ".mat-mdc-tab-list .mdc-tab",
  },

  citations: {
    button: [
      "button.citation-marker",
      "button.xap-inline-dialog.citation-marker",
      "button[data-citation]",
    ],
    label: "span[aria-label]",
    /**
     * Since 2026-09 a marker click opens an inline tooltip instead of the
     * source panel: `.citation-tooltip-header` = source title,
     * `.citation-tooltip-text` = cited passage.
     */
    tooltip: "xap-inline-dialog-container .citation-tooltip",
    tooltipHeader: ".citation-tooltip-header",
    tooltipText: ".citation-tooltip .citation-tooltip-text",
    highlight: ".highlighted",
    paragraph: ".paragraph",
    paragraphHighlight: ".paragraph .highlighted",
  },

  sources: {
    /**
     * Per-source row in the sidebar (language-agnostic). Stable Angular
     * class — verified across all observed locales.
     */
    sourceContainer: ".single-source-container",
    /** Row "More" button id prefix; the rest of the id is the source UUID. */
    rowIdPrefix: "source-item-more-button-",
    /**
     * Single-source view that replaces the source list in the sidebar —
     * opened by a citation marker or a source title (2026-10). Escape does
     * not close it; the panel-header button with the `collapse_content`
     * glyph ("Close source view") does.
     */
    sourceViewer: "section.source-panel source-viewer",
    closeSourceView:
      'section.source-panel .panel-header button:has(mat-icon:text-is("collapse_content"))',
    /**
     * "X Quellen" / "X sources" header text. Numeric so we read the count
     * via regex on the visible text. Independent of sidebar collapse state.
     */
    sourceCountIndicator: ".cover-subtitle-source-count",
    /**
     * Sidebar "Add source" button. Class `.add-source-button` is language-
     * agnostic; aria-labels listed for older builds without the class.
     */
    addButton: [
      "button.add-source-button",
      'button[aria-label="Add source"]',
      'button[aria-label*="add source" i]',
      'button[aria-label*="quelle hinzu" i]',
      'button[aria-label*="ajouter une source" i]',
      'button[aria-label*="añadir fuente" i]',
      'button[aria-label*="agregar fuente" i]',
      'button[aria-label*="aggiungi fonte" i]',
      'button[aria-label*="adicionar fonte" i]',
      'button[aria-label*="bron toevoegen" i]',
      'button[aria-label*="ソースを追加" i]',
    ],
    /**
     * Real Material modal. `[role="dialog"]` is set by Angular synchronously
     * the moment the modal mounts — race-free against the `.mdc-dialog--open`
     * animation class and resistant to Material-UI version bumps. Avoid
     * `.cdk-overlay-pane` (matches every dropdown / emoji picker / menu).
     *
     * Scoped to `mat-dialog-container`: since 2026-09 the page keeps a hidden
     * `xap-emoji-picker` with `role="dialog"` mounted at all times, which a
     * bare `[role="dialog"]` `.first()` would pick up instead of the modal.
     * Announcement modals are closed beforehand by `dismissPromoDialogs`.
     */
    overlayPane: 'mat-dialog-container[role="dialog"]',
    overlayInput: 'mat-dialog-container[role="dialog"] input[type="text"]:not([readonly])',
    overlayTextarea:
      'mat-dialog-container[role="dialog"] textarea:not(.query-box-textarea):not(.query-box-input)',
    /**
     * Source-type buttons in the Add-source overlay (`.source-action-button`
     * since 2026-09, `.drop-zone-icon-button` before). Google ships them
     * *without* aria-labels — the only stable, language-agnostic anchor is
     * the Material-Symbols icon name baked into a `<mat-icon>` text node.
     */
    sourceTypeUrl: [
      // Icon-anchored (language-free) — primary path.
      "button:is(.source-action-button, .drop-zone-icon-button):has(mat-icon.youtube-icon)",
      'button:is(.source-action-button, .drop-zone-icon-button):has(mat-icon:text-is("link_2"))',
      'button:is(.source-action-button, .drop-zone-icon-button):has(mat-icon:text-is("link"))',
      // Visible-text fallbacks for the eight major locales.
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Websites")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Website")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Sites Web")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Sitio web")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Sito web")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Sites")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("ウェブサイト")',
    ],
    sourceTypeText: [
      // Icon-anchored (language-free) — primary path.
      'button:is(.source-action-button, .drop-zone-icon-button):has(mat-icon:text-is("content_paste"))',
      // Visible-text fallbacks for major locales.
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Kopierter Text")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Copied text")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Pasted text")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Texte copié")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Texto copiado")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Testo copiato")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Gekopieerde tekst")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("コピーしたテキスト")',
      '[data-type="text"]',
    ],
    sourceTypeYoutube: [
      "button:is(.source-action-button, .drop-zone-icon-button) mat-icon.youtube-icon",
      'button:is(.source-action-button, .drop-zone-icon-button):has(mat-icon:text-is("video_youtube"))',
    ],
    sourceTypeFile: [
      'input[type="file"]',
      'button:is(.source-action-button, .drop-zone-icon-button):has(mat-icon:text-is("upload"))',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Dateien hochladen")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Upload sources")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Importer")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Subir")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Carica")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("Uploaden")',
      'button:is(.source-action-button, .drop-zone-icon-button):has-text("アップロード")',
    ],
    /**
     * Primary submit button in the add-source dialog. Material's
     * `.mdc-button--raised` class is the most stable anchor; per-locale
     * visible-text variants are fallbacks for older builds.
     */
    insertConfirm: [
      // Class-anchored (language-free). 2026-09: unelevated primary button.
      "button.mdc-button--unelevated.mat-primary",
      'button.mdc-button--raised:has-text("Insert")',
      'button.mat-flat-button:has-text("Insert")',
      'button[color="primary"]:has-text("Insert")',
      // Visible-text fallbacks for major locales.
      'button.mdc-button--raised:has-text("Einfügen")',
      'button.mdc-button--raised:has-text("Hinzufügen")',
      'button.mdc-button--raised:has-text("Ajouter")',
      'button.mdc-button--raised:has-text("Insertar")',
      'button.mdc-button--raised:has-text("Inserisci")',
      'button.mdc-button--raised:has-text("Invoegen")',
      'button.mdc-button--raised:has-text("挿入")',
      'button:has-text("Insert")',
      'button:has-text("Einfügen")',
      'button:has-text("Hinzufügen")',
      'button:has-text("Ajouter")',
      'button:has-text("Insérer")',
      'button:has-text("Insertar")',
      'button:has-text("Añadir")',
      'button:has-text("Agregar")',
      'button:has-text("Inserisci")',
      'button:has-text("Aggiungi")',
      'button:has-text("Inserir")',
      'button:has-text("Adicionar")',
      'button:has-text("Invoegen")',
      'button:has-text("Toevoegen")',
      'button:has-text("挿入")',
      'button:has-text("追加")',
      'button:has-text("Add")',
      'button:has-text("Submit")',
      'button[type="submit"]',
      'mat-dialog-container .mdc-dialog__actions button:not(:has-text("Cancel")):not(:has-text("Close")):not(:has-text("Schließen")):not(:has-text("Annuler")):not(:has-text("Cancelar")):not(:has-text("Annulla")):not(:has-text("Annuleren")):not(:has-text("キャンセル"))',
    ],
  },

  studio: {
    /**
     * "Audio Overview" entry control. As of the 2026-05 Studio layout this
     * is a `<div role="button">` with a Material-Symbols `audio_magic_eraser`
     * icon, NOT a real `<button>`. Icon-anchored selectors fire first.
     */
    audioOverviewButton: [
      // Icon-anchored (language-free) — primary path.
      '.create-artifact-button-container:has(mat-icon:text-is("audio_spark"))',
      '.create-artifact-button-container:has(mat-icon:text-is("audio_magic_eraser"))',
      '[role="button"]:has(mat-icon:text-is("audio_magic_eraser"))',
      // Locale-bound aria-labels for the eight major locales.
      '[role="button"][aria-label*="audio-zusammenfassung" i]',
      '[role="button"][aria-label*="audio overview" i]',
      '[role="button"][aria-label*="aperçu audio" i]',
      '[role="button"][aria-label*="resumen de audio" i]',
      '[role="button"][aria-label*="panoramica audio" i]',
      '[role="button"][aria-label*="visão geral de áudio" i]',
      '[role="button"][aria-label*="audio-overzicht" i]',
      '[role="button"][aria-label*="音声の概要" i]',
      '[role="button"][aria-label*="audio" i]',
      // Legacy <button> fallbacks for older builds.
      'button:has(mat-icon:text-is("audio_magic_eraser"))',
      'button[aria-label*="audio overview" i]',
      'button[aria-label*="audio-zusammenfassung" i]',
      'button[aria-label*="podcast" i]',
    ],
    /**
     * 2026-09: every Studio tile opens a customise dialog; nothing is
     * generated until a footer button is clicked. Reports uses its own host.
     */
    customiseDialog:
      "mat-dialog-container:has(configurable-form-dialog), mat-dialog-container:has(report-customization-dialog)",
    /** "Generate now" — tonal nb-button (language-free), text fallbacks after. */
    generateNowButton: [
      "mat-dialog-actions .action-button-wrapper button",
      "mat-dialog-actions nb-button.nb-button-type-tonal button",
      'mat-dialog-actions button:has-text("Generate now")',
      // Variant without the usage footer: a single "Generate" button.
      'mat-dialog-actions button:has-text("Generate"):not(:has-text("later"))',
    ],
    /** "Generate later" — queued, doesn't use the current limit window. */
    generateLaterButton: [
      "mat-dialog-actions nb-button.nb-button-type-on-surface button",
      'mat-dialog-actions button:has-text("Generate later")',
    ],
    /** "N sources" button in a Studio dialog → source picker sub-view. */
    sourcesTrigger: ".item-selection-trigger button",
    /** One option per source; `data-value` = source UUID, `.item-name` = title. */
    sourcesOption: "mat-selection-list mat-list-option",
    /**
     * Picker footer "Confirm" — same slot/markup as "Generate now", so only
     * click it while the picker is open.
     */
    sourcesConfirmButton: [
      "mat-dialog-actions .action-button-wrapper button",
      "mat-dialog-actions nb-button.nb-button-type-tonal button",
      'mat-dialog-actions button:has-text("Confirm")',
    ],
    /** Report dialog: format cards (Interactive | Document) — by position. */
    reportFormatCard: '[role="radio"].format-card',
    /** Report templates — selection only; order per format is stable. */
    reportTemplateButton: "button.primary-action-button:not(.disabled)",
    /** Pencil of the currently selected template → editable instructions. */
    reportSelectedTemplateEdit:
      '.option-card.selected button:has(mat-icon:text-is("edit")), .option-card.selected button[aria-label="Customize Report"]',
    /** Usage meter in the Studio dialog footer; `aria-valuenow` = percent used. */
    usageMeter: 'expected-usage [role="progressbar"]',
    /**
     * Generate / Generieren / Générer trigger inside the customise dialog.
     * Visible-text varies by locale.
     */
    generateButton: [
      'button:has-text("Generate")',
      'button:has-text("Generieren")',
      'button:has-text("Générer")',
      'button:has-text("Generer")',
      'button:has-text("Generar")',
      'button:has-text("Genera")',
      'button:has-text("Gerar")',
      'button:has-text("Genereren")',
      'button:has-text("生成")',
    ],
    /**
     * Download trigger. The Studio panel uses an icon-only button with a
     * `download` Material-Symbols glyph; aria-label is locale-bound.
     */
    downloadButton: [
      // Icon-anchored (language-free) — primary path.
      'button:has(mat-icon:text-is("download"))',
      // Locale-bound aria-labels.
      'button[aria-label*="download" i]',
      'button[aria-label*="herunterladen" i]',
      'button[aria-label*="télécharger" i]',
      'button[aria-label*="descargar" i]',
      'button[aria-label*="scarica" i]',
      'button[aria-label*="baixar" i]',
      'button[aria-label*="downloaden" i]',
      'button[aria-label*="ダウンロード" i]',
    ],
    /**
     * Completed Audio-Overview tile. Modern NotebookLM does NOT mount a real
     * `<audio>` element in the DOM; the player is a custom Angular tile
     * inside `.artifact-library-container > artifact-library-item`. The
     * play-button (`button.artifact-action-button` with locale-bound
     * aria-label "Wiedergeben"/"Play"/…) is the most reliable "audio is
     * ready" signal because it only mounts after generation completes.
     */
    audioPlayer: [
      // Icon-anchored (language-free). The Studio library also lists reports,
      // slide decks, mind maps … so an unscoped `artifact-library-item` would
      // falsely report "audio ready" — always filter by the audio glyph.
      'artifact-library-item:has(mat-icon.artifact-icon:text-is("audio_spark"))',
      'artifact-library-item:has(mat-icon.artifact-icon:text-is("audio_magic_eraser"))',
      // A generating tile carries the same aria-description but a disabled
      // button and a `progress_activity` glyph — exclude it.
      'artifact-library-item:has(button[aria-description="Audio Overview"]:not([disabled])):not(:has(mat-icon.artifact-icon:text-is("progress_activity")))',
      // Legacy <audio> tag for older builds.
      "audio",
      '[role="audio"]',
    ],
    /**
     * Audio tile that is still generating (2026-09): spinning
     * `progress_activity` glyph, disabled main button, title "Generating
     * Audio Overview...". aria-description is locale-bound, so the
     * language-free fallback matches any generating tile with the audio
     * accent colour (blue — shared only with Data Table).
     */
    audioGenerating: [
      'artifact-library-item:has(mat-icon.artifact-icon:text-is("progress_activity")):has(button[aria-description="Audio Overview"])',
      'artifact-library-item[data-studio-accent="blue"]:has(mat-icon.artifact-icon:text-is("progress_activity"))',
    ],
    /**
     * Per-tile "Mehr"/"More"/"Plus"/… three-dot button. Opens the menu that
     * contains the Download item.
     */
    audioMoreMenuButton: [
      'artifact-library-item:has(mat-icon.artifact-icon:text-is("audio_spark")) .artifact-more-button button',
      'artifact-library-item:has(mat-icon.artifact-icon:text-is("audio_magic_eraser")) .artifact-more-button button',
      'artifact-library-item:has(button[aria-description="Audio Overview"]) button[aria-label="More"]',
      // Unscoped `artifact-library-item button[aria-label*="more"]` fallbacks
      // were removed: they open the menu of whatever tile comes first
      // (report, slide deck, …) and download the wrong artifact.
    ],
    /**
     * Download menu-item that surfaces after clicking the three-dot menu.
     */
    audioDownloadMenuItem: [
      '[role="menuitem"]:has(mat-icon:text-is("save_alt"))',
      '[role="menuitem"]:has(mat-icon:text-is("download"))',
      '[role="menuitem"]:has-text("Download")',
      '[role="menuitem"]:has-text("Herunterladen")',
      '[role="menuitem"]:has-text("Télécharger")',
      '[role="menuitem"]:has-text("Descargar")',
      '[role="menuitem"]:has-text("Scarica")',
      '[role="menuitem"]:has-text("Baixar")',
      '[role="menuitem"]:has-text("Downloaden")',
      '[role="menuitem"]:has-text("ダウンロード")',
    ],
  },

  /** Deletion (2026-09): "delete" glyph menu items + confirm dialogs. */
  deletion: {
    menuItem: '[role="menuitem"]:has(mat-icon:text-is("delete"))',
    sourceDialogHost: "delete-source",
    studioDialogHost: "delete-dialog",
  },

  /** Notes (2026-09): chat answer → note → source. Glyph-anchored. */
  notes: {
    chatPair: ".chat-message-pair",
    pairQuestion: ".from-user-container",
    saveAnswerButton:
      '.to-user-container button:has(mat-icon:text-is("keep_pin")), .to-user-container button[aria-label="Save message to a note"]',
    editor: "note-editor",
    editorTitle: 'input.note-header__editable-title, input[aria-label="note title editable"]',
    editorBody: "labs-tailwind-doc-viewer",
    closeEditor:
      '.panel-header button:has(mat-icon:text-is("collapse_content")), .panel-header button[aria-label="Close note view"]',
    libraryNote: "artifact-library-note",
    moreButton: 'button:has(mat-icon:text-is("more_vert"))',
    convertMenuItem: '[role="menuitem"]:has(mat-icon:text-is("convert_to_text"))',
    convertAllMenuItem: '[role="menuitem"]:has(mat-icon:text-is("docs_add_on"))',
  },

  /** Top-bar settings menu (2026-09). Icon-anchored, EN aria fallback. */
  settings: {
    menuButton: ['button:has(mat-icon:text-is("settings"))', 'button[aria-label="Settings"]'],
    usageMenuItem: [
      '[role="menuitem"]:has(mat-icon:text-is("data_usage"))',
      '[role="menuitem"][aria-label="Show usage dialog"]',
    ],
    usageDialog: "mat-dialog-container:has(usage-limits-dialog)",
    /** Notebook menu → "Configure Chat" (`tune` glyph) dialog. */
    notebookMenuButton: [
      'notebook-header button:has(mat-icon:text-is("more_vert"))',
      'button[aria-label="Notebook configuration"]',
    ],
    configureChatMenuItem: [
      '[role="menuitem"]:has(mat-icon:text-is("tune"))',
      '[role="menuitem"]:has-text("Configure Chat")',
    ],
    configureChatDialog: "mat-dialog-container:has(configure-notebook-settings)",
  },

  notebooks: {
    projectCard: 'a[aria-labelledby*="project-"], button[aria-labelledby*="project-"]',
    /**
     * Homepage notebook listing (2026-10). Every notebook — grid card or
     * list-view row — links to `/notebook/<uuid>`. Google's "Featured
     * notebooks" carousel uses the same cards with `.featured-project-card`.
     */
    homeLink: 'a[href*="/notebook/"]',
    homeCard: "project-button",
    homeRow: "tr",
    featuredCard: ".featured-project-card",
    /** Filter row: All · My notebooks · Discover (`public` glyph) · Shared with me · Collections. */
    homeFilterButton: ".project-section-buttons-lumi > nb-button > button",
    homeSectionHeading: "welcome-page h1, welcome-page h2, welcome-page h3",
    cardMenuButton: [
      'button[aria-label="Project Actions Menu"]',
      'button[aria-label*="menu" i]',
      'button[aria-label*="options" i]',
      'button[aria-label*="more" i]',
      'button[aria-label*="optionen" i]',
      'button[aria-label*="opzioni" i]',
      'button[aria-label*="opciones" i]',
      'button[aria-label*="opções" i]',
      'button[aria-label*="メニュー" i]',
    ],
    deleteButton: [
      '[role="menuitem"]:has-text("Delete")',
      '[role="menuitem"]:has-text("Löschen")',
      '[role="menuitem"]:has-text("Supprimer")',
      '[role="menuitem"]:has-text("Eliminar")',
      '[role="menuitem"]:has-text("Borrar")',
      '[role="menuitem"]:has-text("Elimina")',
      '[role="menuitem"]:has-text("Excluir")',
      '[role="menuitem"]:has-text("Verwijderen")',
      '[role="menuitem"]:has-text("削除")',
    ],
    confirmDelete: [
      'button:has-text("Delete")',
      'button:has-text("Löschen")',
      'button:has-text("Supprimer")',
      'button:has-text("Eliminar")',
      'button:has-text("Borrar")',
      'button:has-text("Elimina")',
      'button:has-text("Excluir")',
      'button:has-text("Verwijderen")',
      'button:has-text("削除")',
    ],
  },

  /**
   * Material Icon labels that leak into extracted answer text as isolated
   * lines. Stripped from the response before delivery to the client.
   */
  uiControlLabels: new Set([
    "more_horiz",
    "more_vert",
    "open_in_new",
    "content_copy",
    "bookmark_border",
    "expand_more",
    "expand_less",
    "thumb_up",
    "thumb_down",
    "share",
    "keep",
    "keep_pin",
    "copy_all",
    "arrow_forward",
  ]),
} as const;

/**
 * Joins a list of selector candidates into a comma-separated string.
 * Patchright/Playwright accepts this as a CSS locator (comma = OR).
 *
 * Example: `joinAlt(Selectors.chat.queryInput)` → `"textarea.query-box-input, textarea[aria-label*=\"query\" i], ..."`
 */
export function joinAlt(selectors: readonly string[]): string {
  return selectors.join(", ");
}
