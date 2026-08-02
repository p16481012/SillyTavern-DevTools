import { CaptureController } from './src/capture.js';
import { t } from './src/i18n.js';
import {
    UI_PREFERENCES_KEY,
    V1_UI_PREFERENCES_KEY,
    V2_UI_PREFERENCES_KEY,
    V3_UI_PREFERENCES_KEY,
    V4_UI_PREFERENCES_KEY,
    legacyUiPreferencesForExistingData,
    readUiPreferencesFromStorage,
} from './src/preferences.js';
import { applyAutomaticRetentionMaintenance } from './src/retention-maintenance.js';
import { SemanticCaptureGate } from './src/semantic-capture-gate.js';
import { SemanticInspector } from './src/semantic-inspector.js';
import { SemanticProviderAdapter } from './src/semantic-provider-adapter.js';
import { SnapshotStore } from './src/storage.js';
import { DevToolsWindow } from './src/ui.js';

const EXTENSION_ID = 'st-devtools';
const VERSION = '0.13.0';
const REQUIRED_EVENTS = [
    'CHAT_COMPLETION_PROMPT_READY',
    'GENERATE_AFTER_COMBINE_PROMPTS',
];

let initialized = false;

function readStoredUiPreferences() {
    return readUiPreferencesFromStorage(localStorage);
}

async function applyConfiguredRetention(store, {
    preferences = readStoredUiPreferences(),
} = {}) {
    return applyAutomaticRetentionMaintenance(store, preferences);
}

async function preserveLegacyRetentionForExistingData(store) {
    let preferencesReadable = true;
    try {
        if (
            localStorage.getItem(UI_PREFERENCES_KEY) != null
            || localStorage.getItem(V4_UI_PREFERENCES_KEY) != null
            || localStorage.getItem(V3_UI_PREFERENCES_KEY) != null
            || localStorage.getItem(V2_UI_PREFERENCES_KEY) != null
            || localStorage.getItem(V1_UI_PREFERENCES_KEY) != null
        ) {
            return null;
        }
    } catch {
        preferencesReadable = false;
    }
    const summary = await store.getStorageSummary();
    if ((Number(summary?.chatCount) || 0) === 0) return null;
    const legacyPreferences = legacyUiPreferencesForExistingData();
    if (preferencesReadable) {
        try {
            localStorage.setItem(
                UI_PREFERENCES_KEY,
                JSON.stringify(legacyPreferences),
            );
            return null;
        } catch {
            // Keep the conservative legacy limit in memory when writes are blocked.
        }
    }
    return legacyPreferences;
}

function validateContext(context) {
    const events = context?.eventTypes ?? context?.event_types ?? {};
    const missing = REQUIRED_EVENTS.filter((name) => !(name in events));

    if (missing.length > 0) {
        throw new Error(`Missing SillyTavern events: ${missing.join(', ')}`);
    }

    if (!context?.eventSource || typeof context.eventSource.on !== 'function') {
        throw new Error('SillyTavern event source is unavailable.');
    }
}

function createLaunchButton(openWindow) {
    if (document.getElementById(`${EXTENSION_ID}-launch`)) {
        return true;
    }

    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        return false;
    }

    const button = document.createElement('div');
    button.id = `${EXTENSION_ID}-launch`;
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.tabIndex = 0;
    button.title = t('app.open');

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-code';
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = 'ST DevTools';

    button.append(icon, label);
    button.addEventListener('click', openWindow);
    button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openWindow();
        }
    });

    menu.appendChild(button);
    return true;
}

async function initialize() {
    if (initialized) {
        return;
    }

    const context = globalThis.SillyTavern?.getContext?.();
    validateContext(context);

    const store = new SnapshotStore({
        namespace: 'st-devtools',
        maxSnapshotsPerChat: 100,
    });
    await store.initialize();
    const storagePreferenceFallback = await preserveLegacyRetentionForExistingData(store);
    const currentPreferences = () => {
        if (!storagePreferenceFallback) return readStoredUiPreferences();
        try {
            if (localStorage.getItem(UI_PREFERENCES_KEY) != null) {
                return readStoredUiPreferences();
            }
        } catch {
            // Continue using the conservative in-memory migration.
        }
        return storagePreferenceFallback;
    };
    await applyConfiguredRetention(store, {
        preferences: currentPreferences(),
    });

    let semanticCaptureGate = null;
    let semanticInspector = null;
    try {
        semanticCaptureGate = new SemanticCaptureGate();
        const semanticProviderAdapter = new SemanticProviderAdapter({
            getContext: () => globalThis.SillyTavern.getContext(),
            captureGate: semanticCaptureGate,
            getConnectionProfileId: () => (
                currentPreferences().semanticConnectionProfileId
            ),
        });
        semanticInspector = new SemanticInspector({
            adapter: semanticProviderAdapter,
        });
    } catch {
        console.warn('[ST DevTools] Optional semantic inspector is unavailable.');
    }

    const capture = new CaptureController({
        getContext: () => globalThis.SillyTavern.getContext(),
        store,
        version: VERSION,
        getCaptureMode: () => currentPreferences().captureMode,
        semanticCaptureGate,
    });
    let retentionMaintenancePending = false;
    let retentionMaintenanceDirty = false;
    const scheduleRetentionMaintenance = () => {
        retentionMaintenanceDirty = true;
        if (retentionMaintenancePending) return;
        retentionMaintenancePending = true;
        setTimeout(async () => {
            try {
                while (retentionMaintenanceDirty) {
                    retentionMaintenanceDirty = false;
                    await applyConfiguredRetention(store, {
                        preferences: currentPreferences(),
                    });
                }
            } catch (error) {
                console.error('[ST DevTools] Retention maintenance failed.', error);
            } finally {
                retentionMaintenancePending = false;
                if (retentionMaintenanceDirty) scheduleRetentionMaintenance();
            }
        }, 0);
    };
    capture.addEventListener('snapshot', scheduleRetentionMaintenance);
    const devToolsWindow = new DevToolsWindow({
        getContext: () => globalThis.SillyTavern.getContext(),
        store,
        capture,
        version: VERSION,
        semanticInspector,
    });

    capture.start();

    let attempts = 0;
    const attachButton = () => {
        attempts += 1;
        if (createLaunchButton(() => devToolsWindow.open()) || attempts >= 30) {
            return;
        }
        setTimeout(attachButton, 250);
    };

    attachButton();
    initialized = true;
    console.info(`[ST DevTools] v${VERSION} initialized in read-only capture mode.`);
}

function reportInitializationError(error) {
    console.error('[ST DevTools] Initialization failed.', error);
    globalThis.toastr?.error?.(
        t('app.initializationError'),
        'ST DevTools',
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initialize().catch(reportInitializationError), { once: true });
} else {
    initialize().catch(reportInitializationError);
}
