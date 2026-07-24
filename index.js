import { CaptureController } from './src/capture.js';
import { t } from './src/i18n.js';
import { SnapshotStore } from './src/storage.js';
import { DevToolsWindow } from './src/ui.js';

const EXTENSION_ID = 'st-devtools';
const VERSION = '0.2.0';
const REQUIRED_EVENTS = [
    'CHAT_COMPLETION_PROMPT_READY',
    'GENERATE_AFTER_COMBINE_PROMPTS',
];

let initialized = false;

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

    const capture = new CaptureController({
        getContext: () => globalThis.SillyTavern.getContext(),
        store,
        version: VERSION,
    });
    const devToolsWindow = new DevToolsWindow({
        getContext: () => globalThis.SillyTavern.getContext(),
        store,
        capture,
        version: VERSION,
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
