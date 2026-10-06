/**
 * Browser Session
 *
 * Represents a single browser session for NotebookLM interactions.
 *
 * Features:
 * - Human-like question typing
 * - Streaming response detection
 * - Auto-login on session expiry
 * - Session activity tracking
 * - Chat history reset
 *
 * Based on the Python implementation from browser_session.py
 */

import type { BrowserContext, Page } from "patchright";
import type { SharedContextManager } from "./shared-context-manager.js";
import type { AuthManager } from "../auth/auth-manager.js";
import { humanType, randomDelay } from "../utils/stealth-utils.js";
import { snapshotAllResponses } from "../utils/page-utils.js";
import {
  waitForStableAnswer,
  snapshotPriorAnswers,
  detectFailureReply,
  countAnswers,
} from "../notebooklm/chat.js";
import { dismissPromoDialogs } from "../notebooklm/dialogs.js";
import {
  generateStudioArtifact,
  listStudioArtifacts,
  type GenerateStudioOptions,
  type GenerateStudioResult,
  type StudioArtifact,
} from "../notebooklm/studio.js";
import { readUsage, type UsageInfo } from "../notebooklm/usage.js";
import {
  deleteSource as deleteSourceOnPage,
  deleteStudioEntry as deleteStudioEntryOnPage,
  resolveSourceTarget,
  resolveStudioTarget,
  type DeleteResult,
  type DeleteTarget,
} from "../notebooklm/deletion.js";
import {
  listSources,
  setChatSources,
  restoreChatSources,
  type NotebookSource,
} from "../notebooklm/source-select.js";
import {
  saveAnswerAsNote as saveAnswerAsNoteOnPage,
  convertNoteToSource as convertNoteToSourceOnPage,
  type SavedNote,
  type ConvertResult,
} from "../notebooklm/notes.js";
import {
  configureChat as configureChatOnPage,
  type ChatConfigInput,
  type ChatConfigResult,
} from "../notebooklm/chat-config.js";
import {
  extractCitations as extractCitationsFromPage,
  formatAnswer,
  type SourceFormat,
  type ExtractCitationsResult,
} from "../notebooklm/citations.js";
import {
  addSource as addSourceToPage,
  type AddSourceInput,
  type AddSourceResult,
} from "../notebooklm/sources.js";
import {
  generateAudioOverview as generateAudioOnPage,
  downloadAudioOverview as downloadAudioOnPage,
  getAudioStatusOnPage,
  type GenerateAudioOptions,
  type AudioGenerationResult,
  type DownloadAudioResult,
} from "../notebooklm/audio.js";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";
import type { SessionInfo, ProgressCallback } from "../types.js";
import { RateLimitError } from "../errors.js";
import { PageLock } from "../utils/page-lock.js";
import { Selectors } from "../notebooklm/selectors.js";
import fs from "fs/promises";
import path from "path";
import {
  resolveStudioDownload,
  studioFileName,
  type StudioDownloadFormat,
  type StudioDownloadTarget,
} from "../notebooklm/studio-download.js";
import { notebookUuidFromUrl } from "../notebooklm/account-notebooks.js";
import { RpcError, rpcEnabled } from "../notebooklm/rpc.js";
import { askRpc } from "../notebooklm/chat-rpc.js";
import { addSourcesRpc, configureChatRpc, readUsageRpc } from "../notebooklm/rpc-ops.js";
import {
  generateStudioRpc,
  notebookOverviewRpc,
  suggestReportsRpc,
  type NotebookOverview,
  type ReportSuggestion,
} from "../notebooklm/studio-rpc.js";
import {
  getSourceGuideRpc,
  getSourceTextRpc,
  importResearchRpc,
  listResearchRpc,
  listSourceDetailsRpc,
  startResearchRpc,
  type ResearchCorpus,
  type ResearchMode,
  type ResearchTask,
  type SourceDetails,
} from "../notebooklm/source-ops.js";
import {
  THIN_SOURCE_WORDS,
  findEarlierRun,
  normalizeQuery,
  vetSelections,
  type ImportSelection,
  type Rejection,
} from "../notebooklm/research-policy.js";
import { resolveSourceIds } from "../notebooklm/source-select.js";
import { abortable, reportProgress } from "../utils/request-context.js";

/** Source fields added to list_sources / import results. */
type SourceFields = Omit<SourceDetails, "id" | "title" | "driveId" | "mimeType"> &
  Partial<Pick<SourceDetails, "driveId" | "mimeType">>;

function detailFields(d: SourceDetails): SourceFields {
  const { id: _id, title: _title, driveId, mimeType, ...rest } = d;
  return { ...rest, ...(driveId && { driveId }), ...(mimeType && { mimeType }) };
}

/** Signs that the indexed text is not the document the source claims to be. */
function sourceWarnings(s: SourceDetails): string[] {
  const out: string[] = [];
  if (s.status === "failed") out.push("NotebookLM could not process this source.");
  if (
    s.status === "ready" &&
    s.words !== null &&
    s.words < THIN_SOURCE_WORDS &&
    ["web", "pdf", "word_doc", "google_doc"].includes(s.type)
  ) {
    out.push(
      `Only ${s.words} words were indexed — possibly a landing page, abstract, paywall or ` +
        "cookie wall rather than the full document. Check it with get_source (include_text); " +
        "if so, add the full-text URL or file instead."
    );
  }
  return out;
}

export interface InspectedSource extends SourceDetails {
  guide: { summary: string | null; keywords: string[] };
  warnings: string[];
  text?: { content: string; offset: number; totalChars: number; nextOffset: number | null };
}

export interface ResearchOutcome {
  task: ResearchTask;
  /** started now · reused (same query earlier) · busy (another run in progress) · history (lookup). */
  origin: "started" | "reused" | "busy" | "history";
}

export interface ResearchImportResult {
  taskId: string;
  imported: Array<
    SourceFields & {
      id: string;
      title: string;
      reliability: string | null;
      reason: string | null;
      warnings: string[];
    }
  >;
  rejected: Rejection[];
}

/** How often a running research is checked. */
const RESEARCH_POLL_MS = 4_000;

export interface StudioDownloadResult {
  artifact: StudioDownloadTarget;
  file_path: string;
  bytes: number;
  /** File extension written (m4a, mp4, png, pdf, pptx, md, csv, json, xlsx, html). */
  format: string;
}

/** NotebookLM's canned failure reply as an error (see detectFailureReply). */
function failureReplyError(reply: string): Error {
  return new Error(
    `NotebookLM did not answer ("${reply}"). Usually temporary — retry in a ` +
      "minute. If it persists, the Google session may need a fresh login: run setup_auth."
  );
}

/** How often `generateAudio({ waitForCompletion })` checks the render. */
const AUDIO_POLL_MS = 15_000;

export class BrowserSession {
  public readonly sessionId: string;
  public readonly notebookUrl: string;
  public readonly createdAt: number;
  public lastActivity: number;
  public messageCount: number;
  /** Source titles the last `ask()` was scoped to (null = all sources). */
  public lastScopedSources: string[] | null = null;

  private context!: BrowserContext;
  private sharedContextManager: SharedContextManager;
  private authManager: AuthManager;
  private page: Page | null = null;
  private initialized: boolean = false;
  /** Serialises tool calls that drive this tab (see PageLock). */
  private lock = new PageLock();
  /** The tab's chat is missing answers asked over RPC (reload before reading it). */
  private chatStale = false;

  constructor(
    sessionId: string,
    sharedContextManager: SharedContextManager,
    authManager: AuthManager,
    notebookUrl: string
  ) {
    this.sessionId = sessionId;
    this.sharedContextManager = sharedContextManager;
    this.authManager = authManager;
    this.notebookUrl = notebookUrl;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.messageCount = 0;

    log.info(`🆕 BrowserSession ${sessionId} created`);
  }

  /** True while an operation runs on this tab or waits for it. */
  get busy(): boolean {
    return this.lock.current !== null || this.lock.queued > 0;
  }

  /** Run `fn` under this tab's lock; counts as activity for idle cleanup. */
  private exclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return this.lock.run(label, async () => {
      this.updateActivity();
      try {
        return await fn();
      } finally {
        this.updateActivity();
      }
    });
  }

  /** Run `fn` on this tab under its lock, initialising the page first. */
  private onPage<T>(label: string, fn: (page: Page) => Promise<T>): Promise<T> {
    return this.exclusive(label, async () => {
      if (!this.initialized || !this.page || this.isPageClosedSafe()) {
        await this.init();
      }
      return fn(this.page!);
    });
  }

  /**
   * Initialize the session by creating a page and navigating to the notebook
   */
  async init(): Promise<void> {
    if (this.initialized) {
      log.warning(`⚠️  Session ${this.sessionId} already initialized`);
      return;
    }

    log.info(`🚀 Initializing session ${this.sessionId}...`);

    try {
      // Ensure a valid shared context
      this.context = await this.sharedContextManager.getOrCreateContext();

      // Create new page (tab) in the shared context (with auto-recovery)
      try {
        this.page = await this.context.newPage();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          /has been closed|Target .* closed|Browser has been closed|Context .* closed/i.test(msg)
        ) {
          log.warning("  ♻️  Context was closed. Recreating and retrying newPage...");
          this.context = await this.sharedContextManager.getOrCreateContext();
          this.page = await this.context.newPage();
        } else {
          throw e;
        }
      }
      log.success(`  ✅ Created new page`);

      // Navigate to notebook
      log.info(`  🌐 Navigating to: ${this.notebookUrl}`);
      await this.page.goto(this.notebookUrl, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.browserTimeout,
      });

      // Wait for page to stabilize
      await randomDelay(2000, 3000);

      // Check if we need to login
      const isAuthenticated = await this.authManager.validateCookiesExpiry(this.context);

      if (!isAuthenticated) {
        log.warning(`  🔑 Session ${this.sessionId} needs authentication`);
        const loginSuccess = await this.ensureAuthenticated();
        if (!loginSuccess) {
          throw new Error("Failed to authenticate session");
        }
      } else {
        log.success(`  ✅ Session already authenticated`);
      }

      // CRITICAL: Restore sessionStorage from saved state
      // This is essential for maintaining Google session state!
      log.info(`  🔄 Restoring sessionStorage...`);
      const sessionData = await this.authManager.loadSessionStorage();
      if (sessionData) {
        const entryCount = Object.keys(sessionData).length;
        if (entryCount > 0) {
          await this.restoreSessionStorage(sessionData, entryCount);
        } else {
          log.info(`  ℹ️  SessionStorage empty (fresh session)`);
        }
      } else {
        log.info(`  ℹ️  No saved sessionStorage found (fresh session)`);
      }

      // Wait for NotebookLM interface to load
      log.info(`  ⏳ Waiting for NotebookLM interface...`);
      await this.waitForNotebookLMReady();

      // Announcement modals (e.g. the 2026-09 "Gemini Notebook" promo) sit
      // on top of the chat and swallow every click and keystroke.
      await dismissPromoDialogs(this.page);

      this.initialized = true;
      this.chatStale = false;
      this.updateActivity();
      log.success(`✅ Session ${this.sessionId} initialized successfully`);
    } catch (error) {
      log.error(`❌ Failed to initialize session ${this.sessionId}: ${error}`);
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      throw error;
    }
  }

  /**
   * Wait for NotebookLM interface to be ready
   *
   * IMPORTANT: Matches Python implementation EXACTLY!
   * - Uses SPECIFIC selectors (textarea.query-box-input)
   * - Checks ONLY for "visible" state (NOT disabled!)
   * - NO placeholder checks (let NotebookLM handle that!)
   *
   * Based on Python _wait_for_ready() from browser_session.py:104-113
   */
  private async waitForNotebookLMReady(): Promise<void> {
    if (!this.page) {
      throw new Error("Page not initialized");
    }

    try {
      // PRIMARY: Exact Python selector - textarea.query-box-input
      log.info("  ⏳ Waiting for chat input (textarea.query-box-input)...");
      await this.page.waitForSelector("textarea.query-box-input", {
        timeout: 10000, // Python uses 10s timeout
        state: "visible", // ONLY check visibility (NO disabled check!)
      });
      log.success("  ✅ Chat input ready!");
    } catch {
      // FALLBACK: Python alternative selector
      try {
        log.info("  ⏳ Trying fallback selector (aria-label)...");
        await this.page.waitForSelector('textarea[aria-label="Feld für Anfragen"]', {
          timeout: 5000, // Python uses 5s for fallback
          state: "visible",
        });
        log.success("  ✅ Chat input ready (fallback)!");
      } catch (error) {
        log.error(`  ❌ NotebookLM interface not ready: ${error}`);
        // Cookies can look valid while Google wants the identity confirmed again.
        if (this.page.url().includes("accounts.google.com")) {
          throw new Error(
            "Google asks to sign in again (the NotebookLM page redirected to accounts.google.com). " +
              "Run setup_auth, then retry.",
            { cause: error }
          );
        }
        throw new Error(
          "Could not find NotebookLM chat input. " +
            "Please ensure the notebook page has loaded correctly.",
          { cause: error }
        );
      }
    }
  }

  private isPageClosedSafe(): boolean {
    if (!this.page) return true;
    try {
      if (this.page.isClosed()) return true;
      // Accessing URL should be safe; if page is gone, this may throw.
      void this.page.url();
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Ensure the session is authenticated, perform auto-login if needed
   */
  private async ensureAuthenticated(): Promise<boolean> {
    if (!this.page) {
      throw new Error("Page not initialized");
    }

    log.info(`🔑 Checking authentication for session ${this.sessionId}...`);

    // Check cookie validity
    const isValid = await this.authManager.validateCookiesExpiry(this.context);

    if (isValid) {
      log.success(`  ✅ Cookies valid`);
      return true;
    }

    log.warning(`  ⚠️  Cookies expired or invalid`);

    // Try to get valid auth state
    const statePath = await this.authManager.getValidStatePath();

    if (statePath) {
      // Load saved state
      log.info(`  📂 Loading auth state from: ${statePath}`);
      await this.authManager.loadAuthState(this.context, statePath);

      // Reload page to apply new auth
      log.info(`  🔄 Reloading page...`);
      await (this.page as Page).reload({ waitUntil: "domcontentloaded" });
      await randomDelay(2000, 3000);

      // Check if it worked
      const nowValid = await this.authManager.validateCookiesExpiry(this.context);
      if (nowValid) {
        log.success(`  ✅ Auth state loaded successfully`);
        return true;
      }
    }

    // Need fresh login
    log.warning(`  🔑 Fresh login required`);

    if (CONFIG.autoLoginEnabled) {
      log.info(`  🤖 Attempting auto-login...`);
      const loginSuccess = await this.authManager.loginWithCredentials(
        this.context,
        this.page,
        CONFIG.loginEmail,
        CONFIG.loginPassword
      );

      if (loginSuccess) {
        log.success(`  ✅ Auto-login successful`);
        // Navigate back to notebook
        await this.page.goto(this.notebookUrl, {
          waitUntil: "domcontentloaded",
        });
        await randomDelay(2000, 3000);
        return true;
      } else {
        log.error(`  ❌ Auto-login failed`);
        return false;
      }
    } else {
      log.error(`  ❌ Auto-login disabled and no valid auth state - manual login required`);
      return false;
    }
  }

  private getOriginFromUrl(url: string): string | null {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  /**
   * Safely restore sessionStorage when the page is on the expected origin
   */
  private async restoreSessionStorage(
    sessionData: Record<string, string>,
    entryCount: number
  ): Promise<void> {
    if (!this.page) {
      log.warning(`  ⚠️  Cannot restore sessionStorage without an active page`);
      return;
    }

    const targetOrigin = this.getOriginFromUrl(this.notebookUrl);
    if (!targetOrigin) {
      log.warning(`  ⚠️  Unable to determine target origin for sessionStorage restore`);
      return;
    }

    let restored = false;

    const applyToPage = async (): Promise<boolean> => {
      if (!this.page) {
        return false;
      }

      const currentOrigin = this.getOriginFromUrl(this.page.url());
      if (currentOrigin !== targetOrigin) {
        return false;
      }

      try {
        await this.page.evaluate((data) => {
          for (const [key, value] of Object.entries(data)) {
            sessionStorage.setItem(key, value);
          }
        }, sessionData);
        restored = true;
        log.success(`  ✅ SessionStorage restored: ${entryCount} entries`);
        return true;
      } catch (error) {
        log.warning(`  ⚠️  Failed to restore sessionStorage: ${error}`);
        return false;
      }
    };

    if (await applyToPage()) {
      return;
    }

    log.info(`  ⏳ Waiting for NotebookLM origin before restoring sessionStorage...`);

    const handleNavigation = async () => {
      if (restored) {
        return;
      }

      if (await applyToPage()) {
        this.page?.off("framenavigated", handleNavigation);
      }
    };

    this.page.on("framenavigated", handleNavigation);
  }

  /**
   * Ask a question to NotebookLM
   */
  async ask(
    question: string,
    sendProgress?: ProgressCallback,
    options: { sources?: string[] } = {}
  ): Promise<string> {
    return (await this.askWithCitations(question, "none", sendProgress, options)).formattedAnswer;
  }

  /**
   * Ask, then read the answer's citations, as one locked step — nothing else
   * may click on the tab between the answer and the citation markers.
   */
  async askWithCitations(
    question: string,
    format: SourceFormat,
    sendProgress?: ProgressCallback,
    options: { sources?: string[] } = {}
  ): Promise<ExtractCitationsResult> {
    return this.exclusive("ask_question", async () => {
      const viaRpc = await this.askViaRpc(question, format, sendProgress, options);
      if (viaRpc) return viaRpc;
      const answer = await this.askUnlocked(question, sendProgress, options);
      return this.extractCitationsUnlocked(answer, format);
    });
  }

  /**
   * Ask over the data API: no typing, no DOM answer detection, scoping
   * without touching the checkboxes. Null → the caller types the question.
   */
  private async askViaRpc(
    question: string,
    format: SourceFormat,
    sendProgress?: ProgressCallback,
    options: { sources?: string[] } = {}
  ): Promise<ExtractCitationsResult | null> {
    if (!this.initialized || !this.page || this.isPageClosedSafe()) await this.init();
    await sendProgress?.("Asking NotebookLM...", 3, 5);
    const res = await this.tryRpc("ask_question", () =>
      askRpc(this.page!, this.notebookId(), question, options.sources)
    );
    if (!res) return null;
    const failure = detectFailureReply(res.answer);
    if (failure) throw failureReplyError(failure);
    this.lastScopedSources = res.scopedTo;
    this.messageCount++;
    // The tab's chat only shows this Q&A after a reload.
    this.chatStale = true;
    this.updateActivity();
    log.success(`✅ [${this.sessionId}] Received answer via RPC (${res.answer.length} chars)`);
    return {
      citations: format === "none" ? [] : res.citations,
      formattedAnswer: formatAnswer(res.answer, res.citations, format),
    };
  }

  private async askUnlocked(
    question: string,
    sendProgress?: ProgressCallback,
    options: { sources?: string[] } = {}
  ): Promise<string> {
    this.lastScopedSources = null;
    const askOnce = async (): Promise<string> => {
      // Optional source scoping (sidebar checkboxes); restored afterwards so
      // the notebook's selection is not changed permanently.
      let restoreSelection: Set<string> | null = null;
      if (options.sources) {
        if (!this.initialized || !this.page || this.isPageClosedSafe()) await this.init();
        const scoped = await setChatSources(this.page!, options.sources);
        restoreSelection = scoped.previous;
        this.lastScopedSources = scoped.selected;
        log.info(`  🎯 Chat scoped to ${scoped.selected.length} source(s)`);
      }
      try {
        return await askScoped();
      } finally {
        if (restoreSelection && this.page && !this.isPageClosedSafe()) {
          await restoreChatSources(this.page, restoreSelection).catch((e) =>
            log.warning(`  ⚠️  Could not restore source selection: ${e}`)
          );
        }
      }
    };
    const askScoped = async (): Promise<string> => {
      if (!this.initialized || !this.page || this.isPageClosedSafe()) {
        log.warning(`  ℹ️  Session not initialized or page missing → re-initializing...`);
        await this.init();
      }

      log.info(`💬 [${this.sessionId}] Asking: "${question.substring(0, 100)}..."`);
      const page = this.page!;
      // Ensure we're still authenticated
      await sendProgress?.("Verifying authentication...", 2, 5);
      const isAuth = await this.authManager.validateCookiesExpiry(this.context);
      if (!isAuth) {
        log.warning(`  🔑 Session expired, re-authenticating...`);
        await sendProgress?.("Re-authenticating session...", 2, 5);
        const reAuthSuccess = await this.ensureAuthenticated();
        if (!reAuthSuccess) {
          throw new Error("Failed to re-authenticate session");
        }
      }

      // Snapshot existing responses BEFORE asking — uses the v2 chat module
      // (issue #43). Falls back to the legacy snapshot only if the v2 helper
      // produced nothing, so we don't regress when the new selectors miss.
      log.info(`  📸 Snapshotting existing responses...`);
      let existingResponses = await snapshotPriorAnswers(page);
      if (existingResponses.length === 0) {
        existingResponses = await snapshotAllResponses(page);
      }
      const priorCount = await countAnswers(page);
      log.success(
        `  ✅ Captured ${existingResponses.length} existing responses (${priorCount} bubbles)`
      );

      // Find the chat input
      await dismissPromoDialogs(page);
      const inputSelector = await this.findChatInput();
      if (!inputSelector) {
        throw new Error(
          "Could not find visible chat input element. " +
            "Please check if the notebook page has loaded correctly."
        );
      }

      log.info(`  ⌨️  Typing question with human-like behavior...`);
      await sendProgress?.("Typing question with human-like behavior...", 2, 5);
      await humanType(page, inputSelector, question, {
        withTypos: true,
        wpm: Math.max(CONFIG.typingWpmMin, CONFIG.typingWpmMax),
      });

      // Small pause before submitting
      await randomDelay(500, 1000);

      // Submit the question (Enter key)
      log.info(`  📤 Submitting question...`);
      await sendProgress?.("Submitting question...", 3, 5);
      await page.keyboard.press("Enter");

      // Small pause after submit
      await randomDelay(1000, 1500);

      // Wait for the response with streaming-stability detection (issue #43).
      // Timeout comes from CONFIG.answerTimeoutMs so users can tune it via
      // ANSWER_TIMEOUT_MS or browser_options.timeout_ms (issue #14, #27).
      log.info(`  ⏳ Waiting for response (streaming-stability)...`);
      await sendProgress?.("Waiting for NotebookLM response (streaming-stability)...", 3, 5);
      const answer = await waitForStableAnswer(page, {
        question,
        timeoutMs: CONFIG.answerTimeoutMs,
        pollIntervalMs: 750,
        ignoreTexts: existingResponses,
        priorCount,
      });

      if (!answer) {
        throw new Error("Timeout waiting for response from NotebookLM");
      }

      const failure = detectFailureReply(answer);
      if (failure) throw failureReplyError(failure);

      // Check for rate limit errors AFTER receiving answer
      log.info(`  🔍 Checking for rate limit errors...`);
      if (await this.detectRateLimitError()) {
        throw new RateLimitError();
      }

      // Update session stats
      this.messageCount++;
      this.updateActivity();

      log.success(
        `✅ [${this.sessionId}] Received answer (${answer.length} chars, ${this.messageCount} total messages)`
      );

      return answer;
    };

    try {
      return await askOnce();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/has been closed|Target .* closed|Browser has been closed|Context .* closed/i.test(msg)) {
        log.warning(`  ♻️  Detected closed page/context. Recovering session and retrying ask...`);
        try {
          this.initialized = false;
          if (this.page) {
            try {
              await this.page.close();
            } catch {
              /* page already gone */
            }
          }
          this.page = null;
          await this.init();
          return await askOnce();
        } catch (e2) {
          log.error(`❌ Recovery failed: ${e2}`);
          throw e2;
        }
      }
      log.error(`❌ [${this.sessionId}] Failed to ask question: ${msg}`);
      throw error;
    }
  }

  /**
   * Add a new source (URL or pasted text) to the active notebook page
   * (issue #25). Lazily initialises the session so the caller can use this
   * without first running `ask()`.
   */
  async addSource(input: AddSourceInput): Promise<AddSourceResult> {
    return this.onPage("add_source", async (page) => {
      if (input.type !== "file" && input.content.trim()) {
        const type = input.type;
        const viaRpc = await this.tryRpc("add_source", () =>
          addSourcesRpc(page, this.notebookId(), {
            type,
            content: input.content,
            title: input.title,
          })
        );
        if (viaRpc) {
          // The sidebar does not learn about sources added outside the UI;
          // reload so source listing and scoping see them.
          await this.reloadPage(page, viaRpc.after);
          const ok = viaRpc.failed.length === 0;
          return {
            success: ok,
            type: input.type,
            sourceCountBefore: viaRpc.before,
            sourceCountAfter: viaRpc.after,
            sourceIds: viaRpc.ids,
            message: !ok
              ? `NotebookLM could not process: ${viaRpc.failed.join(", ")}`
              : viaRpc.pending.length
                ? `Added; still processing: ${viaRpc.titles.join(", ")} — usable shortly.`
                : `Added: ${viaRpc.titles.join(", ")}`,
          };
        }
      }
      return addSourceToPage(page, input);
    });
  }

  /**
   * Reload the notebook tab and wait until it is usable again — including the
   * source list, which renders after the chat input (`expectedSources` rows).
   */
  private async reloadPage(page: Page, expectedSources: number): Promise<void> {
    await page.reload({ waitUntil: "domcontentloaded", timeout: CONFIG.browserTimeout });
    this.chatStale = false;
    await this.waitForNotebookLMReady();
    await dismissPromoDialogs(page);
    const rows = page.locator(Selectors.sources.sourceContainer);
    for (let i = 0; i < 40 && (await rows.count()) < expectedSources; i++) {
      await page.waitForTimeout(500);
    }
  }

  /**
   * Generate an Audio Overview for the active notebook (issue #11).
   */
  async generateAudio(options: GenerateAudioOptions = {}): Promise<AudioGenerationResult> {
    const { waitForCompletion = false, timeoutMs = 600_000, ...start } = options;
    const result = await this.onPage("generate_audio", (page) =>
      generateAudioOnPage(page, { ...start, waitForCompletion: false })
    );
    const rendering = result.status === "started" || result.status === "in_progress";
    if (!waitForCompletion || !rendering || start.generateLater) return result;

    // The render runs on Google's side; poll in short locked steps so chat
    // questions and other Studio work can use this tab meanwhile.
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await abortable(new Promise((resolve) => setTimeout(resolve, AUDIO_POLL_MS)));
      const status = await this.getAudioStatus();
      if (status.status === "ready" || status.status === "error") return status;
      const min = Math.round((Date.now() - started) / 60_000);
      void reportProgress(`Waiting for the Audio Overview (${min} min elapsed)…`);
    }
    return {
      status: "in_progress",
      message:
        `Still generating after ${Math.round(timeoutMs / 60_000)} min — ` +
        "poll `get_audio_status`, then call `download_audio`.",
    };
  }

  /**
   * Non-blocking probe for the current Audio Overview state (issue #11).
   */
  async getAudioStatus(): Promise<AudioGenerationResult> {
    return this.onPage("get_audio_status", (page) => getAudioStatusOnPage(page));
  }

  /**
   * Generate any Studio output type via its customise dialog (2026-09 UI).
   */
  async generateStudio(options: GenerateStudioOptions): Promise<GenerateStudioResult> {
    return this.onPage("generate_studio_artifact", async (page) => {
      const viaRpc = await this.tryRpc("generate_studio_artifact", () =>
        generateStudioRpc(page, this.notebookId(), options)
      );
      if (viaRpc) {
        // The Studio panel does not learn about generations started outside
        // the UI; reload so listings (and task polling) see the new item.
        await this.reloadPage(page, viaRpc.sourceCount);
        const { sourceCount: _count, ...result } = viaRpc;
        return result;
      }
      await dismissPromoDialogs(page);
      return await generateStudioArtifact(page, options);
    });
  }

  /**
   * List the Studio library (finished + generating items).
   */
  async listStudio(): Promise<StudioArtifact[]> {
    return this.onPage("list_studio_artifacts", (page) => listStudioArtifacts(page));
  }

  /**
   * Resolve what a delete call would remove, without changing anything.
   */
  async resolveDeleteTarget(
    ref: string,
    kind: "source" | "note" | "studio_item" | undefined,
    isSource: boolean
  ): Promise<DeleteTarget> {
    return this.onPage("delete (resolve)", async (page) => {
      await dismissPromoDialogs(page);
      return isSource
        ? await resolveSourceTarget(page, ref)
        : await resolveStudioTarget(page, ref, kind === "source" ? undefined : kind);
    });
  }

  /**
   * Permanently delete a source (caller must have user confirmation).
   */
  async deleteSource(ref: string): Promise<DeleteResult> {
    return this.onPage("delete_source", async (page) => {
      await dismissPromoDialogs(page);
      return await deleteSourceOnPage(page, ref);
    });
  }

  /**
   * Permanently delete a Studio output or note (caller must have user confirmation).
   */
  async deleteStudioEntry(title: string, kind?: "note" | "studio_item"): Promise<DeleteResult> {
    return this.onPage("delete_studio_artifact", async (page) => {
      await dismissPromoDialogs(page);
      return await deleteStudioEntryOnPage(page, title, kind);
    });
  }

  /**
   * List the notebook's sources (id, title, kind, chat selection), enriched
   * over RPC with type, URL, size, status and origin.
   */
  async listSources(): Promise<Array<NotebookSource & Partial<SourceDetails>>> {
    return this.onPage("list_sources", async (page) => {
      const details = await this.tryRpc("list_sources", () =>
        listSourceDetailsRpc(page, this.notebookId())
      );
      const ui = await listSources(page).catch((error) => {
        if (!details) throw error;
        return [] as NotebookSource[];
      });
      if (!details) return ui;
      const byId = new Map(details.map((d) => [d.id, d]));
      const merged: Array<NotebookSource & Partial<SourceDetails>> = ui.map((s) => {
        const d = byId.get(s.id);
        byId.delete(s.id);
        return d ? { ...s, ...detailFields(d) } : s;
      });
      // Sources added over RPC since the tab last rendered (selected by default).
      for (const d of byId.values()) {
        merged.push({ id: d.id, title: d.title, kind: d.type, selected: true, ...detailFields(d) });
      }
      return merged;
    });
  }

  /**
   * One source in depth: metadata, NotebookLM's source guide and (optionally)
   * a window of the indexed text — the raw material for source criticism.
   */
  async inspectSource(
    ref: string,
    opts: { includeText: boolean; offset: number; maxChars: number }
  ): Promise<InspectedSource> {
    return this.onPage("get_source", async (page) => {
      const details = await this.requireRpc("get_source", () =>
        listSourceDetailsRpc(page, this.notebookId())
      );
      const [id] = await resolveSourceIds(details, [ref]);
      const source = details.find((d) => d.id === id)!;
      const guide = await this.tryRpc("get_source", () => getSourceGuideRpc(page, id)).catch(
        () => null
      );
      const result: InspectedSource = {
        ...source,
        guide: guide ?? { summary: null, keywords: [] },
        warnings: sourceWarnings(source),
      };
      if (opts.includeText) {
        const text = await this.requireRpc("get_source", () => getSourceTextRpc(page, id));
        const start = Math.min(Math.max(0, opts.offset), text.length);
        const end = Math.min(text.length, start + opts.maxChars);
        result.text = {
          content: text.slice(start, end),
          offset: start,
          totalChars: text.length,
          nextOffset: end < text.length ? end : null,
        };
      }
      return result;
    });
  }

  /**
   * NotebookLM's suggested report formats for a source subset (the Reports
   * dialog's "Suggested Template" cards), plus the notebook overview.
   */
  async suggestReports(sources?: string[]): Promise<{
    sources: string[];
    suggestions: ReportSuggestion[];
    overview: NotebookOverview | null;
  }> {
    return this.onPage("suggest_reports", async (page) => {
      const notebookId = this.notebookId();
      const details = await this.requireRpc("suggest_reports", () =>
        listSourceDetailsRpc(page, notebookId)
      );
      if (details.length === 0) throw new Error("This notebook has no sources.");
      const ids = sources?.length
        ? [...(await resolveSourceIds(details, sources))]
        : details.map((d) => d.id);
      const suggestions = await this.requireRpc("suggest_reports", () =>
        suggestReportsRpc(page, notebookId, ids)
      );
      const overview = await this.tryRpc("suggest_reports", () =>
        notebookOverviewRpc(page, notebookId)
      ).catch(() => null);
      return {
        sources: details.filter((d) => ids.includes(d.id)).map((d) => d.title),
        suggestions,
        overview,
      };
    });
  }

  /**
   * Run (or look up) a Fast / Deep Research. Without `query` it reports the
   * newest run (or `taskId`). A query already run in this notebook is
   * answered from history; a running research is reported, not doubled.
   */
  async research(opts: {
    query?: string;
    mode: ResearchMode;
    corpus: ResearchCorpus;
    taskId?: string;
    waitMs: number;
  }): Promise<ResearchOutcome> {
    const notebookId = this.notebookId();
    const list = () =>
      this.onPage("research_sources", (page) =>
        this.requireRpc("research_sources", () => listResearchRpc(page, notebookId))
      );
    const tasks = await list();

    if (!opts.query) {
      const task = opts.taskId ? tasks.find((t) => t.taskId === opts.taskId) : tasks[0];
      if (!task) {
        throw new Error(
          opts.taskId
            ? `No research run ${opts.taskId} in this notebook.`
            : "This notebook has no research runs yet — pass a `query` to start one."
        );
      }
      return { task, origin: "history" };
    }

    const earlier = findEarlierRun(tasks, opts.query, opts.mode, opts.corpus);
    if (earlier) return { task: earlier, origin: "reused" };
    const running = tasks.find((t) => t.status === "running");
    if (running) return { task: running, origin: "busy" };

    const taskId = await this.onPage("research_sources", (page) =>
      this.requireRpc("research_sources", () =>
        startResearchRpc(page, notebookId, opts.query!, opts.corpus, opts.mode)
      )
    );
    // Deep research may re-key its task, so also match by query.
    const want = normalizeQuery(opts.query);
    const find = (all: ResearchTask[]) =>
      all.find((t) => t.taskId === taskId) ??
      all.find((t) => normalizeQuery(t.query) === want && t.mode === opts.mode);
    const started = Date.now();
    let task: ResearchTask | undefined;
    for (;;) {
      task = find(await list());
      if ((task && task.status !== "running") || Date.now() - started >= opts.waitMs) break;
      const secs = Math.round((Date.now() - started) / 1000);
      void reportProgress(`Research running (${secs} s)…`);
      await abortable(new Promise((resolve) => setTimeout(resolve, RESEARCH_POLL_MS)));
    }
    return {
      task: task ?? {
        taskId,
        query: opts.query,
        corpus: opts.corpus,
        mode: opts.mode,
        status: "running",
        summary: null,
        reportTitle: null,
        report: null,
        candidates: [],
        startedAt: new Date(started).toISOString(),
      },
      origin: "started",
    };
  }

  /**
   * Import vetted candidates of a finished research run, wait until
   * NotebookLM has processed them and flag suspiciously thin ones.
   */
  async importResearch(
    taskId: string | undefined,
    selections: ImportSelection[]
  ): Promise<ResearchImportResult> {
    return this.onPage("import_research_sources", async (page) => {
      const notebookId = this.notebookId();
      const tasks = await this.requireRpc("import_research_sources", () =>
        listResearchRpc(page, notebookId)
      );
      const task = taskId
        ? tasks.find((t) => t.taskId === taskId)
        : tasks.find((t) => t.status === "completed");
      if (!task) {
        throw new Error(
          taskId
            ? `No research run ${taskId} in this notebook.`
            : "No finished research run in this notebook — run research_sources first."
        );
      }
      if (task.status !== "completed") {
        throw new Error("That research run is still running — check it with research_sources.");
      }
      const before = await this.requireRpc("import_research_sources", () =>
        listSourceDetailsRpc(page, notebookId)
      );
      const existingUrls = new Set(before.map((s) => s.url).filter((u): u is string => !!u));
      const { accepted, rejected } = vetSelections(task, selections, existingUrls);
      if (accepted.length === 0) {
        return { taskId: task.taskId, imported: [], rejected };
      }

      const added = await this.requireRpc("import_research_sources", () =>
        importResearchRpc(
          page,
          notebookId,
          task.taskId,
          accepted.map((a) => a.candidate)
        )
      );
      const ids = new Set(added.map((a) => a.id));
      const deadline = Date.now() + 90_000;
      let now = await listSourceDetailsRpc(page, notebookId);
      while (Date.now() < deadline && now.some((s) => ids.has(s.id) && s.status === "processing")) {
        await page.waitForTimeout(2_000);
        now = await listSourceDetailsRpc(page, notebookId);
      }
      await this.reloadPage(page, now.length);

      const imported = now
        .filter((s) => ids.has(s.id))
        .map((s) => {
          const vet = accepted.find((a) => a.candidate.url === s.url);
          return {
            ...detailFields(s),
            id: s.id,
            title: s.title,
            reliability: vet?.reliability ?? null,
            reason: vet?.reason ?? null,
            warnings: sourceWarnings(s),
          };
        });
      return { taskId: task.taskId, imported, rejected };
    });
  }

  /**
   * Pin a chat answer as a note (latest answer, or the answer to `question`).
   */
  async saveAnswerAsNote(question?: string): Promise<SavedNote> {
    return this.onPage("save_answer_as_note", async (page) => {
      // Answers asked over RPC are not in the tab's chat until it reloads.
      if (this.chatStale) {
        await this.reloadPage(page, 0);
        this.chatStale = false;
      }
      await dismissPromoDialogs(page);
      return await saveAnswerAsNoteOnPage(page, question);
    });
  }

  /**
   * Turn a note (or all notes) into source(s).
   */
  async convertNoteToSource(opts: { title?: string; all?: boolean }): Promise<ConvertResult> {
    return this.onPage("convert_note_to_source", async (page) => {
      await dismissPromoDialogs(page);
      return await convertNoteToSourceOnPage(page, opts);
    });
  }

  /**
   * Read or change the notebook's chat configuration.
   */
  async configureChat(input: ChatConfigInput): Promise<ChatConfigResult> {
    return this.onPage("configure_chat", async (page) => {
      const viaRpc = await this.tryRpc("configure_chat", () =>
        configureChatRpc(page, this.notebookId(), input)
      );
      if (viaRpc) return viaRpc;
      await dismissPromoDialogs(page);
      return await configureChatOnPage(page, input);
    });
  }

  /**
   * Read the AI usage & limits dialog.
   */
  async getUsage(): Promise<UsageInfo> {
    return this.onPage("get_usage", async (page) => {
      const viaRpc = await this.tryRpc("get_usage", () =>
        readUsageRpc(page, `/notebook/${this.notebookId()}`)
      );
      if (viaRpc) return viaRpc;
      await dismissPromoDialogs(page);
      return await readUsage(page);
    });
  }

  private notebookId(): string {
    const id = notebookUuidFromUrl(this.notebookUrl);
    if (!id) throw new Error(`Not a notebook URL: ${this.notebookUrl}`);
    return id;
  }

  /**
   * Run an RPC-based implementation; on RpcError (protocol changed) log it and
   * return null so the caller falls back to the UI path. Other errors (bad
   * input, auth) are real and propagate.
   */
  private async requireRpc<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!rpcEnabled()) {
      throw new Error(`${label} needs the RPC API, which NOTEBOOKLM_USE_RPC=false turned off.`);
    }
    try {
      return await fn();
    } catch (error) {
      if (error instanceof RpcError && error.code !== 16) {
        throw new Error(
          `${label}: NotebookLM's API did not answer as expected (${error.message}). ` +
            "Google may have changed it; this operation has no UI fallback.",
          { cause: error }
        );
      }
      throw error;
    }
  }

  private async tryRpc<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    if (!rpcEnabled()) return null;
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RpcError) || error.code === 16) throw error;
      log.warning(`  ⚠️  ${label}: RPC path failed (${error.message}) — using the UI instead`);
      return null;
    }
  }

  /**
   * Download the most recent Audio Overview (issue #11).
   */
  async downloadAudio(destinationDir: string): Promise<DownloadAudioResult> {
    return this.onPage("download_audio", (page) => downloadAudioOnPage(page, destinationDir));
  }

  /**
   * Save a Studio output to `destinationDir` via the RPC API. Only the lookup
   * holds the tab; media files are fetched with the context's HTTP client.
   */
  async downloadStudio(
    want: { artifactId?: string; type?: string; format?: StudioDownloadFormat },
    destinationDir: string
  ): Promise<StudioDownloadResult> {
    const notebookId = this.notebookId();
    const plan = await this.onPage("download_studio_artifact", (page) =>
      resolveStudioDownload(page, notebookId, want)
    );

    let body: Buffer;
    if (plan.kind === "text") {
      body = Buffer.from(plan.content, "utf8");
    } else {
      const resp = await abortable(
        this.context.request.get(plan.url, { timeout: 600_000, maxRedirects: 10 })
      );
      const type = resp.headers()["content-type"] ?? "";
      if (!resp.ok() || type.startsWith("text/html")) {
        throw new Error(
          `Download of ${plan.artifact.type} failed (HTTP ${resp.status()}${type ? `, ${type}` : ""}). ` +
            "A freshly finished render can take a minute to propagate — retry shortly."
        );
      }
      body = await resp.body();
    }

    await fs.mkdir(destinationDir, { recursive: true });
    const name = studioFileName(plan.artifact, plan.ext);
    let filePath = path.join(destinationDir, name);
    for (
      let n = 2;
      await fs.stat(filePath).then(
        () => true,
        () => false
      );
      n++
    ) {
      filePath = path.join(destinationDir, name.replace(/(\.[^.]+)$/, ` (${n})$1`));
    }
    await fs.writeFile(filePath, body);
    log.success(`  ✅ ${plan.artifact.type} saved: ${filePath} (${body.length} bytes)`);
    return { artifact: plan.artifact, file_path: filePath, bytes: body.length, format: plan.ext };
  }

  /**
   * Pull DOM-level citations from the most recent answer on this session's
   * page (issue #20). Must be called immediately after `ask()` — before any
   * follow-up question disturbs the source panel.
   */
  async extractCitations(answer: string, format: SourceFormat): Promise<ExtractCitationsResult> {
    return this.exclusive("extract citations", () => this.extractCitationsUnlocked(answer, format));
  }

  private async extractCitationsUnlocked(
    answer: string,
    format: SourceFormat
  ): Promise<ExtractCitationsResult> {
    if (format === "none" || !this.page || this.isPageClosedSafe()) {
      return { citations: [], formattedAnswer: answer };
    }
    try {
      return await extractCitationsFromPage(this.page, answer, format);
    } catch (err) {
      log.warning(`  ⚠️  Citation extraction failed: ${err}`);
      return { citations: [], formattedAnswer: answer };
    }
  }

  /**
   * Find the chat input element
   *
   * IMPORTANT: Matches Python implementation EXACTLY!
   * - Uses SPECIFIC selectors from Python
   * - Checks ONLY visibility (NOT disabled state!)
   *
   * Based on Python ask() method from browser_session.py:166-171
   */
  private async findChatInput(): Promise<string | null> {
    if (!this.page) {
      return null;
    }

    const selectors = [
      // Stable class — language-agnostic.
      "textarea.query-box-input",
      // Locale-bound aria-label fallbacks for older builds.
      'textarea[aria-label="Feld für Anfragen"]',
      'textarea[aria-label*="anfrag" i]',
      // Excludes the sidebar web-source search box, whose aria-label also
      // contains "query".
      'textarea:not(.query-box-textarea)[aria-label*="query" i]',
      'textarea[aria-label*="zone de requete" i]',
      'textarea[aria-label*="requete" i]',
      'textarea[aria-label*="consulta" i]',
      'textarea[aria-label*="domanda" i]',
    ];

    const tryFind = async (): Promise<string | null> => {
      for (const selector of selectors) {
        try {
          const element = await this.page!.$(selector);
          if (element && (await element.isVisible())) {
            return selector;
          }
        } catch {
          continue;
        }
      }
      return null;
    };

    let hit = await tryFind();
    if (hit) {
      log.success(`  ✅ Found chat input: ${hit}`);
      return hit;
    }

    // Recovery: chat input is most often hidden because (a) a leftover Add-
    // source / customise modal is still mounted, (b) a citation source-panel
    // is open, or (c) we navigated to `?addSource=true` and never cleaned the
    // URL up. Try all three remedies and re-probe.
    log.warning("  ⚠️  Chat input not visible, attempting recovery…");
    try {
      await this.page.keyboard.press("Escape").catch(() => undefined);
      await this.page.keyboard.press("Escape").catch(() => undefined);
      await randomDelay(200, 400);
      hit = await tryFind();
      if (hit) {
        log.success(`  ✅ Found chat input after Escape: ${hit}`);
        return hit;
      }

      const url = this.page.url();
      if (url.includes("addSource=true") || url.includes("?")) {
        const cleanUrl = url.replace(/[?&]addSource=true/g, "").replace(/&$/, "");
        if (cleanUrl !== url) {
          log.info(`  ↻ Cleaning URL state: ${url} → ${cleanUrl}`);
          await this.page
            .goto(cleanUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
            .catch(() => undefined);
          await randomDelay(800, 1200);
          hit = await tryFind();
          if (hit) {
            log.success(`  ✅ Found chat input after URL clean: ${hit}`);
            return hit;
          }
        }
      }

      // Last resort: reload the notebook page entirely.
      log.warning("  ⚠️  Reloading notebook page as last resort…");
      await this.page
        .goto(this.notebookUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => undefined);
      await randomDelay(1500, 2500);
      hit = await tryFind();
      if (hit) {
        log.success(`  ✅ Found chat input after reload: ${hit}`);
        return hit;
      }
    } catch (err) {
      log.warning(`  ⚠️  Recovery failed: ${err}`);
    }

    log.error("  ❌ Could not find visible chat input");
    return null;
  }

  /**
   * Detect if a rate limit error occurred
   *
   * Searches the page for error messages indicating rate limit/quota exhaustion.
   * Usage is metered (rolling window + weekly limit) since 2026-09.
   *
   * @returns true if rate limit error detected, false otherwise
   */
  private async detectRateLimitError(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    // Error message selectors (common patterns for error containers)
    const errorSelectors = [
      ".error-message",
      ".error-container",
      "[role='alert']",
      ".rate-limit-message",
      "[data-error]",
      ".notification-error",
      ".alert-error",
      ".toast-error",
    ];

    // Keywords that indicate rate limiting
    const keywords = [
      "rate limit",
      "limit exceeded",
      "quota exhausted",
      "daily limit",
      "limit reached",
      "too many requests",
      "ratenlimit",
      "quota",
      "query limit",
      "request limit",
      "usage limit",
    ];

    // Check error containers for rate limit messages
    for (const selector of errorSelectors) {
      try {
        const elements = await this.page.$$(selector);
        for (const el of elements) {
          try {
            const text = await el.innerText();
            const lower = text.toLowerCase();

            if (keywords.some((k) => lower.includes(k))) {
              log.error(`🚫 Rate limit detected: ${text.slice(0, 100)}`);
              return true;
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    // Also check if chat input is disabled (sometimes NotebookLM disables input when rate limited)
    try {
      const inputSelector = "textarea.query-box-input";
      const input = await this.page.$(inputSelector);
      if (input) {
        const isDisabled = await input.evaluate((el) => {
          return (
            (el as HTMLTextAreaElement).disabled || (el as HTMLElement).hasAttribute("disabled")
          );
        });

        if (isDisabled) {
          // Check if there's an error message near the input
          const parent = await input.evaluateHandle((el) => el.parentElement);
          const parentEl = parent.asElement();
          if (parentEl) {
            try {
              const parentText = await parentEl.innerText();
              const lower = parentText.toLowerCase();
              if (keywords.some((k) => lower.includes(k))) {
                log.error(`🚫 Rate limit detected: Chat input disabled with error message`);
                return true;
              }
            } catch {
              // Ignore
            }
          }
        }
      }
    } catch {
      // Ignore errors checking input state
    }

    return false;
  }

  /**
   * Reset the chat history (start a new conversation)
   */
  async reset(): Promise<void> {
    return this.exclusive("reset_session", () => this.resetUnlocked());
  }

  private async resetUnlocked(): Promise<void> {
    const resetOnce = async (): Promise<void> => {
      if (!this.initialized || !this.page || this.isPageClosedSafe()) {
        await this.init();
      }
      log.info(`🔄 [${this.sessionId}] Resetting chat history...`);
      // Reload the page to clear chat history
      await (this.page as Page).reload({ waitUntil: "domcontentloaded" });
      await randomDelay(2000, 3000);

      // Wait for interface to be ready again
      await this.waitForNotebookLMReady();

      // Reset message count
      this.messageCount = 0;
      this.chatStale = false;
      this.updateActivity();

      log.success(`✅ [${this.sessionId}] Chat history reset`);
    };

    try {
      await resetOnce();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/has been closed|Target .* closed|Browser has been closed|Context .* closed/i.test(msg)) {
        log.warning(`  ♻️  Detected closed page/context during reset. Recovering and retrying...`);
        this.initialized = false;
        if (this.page) {
          try {
            await this.page.close();
          } catch {
            /* page already gone */
          }
        }
        this.page = null;
        await this.init();
        await resetOnce();
        return;
      }
      log.error(`❌ [${this.sessionId}] Failed to reset: ${msg}`);
      throw error;
    }
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    log.info(`🛑 Closing session ${this.sessionId}...`);

    if (this.page) {
      try {
        await this.page.close();
        this.page = null;
        log.success(`  ✅ Page closed`);
      } catch (error) {
        log.warning(`  ⚠️  Error closing page: ${error}`);
      }
    }

    this.initialized = false;
    log.success(`✅ Session ${this.sessionId} closed`);
  }

  /**
   * Update last activity timestamp
   */
  updateActivity(): void {
    this.lastActivity = Date.now();
  }

  /**
   * Check if session has expired (inactive for too long)
   */
  isExpired(timeoutSeconds: number): boolean {
    const inactiveSeconds = (Date.now() - this.lastActivity) / 1000;
    return inactiveSeconds > timeoutSeconds;
  }

  /**
   * Get session information
   */
  getInfo(): SessionInfo {
    const now = Date.now();
    return {
      id: this.sessionId,
      created_at: this.createdAt,
      last_activity: this.lastActivity,
      age_seconds: (now - this.createdAt) / 1000,
      inactive_seconds: (now - this.lastActivity) / 1000,
      message_count: this.messageCount,
      notebook_url: this.notebookUrl,
      current_operation: this.lock.current,
      queued_operations: this.lock.queued,
    };
  }

  /**
   * Get the underlying page (for advanced operations)
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * Check if session is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.page !== null;
  }
}
