/**
 * Chromezone Self-Service Kiosk
 * Lightweight, offline-first troubleshooting app for ChromeOS
 * 
 * Performance notes:
 * - No background polling or timers
 * - Event delegation for minimal listeners
 * - Lazy-load flows on demand
 * - No external dependencies
 */

(function() {
  'use strict';

  // ========================================
  // State Management (minimal, local only)
  // ========================================
  const state = {
    config: null,
    flows: null,
    currentFlow: null,
    currentStepIndex: 0,
    stepHistory: [],
    isOnline: navigator.onLine
  };

  // ========================================
  // DOM References (cached once)
  // ========================================
  const dom = {
    app: null,
    screens: {},
    header: {},
    flow: {},
    escalation: {},
    diagnostics: {},
    success: {},
    offlineBanner: null
  };

  // Auto-redirect timer for success screen
  let successTimer = null;
  let countdownInterval = null;
  const SUCCESS_TIMEOUT = 30; // seconds

  // ========================================
  // Initialization
  // ========================================
  async function init() {
    cacheDomReferences();
    await loadConfig();
    await loadFlows();
    setupEventListeners();
    setupOnlineOfflineHandlers();
    applyConfig();
    showScreen('home');
    
    // Register service worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('service-worker.js');
      } catch (e) {
        console.warn('Service worker registration failed:', e);
      }
    }
  }

  function cacheDomReferences() {
    dom.app = document.getElementById('app');
    
    // Screens
    dom.screens.home = document.getElementById('screen-home');
    dom.screens.flow = document.getElementById('screen-flow');
    dom.screens.escalation = document.getElementById('screen-escalation');
    dom.screens.diagnostics = document.getElementById('screen-diagnostics');
    dom.screens.success = document.getElementById('screen-success');
    
    // Header
    dom.header.districtName = document.getElementById('district-name');
    dom.header.btnHome = document.getElementById('btn-home');
    dom.header.btnDiagnostics = document.getElementById('btn-diagnostics');
    
    // Flow
    dom.flow.title = document.getElementById('flow-heading');
    dom.flow.progress = document.getElementById('flow-progress');
    dom.flow.progressText = dom.flow.progress.querySelector('.progress-text');
    dom.flow.progressFill = dom.flow.progress.querySelector('.progress-fill');
    dom.flow.instruction = document.getElementById('step-instruction');
    dom.flow.details = document.getElementById('step-details');
    dom.flow.detailsContent = document.getElementById('step-details-content');
    dom.flow.warning = document.getElementById('step-warning');
    dom.flow.warningText = document.getElementById('step-warning-text');
    dom.flow.requiresInternet = document.getElementById('step-requires-internet');
    dom.flow.btnFixed = document.getElementById('btn-fixed');
    dom.flow.btnNotFixed = document.getElementById('btn-not-fixed');
    dom.flow.btnBackStep = document.getElementById('btn-back-step');
    
    // Escalation
    dom.escalation.offlineNotice = document.getElementById('offline-notice');
    
    // Success screen countdown
    dom.success.countdown = document.getElementById('success-countdown');
    dom.success.seconds = document.getElementById('countdown-seconds');
    
    // Diagnostics
    dom.diagnostics.online = document.getElementById('diag-online');
    dom.diagnostics.datetime = document.getElementById('diag-datetime');
    dom.diagnostics.browser = document.getElementById('diag-browser');
    dom.diagnostics.platform = document.getElementById('diag-platform');
    dom.diagnostics.screen = document.getElementById('diag-screen');
    dom.diagnostics.version = document.getElementById('diag-version');
    
    // Offline banner
    dom.offlineBanner = document.getElementById('offline-banner');
  }

  // ========================================
  // Data Loading
  // ========================================
  async function loadConfig() {
    try {
      const response = await fetch('config.json');
      state.config = await response.json();
    } catch (e) {
      console.warn('Could not load config, using defaults:', e);
      state.config = getDefaultConfig();
    }
  }

  async function loadFlows() {
    try {
      const response = await fetch('flows.json');
      state.flows = await response.json();
    } catch (e) {
      console.error('Could not load flows:', e);
      state.flows = {};
    }
  }

  function getDefaultConfig() {
    return {
      districtName: 'Chromezone',
      enabledFlows: ['signin', 'wifi', 'powerwash', 'printing', 'slow', 'other'],
      version: '1.0.0'
    };
  }

  // ========================================
  // Configuration Application
  // ========================================
  function applyConfig() {
    const config = state.config;
    
    // District name
    if (config.districtName) {
      dom.header.districtName.textContent = config.districtName;
      document.title = `${config.districtName} Self-Service Kiosk`;
    }
    
    // Version
    if (config.version) {
      dom.diagnostics.version.textContent = config.version;
    }
    
    // Hide disabled flows
    const tiles = document.querySelectorAll('.tile[data-flow]');
    tiles.forEach(tile => {
      const flowId = tile.dataset.flow;
      if (config.enabledFlows && !config.enabledFlows.includes(flowId)) {
        tile.hidden = true;
      }
    });
  }

  // ========================================
  // Event Listeners (Event Delegation)
  // ========================================
  function setupEventListeners() {
    // Single delegated listener for all clicks
    dom.app.addEventListener('click', handleClick);
    
    // Keyboard navigation
    document.addEventListener('keydown', handleKeyboard);
  }

  function handleClick(e) {
    const target = e.target.closest('[data-flow], #btn-home, #btn-diagnostics, #btn-fixed, #btn-not-fixed, #btn-back-step, #btn-success-home');
    
    if (!target) return;
    
    // Tile click - start flow
    if (target.dataset.flow) {
      startFlow(target.dataset.flow);
      return;
    }
    
    // Navigation buttons
    switch (target.id) {
      case 'btn-home':
      case 'btn-success-home':
        goHome();
        break;
      case 'btn-diagnostics':
        showDiagnostics();
        break;
      case 'btn-fixed':
        handleFixed();
        break;
      case 'btn-not-fixed':
        handleNotFixed();
        break;
      case 'btn-back-step':
        goToPreviousStep();
        break;
    }
  }

  function handleKeyboard(e) {
    // Escape key goes home
    if (e.key === 'Escape') {
      goHome();
    }
  }

  // ========================================
  // Online/Offline Handling
  // ========================================
  function setupOnlineOfflineHandlers() {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    updateOnlineStatus();
  }

  function handleOnline() {
    state.isOnline = true;
    updateOnlineStatus();
  }

  function handleOffline() {
    state.isOnline = false;
    updateOnlineStatus();
  }

  function updateOnlineStatus() {
    dom.offlineBanner.hidden = state.isOnline;
    dom.escalation.offlineNotice.hidden = state.isOnline;
    
    // Update diagnostics if visible
    if (dom.screens.diagnostics.classList.contains('active')) {
      updateDiagnosticsDisplay();
    }
  }

  // ========================================
  // Screen Navigation
  // ========================================
  function showScreen(screenName) {
    // Hide all screens
    Object.values(dom.screens).forEach(screen => {
      screen.hidden = true;
      screen.classList.remove('active');
    });
    
    // Clear any existing countdown when leaving success screen
    clearSuccessCountdown();
    
    // Show requested screen
    const screen = dom.screens[screenName];
    if (screen) {
      screen.hidden = false;
      screen.classList.add('active');
      
      // Focus management for accessibility
      const heading = screen.querySelector('h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
      
      // Start countdown if showing success screen
      if (screenName === 'success') {
        startSuccessCountdown();
      }
    }
    
    // Update header home button visibility
    dom.header.btnHome.hidden = (screenName === 'home');
    
    // Scroll to top
    window.scrollTo(0, 0);
  }

  function goHome() {
    clearSuccessCountdown();
    state.currentFlow = null;
    state.currentStepIndex = 0;
    state.stepHistory = [];
    showScreen('home');
  }

  // ========================================
  // Success Screen Countdown
  // ========================================
  function startSuccessCountdown() {
    let secondsLeft = SUCCESS_TIMEOUT;
    
    // Update display
    dom.success.seconds.textContent = secondsLeft;
    
    // Start countdown interval
    countdownInterval = setInterval(() => {
      secondsLeft--;
      dom.success.seconds.textContent = secondsLeft;
      
      if (secondsLeft <= 0) {
        clearSuccessCountdown();
        goHome();
      }
    }, 1000);
  }

  function clearSuccessCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (successTimer) {
      clearTimeout(successTimer);
      successTimer = null;
    }
  }

  // ========================================
  // Flow Management
  // ========================================
  function startFlow(flowId) {
    const flow = state.flows[flowId];
    
    if (!flow) {
      // If flow not found, go to escalation
      showEscalation(flowId);
      return;
    }
    
    state.currentFlow = flow;
    state.currentStepIndex = 0;
    state.stepHistory = [];
    
    renderStep();
    showScreen('flow');
  }

  function renderStep() {
    const flow = state.currentFlow;
    const stepIndex = state.currentStepIndex;
    const step = flow.steps[stepIndex];
    
    if (!step) {
      showEscalation();
      return;
    }
    
    // Title
    dom.flow.title.textContent = flow.title;
    
    // Progress
    const totalSteps = countTotalSteps(flow);
    const currentStepNum = stepIndex + 1;
    dom.flow.progressText.textContent = `Step ${currentStepNum} of ${totalSteps}`;
    dom.flow.progress.setAttribute('aria-valuemax', totalSteps);
    dom.flow.progress.setAttribute('aria-valuenow', currentStepNum);
    dom.flow.progressFill.style.width = `${(currentStepNum / totalSteps) * 100}%`;
    
    // Instruction
    dom.flow.instruction.innerHTML = formatText(step.instruction);
    
    // Ticket URL with QR code (if present)
    if (step.ticketUrl) {
      renderTicketSection(step.ticketUrl);
    } else {
      hideTicketSection();
    }
    
    // Details (accordion)
    if (step.details) {
      dom.flow.details.hidden = false;
      dom.flow.detailsContent.innerHTML = formatText(step.details);
      dom.flow.details.removeAttribute('open');
    } else {
      dom.flow.details.hidden = true;
    }
    
    // Warning
    if (step.warning) {
      dom.flow.warning.hidden = false;
      dom.flow.warningText.textContent = step.warning;
    } else {
      dom.flow.warning.hidden = true;
    }
    
    // Internet required
    dom.flow.requiresInternet.hidden = !step.requiresInternet;
    
    // Back button
    dom.flow.btnBackStep.hidden = (state.stepHistory.length === 0);
    
    // Button labels
    if (step.fixedLabel) {
      dom.flow.btnFixed.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg> ${step.fixedLabel}`;
    } else {
      dom.flow.btnFixed.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg> This fixed it`;
    }
    
    if (step.notFixedLabel) {
      dom.flow.btnNotFixed.innerHTML = `${step.notFixedLabel} <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
    } else {
      dom.flow.btnNotFixed.innerHTML = `Still not fixed <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
    }
    
    // Hide fixed button if step is not fixable (e.g., branching questions)
    if (step.type === 'branch') {
      dom.flow.btnFixed.hidden = true;
      dom.flow.btnNotFixed.textContent = '';
      renderBranchOptions(step);
    } else {
      dom.flow.btnFixed.hidden = false;
    }
  }

  // ========================================
  // Ticket URL / QR Code Section
  // ========================================
  function renderTicketSection(url) {
    let container = document.getElementById('step-ticket-section');
    
    // Create the container if it doesn't exist
    if (!container) {
      container = document.createElement('div');
      container.id = 'step-ticket-section';
      container.className = 'step-ticket-section';
      // Insert after instruction
      dom.flow.instruction.parentNode.insertBefore(container, dom.flow.instruction.nextSibling);
    }
    
    if (state.isOnline) {
      const size = 150;
      const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(url)}&choe=UTF-8`;
      
      container.innerHTML = `
        <div class="ticket-qr-wrapper">
          <img src="${qrUrl}" alt="QR code to submit ticket" width="${size}" height="${size}" class="ticket-qr-image">
        </div>
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="ticket-link">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          Open Ticket Form
        </a>
      `;
      container.hidden = false;
    } else {
      container.innerHTML = `
        <div class="ticket-offline-warning">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
            <line x1="12" y1="20" x2="12.01" y2="20"></line>
          </svg>
          <div>
            <strong>You're offline</strong>
            <p>Connect to Wi-Fi to submit a ticket, or visit the ChromeZone in person.</p>
          </div>
        </div>
      `;
      container.hidden = false;
    }
  }

  function hideTicketSection() {
    const container = document.getElementById('step-ticket-section');
    if (container) {
      container.hidden = true;
    }
  }

  function renderBranchOptions(step) {
    // For branch-type steps, render options as buttons
    const optionsHtml = step.options.map((opt, index) => 
      `<button class="btn btn-secondary branch-option" data-branch-index="${index}" style="margin-bottom: var(--space-sm); width: 100%;">${opt.label}</button>`
    ).join('');
    
    dom.flow.instruction.innerHTML += `<div class="branch-options" style="margin-top: var(--space-lg);">${optionsHtml}</div>`;
    
    // Add click handlers for branch options
    const options = dom.flow.instruction.querySelectorAll('.branch-option');
    options.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.branchIndex, 10);
        handleBranchSelection(step.options[index]);
      });
    });
    
    // Hide the main action buttons for branch steps
    dom.flow.btnNotFixed.hidden = true;
  }

  function handleBranchSelection(option) {
    if (option.gotoStep !== undefined) {
      state.stepHistory.push(state.currentStepIndex);
      state.currentStepIndex = option.gotoStep;
      renderStep();
    } else if (option.gotoFlow) {
      startFlow(option.gotoFlow);
    } else if (option.escalate) {
      showEscalation();
    } else {
      // Default: go to next step
      handleNotFixed();
    }
  }

  function handleFixed() {
    const flow = state.currentFlow;
    const step = flow.steps[state.currentStepIndex];
    
    // If step has a ticket URL, open it instead of showing success
    if (step && step.ticketUrl) {
      if (state.isOnline) {
        window.open(step.ticketUrl, '_blank', 'noopener,noreferrer');
        // Still show success after opening
        showScreen('success');
      } else {
        alert('You need to be connected to the internet to submit a ticket. Please connect to Wi-Fi and try again, or visit the ChromeZone in person.');
      }
      return;
    }
    
    showScreen('success');
  }

  function handleNotFixed() {
    const flow = state.currentFlow;
    const step = flow.steps[state.currentStepIndex];
    
    // Check for custom next step
    if (step.nextStep !== undefined) {
      state.stepHistory.push(state.currentStepIndex);
      state.currentStepIndex = step.nextStep;
    } else {
      // Go to next sequential step
      state.stepHistory.push(state.currentStepIndex);
      state.currentStepIndex++;
    }
    
    // Check if we've reached the end
    if (state.currentStepIndex >= flow.steps.length) {
      showEscalation();
      return;
    }
    
    renderStep();
  }

  function goToPreviousStep() {
    if (state.stepHistory.length > 0) {
      state.currentStepIndex = state.stepHistory.pop();
      renderStep();
    }
  }

  function countTotalSteps(flow) {
    // Count only non-branch steps for progress
    return flow.steps.filter(s => s.type !== 'branch').length || flow.steps.length;
  }

  // ========================================
  // Escalation Screen
  // ========================================
  function showEscalation() {
    showScreen('escalation');
  }

  // ========================================
  // Diagnostics Screen
  // ========================================
  function showDiagnostics() {
    updateDiagnosticsDisplay();
    showScreen('diagnostics');
  }

  function updateDiagnosticsDisplay() {
    // Online status
    dom.diagnostics.online.textContent = state.isOnline ? 'Online' : 'Offline';
    dom.diagnostics.online.className = `diagnostic-value ${state.isOnline ? 'online' : 'offline'}`;
    
    // Date/time
    dom.diagnostics.datetime.textContent = new Date().toLocaleString();
    
    // Browser info (sanitized, no identity data)
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    if (ua.includes('Chrome')) {
      const match = ua.match(/Chrome\/(\d+)/);
      browser = match ? `Chrome ${match[1]}` : 'Chrome';
    } else if (ua.includes('Firefox')) {
      browser = 'Firefox';
    } else if (ua.includes('Safari')) {
      browser = 'Safari';
    }
    dom.diagnostics.browser.textContent = browser;
    
    // Platform
    let platform = 'Unknown';
    if (ua.includes('CrOS')) {
      platform = 'ChromeOS';
    } else if (ua.includes('Windows')) {
      platform = 'Windows';
    } else if (ua.includes('Mac')) {
      platform = 'macOS';
    } else if (ua.includes('Linux')) {
      platform = 'Linux';
    }
    dom.diagnostics.platform.textContent = platform;
    
    // Screen size
    dom.diagnostics.screen.textContent = `${window.innerWidth} × ${window.innerHeight}`;
  }

  // ========================================
  // Utility Functions
  // ========================================
  function formatText(text) {
    if (!text) return '';
    
    // Convert markdown-like syntax to HTML
    // Bold: **text**
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Keyboard keys: `key`
    text = text.replace(/`([^`]+)`/g, '<kbd>$1</kbd>');
    
    // Line breaks
    text = text.replace(/\n/g, '<br>');
    
    // Numbered lists (simple)
    text = text.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
    if (text.includes('<li>')) {
      text = text.replace(/(<li>.*<\/li>)/gs, '<ol>$1</ol>');
      // Clean up extra <br> inside lists
      text = text.replace(/<br><li>/g, '<li>');
      text = text.replace(/<\/li><br>/g, '</li>');
    }
    
    return text;
  }

  // ========================================
  // Start Application
  // ========================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
