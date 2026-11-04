// Workspace Application Logic
let dbData = { categories: [], items: [] };
let activeTypeFilter = 'all'; // 'all', 'link', 'file', 'note'
let activeCategoryFilter = null; // null means all categories
let searchQuery = '';
let workspaceFolders = [];

// Workspace Management State
let workspaces = [];
let activeWorkspaceId = 'default';

// ================================================================
// Global Fetch Interceptor for Authentication
// ================================================================
const _nativeFetch = window.fetch;
window.fetch = async function (resource, init = {}) {
  const url = typeof resource === 'string' ? resource : resource.url;
  const initCopy = { ...init };
  const headers = new Headers(initCopy.headers || {});

  const token = localStorage.getItem('workspace_hub_auth_token');
  if (token && !headers.has('Authorization') && (typeof url === 'string' && url.startsWith('/api/'))) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  initCopy.headers = headers;

  const res = await _nativeFetch.call(this, resource, initCopy);
  return res;
};

// DOM Elements - Workspaces
const workspaceSelect = document.getElementById('workspace-select');
const btnAddWorkspace = document.getElementById('btn-add-workspace');
const btnDeleteWorkspace = document.getElementById('btn-delete-workspace');
const modalAddWorkspace = document.getElementById('modal-add-workspace');
const btnCloseWsModal = document.getElementById('btn-close-ws-modal');
const formAddWorkspace = document.getElementById('form-add-workspace');

// DOM Elements - General UI
const itemsGrid = document.getElementById('items-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const categoriesList = document.getElementById('categories-list');
const filterStatusBar = document.getElementById('filter-status-bar');
const activeCategoryLabel = document.getElementById('active-category-label');
const btnClearCategoryFilter = document.getElementById('btn-clear-category-filter');

// Modals
const modalAddItem = document.getElementById('modal-add-item');
const modalAddCategory = document.getElementById('modal-add-category');

// Buttons to open modals
const btnNewItem = document.getElementById('btn-new-item');
const btnEmptyAdd = document.getElementById('btn-empty-add');
const btnAddCategory = document.getElementById('btn-add-category');

// Buttons to close modals
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCloseCatModal = document.getElementById('btn-close-cat-modal');

// Sidebar filters
const filterAll = document.getElementById('filter-all');
const filterLinks = document.getElementById('filter-links');
const filterFiles = document.getElementById('filter-files');
const filterNotes = document.getElementById('filter-notes');

// Stats Elements
const countAll = document.getElementById('count-all');
const countLinks = document.getElementById('count-links');
const countFiles = document.getElementById('count-files');
const countNotes = document.getElementById('count-notes');
const statFilesCount = document.getElementById('stat-files-count');
const statFilesSize = document.getElementById('stat-files-size');

// Forms & Tab switching
const modalTabs = document.querySelectorAll('.tab-btn');
const modalForms = document.querySelectorAll('.modal-form-tab');
const formAddLink = document.getElementById('form-add-link');
const formUploadFile = document.getElementById('form-upload-file');
const formAddNote = document.getElementById('form-add-note');
const formAddCategory = document.getElementById('form-add-category');

// File Upload Specifics
const fileDropzone = document.getElementById('file-dropzone');
const fileInput = document.getElementById('file-input');
const selectedFileInfo = document.getElementById('selected-file-info');
const fileNameLabel = document.getElementById('file-name-label');
const btnRemoveFile = document.getElementById('btn-remove-file');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const uploadProgressText = document.getElementById('upload-progress-text');
const btnSubmitUpload = document.getElementById('btn-submit-upload');

// Helper for safely executing lucide.createIcons
function safeCreateIcons() {
  if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
    try {
      lucide.createIcons();
    } catch (e) {
      console.warn('lucide.createIcons error:', e);
    }
  }
}

// Helper for DOM readiness that works reliably even if DOMContentLoaded already fired
function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn);
  } else {
    // DOM is already ready
    fn();
  }
}

// ================================================================
// Authentication & User Session Module
// ================================================================
const Auth = (function () {
  const TOKEN_KEY = 'workspace_hub_auth_token';
  let currentUser = null;
  let authToken = localStorage.getItem(TOKEN_KEY) || null;

  // DOM Elements
  const modalAuth = document.getElementById('modal-auth');
  const btnCloseAuthModal = document.getElementById('btn-close-auth-modal');
  const btnOpenAuth = document.getElementById('btn-open-auth');
  const userProfileMenuContainer = document.getElementById('user-profile-menu-container');
  const btnUserProfile = document.getElementById('btn-user-profile');
  const userAvatarDisplay = document.getElementById('user-avatar-display');
  const userDisplayName = document.getElementById('user-display-name');
  const userDropdownMenu = document.getElementById('user-dropdown-menu');
  const userDropdownAvatar = document.getElementById('user-dropdown-avatar');
  const dropdownUserName = document.getElementById('dropdown-user-name');
  const dropdownUserEmail = document.getElementById('dropdown-user-email');
  const btnDropdownProfile = document.getElementById('btn-dropdown-profile');
  const btnDropdownWorkspace = document.getElementById('btn-dropdown-workspace');
  const btnDropdownLogout = document.getElementById('btn-dropdown-logout');

  // Auth Modal tabs & forms
  const tabBtnLogin = document.getElementById('tab-btn-login');
  const tabBtnRegister = document.getElementById('tab-btn-register');
  const formAuthLogin = document.getElementById('form-auth-login');
  const formAuthRegister = document.getElementById('form-auth-register');
  const authAlert = document.getElementById('auth-alert');
  const authAlertMessage = document.getElementById('auth-alert-message');
  const authModalTitle = document.getElementById('auth-modal-title');
  const btnGoogleSignin = document.getElementById('btn-google-signin');
  const btnDemoLogin = document.getElementById('btn-demo-login');

  // Account Settings Modal
  const modalUserSettings = document.getElementById('modal-user-settings');
  const btnCloseSettingsModal = document.getElementById('btn-close-settings-modal');
  const btnSettingsCancel = document.getElementById('btn-settings-cancel');
  const formUpdateProfile = document.getElementById('form-update-profile');
  const profilePreviewAvatar = document.getElementById('profile-preview-avatar');
  const profileInfoName = document.getElementById('profile-info-name');
  const profileInfoEmail = document.getElementById('profile-info-email');
  const profileInfoProvider = document.getElementById('profile-info-provider');
  const settingsName = document.getElementById('settings-name');
  const settingsCurrentPassword = document.getElementById('settings-current-password');
  const settingsNewPassword = document.getElementById('settings-new-password');
  const passwordChangeSection = document.getElementById('password-change-section');

  function getAvatarLetter(name, email) {
    if (name && name.trim()) return name.trim().charAt(0).toUpperCase();
    if (email && email.trim()) return email.trim().charAt(0).toUpperCase();
    return 'U';
  }

  function updateAvatarElement(el, user) {
    if (!el) return;
    if (user && user.avatar) {
      el.textContent = '';
      el.style.backgroundImage = `url("${user.avatar}")`;
    } else {
      el.style.backgroundImage = 'none';
      el.textContent = user ? getAvatarLetter(user.name, user.email) : 'U';
    }
  }

  function updateUIForUser(user) {
    currentUser = user;
    if (user) {
      if (btnOpenAuth) btnOpenAuth.style.display = 'none';
      if (userProfileMenuContainer) userProfileMenuContainer.style.display = 'block';
      if (userDisplayName) userDisplayName.textContent = user.name || 'User';
      if (dropdownUserName) dropdownUserName.textContent = user.name || 'User';
      if (dropdownUserEmail) dropdownUserEmail.textContent = user.email || '';

      updateAvatarElement(userAvatarDisplay, user);
      updateAvatarElement(userDropdownAvatar, user);
      updateAvatarElement(profilePreviewAvatar, user);

      if (profileInfoName) profileInfoName.textContent = user.name || 'User';
      if (profileInfoEmail) profileInfoEmail.textContent = user.email || '';
      if (profileInfoProvider) {
        const providerLabel = user.role === 'admin'
          ? 'Admin Account'
          : user.provider === 'google'
            ? 'Google Account'
            : 'Email Account';
        profileInfoProvider.textContent = providerLabel;
      }
      if (settingsName) settingsName.value = user.name || '';
      if (passwordChangeSection) {
        passwordChangeSection.style.display = user.provider === 'google' ? 'none' : 'block';
      }
    } else {
      if (btnOpenAuth) btnOpenAuth.style.display = 'inline-flex';
      if (userProfileMenuContainer) userProfileMenuContainer.style.display = 'none';
      if (userDropdownMenu) userDropdownMenu.style.display = 'none';
    }
    safeCreateIcons();
  }

  const welcomePage = document.getElementById('welcome-page');
  const appContainer = document.getElementById('app-container') || document.querySelector('.app-container');
  const welcomeUserBanner = document.getElementById('welcome-user-banner');
  const welcomeBannerUsername = document.getElementById('welcome-banner-username');

  function showWelcomePage(show, { isReturningUser = false } = {}) {
    if (!welcomePage) return;
    if (show) {
      welcomePage.style.display = 'flex';
      welcomePage.style.opacity = '1';
      document.body.classList.add('on-welcome-page');

      const user = currentUser;
      if (user || isReturningUser) {
        if (welcomeUserBanner) {
          welcomeUserBanner.style.display = 'block';
          if (welcomeBannerUsername) {
            welcomeBannerUsername.textContent = (user && user.name) ? user.name : 'User';
          }
        }
      } else {
        if (welcomeUserBanner) welcomeUserBanner.style.display = 'none';
      }

      if (appContainer) {
        appContainer.style.display = 'none';
      }
    } else {
      welcomePage.style.opacity = '0';
      welcomePage.style.display = 'none';
      document.body.classList.remove('on-welcome-page');
      if (welcomeUserBanner) welcomeUserBanner.style.display = 'none';
      if (appContainer) {
        appContainer.style.display = 'flex';
      }
    }
    safeCreateIcons();
  }

  function openAuthModal(tab = 'login', { allowClose = true } = {}) {
    hideAuthAlert();
    switchTab(tab);
    if (modalAuth) modalAuth.classList.add('active');

    // Show/hide close button depending on whether login is mandatory
    const closeBtn = document.getElementById('btn-close-auth-modal');
    if (closeBtn) closeBtn.style.display = allowClose ? 'inline-flex' : 'none';

    // Also block backdrop click when not closeable
    if (modalAuth) {
      modalAuth._allowClose = allowClose;
    }

    // Ensure demo button remains easily accessible
    const demoFooter = document.getElementById('auth-demo-footer');
    if (demoFooter) {
      demoFooter.style.display = 'block';
    }

    safeCreateIcons();
  }

  function closeAuthModal() {
    if (modalAuth) modalAuth.classList.remove('active');
    hideAuthAlert();
  }

  function switchTab(tab) {
    hideAuthAlert();
    if (tab === 'login') {
      if (tabBtnLogin) tabBtnLogin.classList.add('active');
      if (tabBtnRegister) tabBtnRegister.classList.remove('active');
      if (formAuthLogin) formAuthLogin.style.display = 'block';
      if (formAuthRegister) formAuthRegister.style.display = 'none';
      if (authModalTitle) authModalTitle.textContent = 'Welcome Back';
    } else {
      if (tabBtnLogin) tabBtnLogin.classList.remove('active');
      if (tabBtnRegister) tabBtnRegister.classList.add('active');
      if (formAuthLogin) formAuthLogin.style.display = 'none';
      if (formAuthRegister) formAuthRegister.style.display = 'block';
      if (authModalTitle) authModalTitle.textContent = 'Create Your Account';
    }
    safeCreateIcons();
  }

  function showAuthAlert(message, type = 'error') {
    if (!authAlert || !authAlertMessage) return;
    authAlert.className = `auth-alert ${type}`;
    authAlertMessage.textContent = message;
    authAlert.style.display = 'flex';
    safeCreateIcons();
  }

  function hideAuthAlert() {
    if (authAlert) authAlert.style.display = 'none';
  }

  async function handleDemoLogin() {
    hideAuthAlert();
    try {
      if (typeof showToast === 'function') {
        showToast('Entering Live Demo Mode...', 'sparkles');
      }
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'demo@workspace.local', password: 'demo1234' })
      });
      const data = await res.json();
      if (!res.ok) {
        // If demo account not registered yet on local server, register it
        const regRes = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Demo User', email: 'demo@workspace.local', password: 'demo1234' })
        });
        const regData = await regRes.json();
        if (!regRes.ok) {
          showAuthAlert(regData.error || 'Failed to start demo mode');
          return false;
        }
        setSession(regData.token, regData.user);
      } else {
        setSession(data.token, data.user);
      }
      closeAuthModal();
      showWelcomePage(false);
      if (typeof showToast === 'function') {
        showToast('Welcome to Live Demo mode! Enjoy exploring your workspace.', 'sparkles');
      }
      await initWorkspaceHub();
      return true;
    } catch (err) {
      console.error('Demo error:', err);
      showAuthAlert('Failed to connect to local server for demo mode.');
      return false;
    }
  }

  async function handleLogin(email, password) {
    hideAuthAlert();
    try {
      const cleanEmail = (email || '').trim().toLowerCase();

      // If demo credentials, use demo login directly
      if (cleanEmail === 'demo@workspace.local') {
        return await handleDemoLogin();
      }

      let supabaseError = null;
      const useSupabase = !cleanEmail.endsWith('.local') &&
        window.SupabaseManager && window.SupabaseManager.isConfigured();

      // 1. Real email accounts: try Supabase Cloud Auth first. On serverless hosts
      // (Vercel) the local users.json store does not exist / persist.
      if (useSupabase) {
        try {
          const { user, session } = await window.SupabaseManager.signIn(cleanEmail, password);
          const userData = {
            id: user.id,
            email: user.email,
            name: user.user_metadata?.name || user.user_metadata?.full_name || user.email.split('@')[0] || 'User',
            avatar: user.user_metadata?.avatar_url || null,
            provider: 'supabase',
            role: 'client'
          };
          setSession(session.access_token, userData);
          closeAuthModal();
          if (typeof showToast === 'function') {
            showToast(`Welcome back, ${userData.name}!`, 'shield-check');
          }
          await initWorkspaceHub();
          return true;
        } catch (sbErr) {
          console.warn('[AUTH] Supabase sign in failed, trying local account:', sbErr.message);
          supabaseError = sbErr.message || null;
        }
      }

      // 2. Local account fallback (works when running the server locally).
      let localLoginError = null;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password })
        });
        const data = await res.json();

        if (res.ok) {
          setSession(data.token, data.user);
          closeAuthModal();
          if (typeof showToast === 'function') {
            showToast(`Welcome back, ${data.user.name}!`, 'shield-check');
          }
          await initWorkspaceHub();
          return true;
        }

        localLoginError = data.error || null;
      } catch (localErr) {
        console.warn('[AUTH] Local login failed:', localErr.message);
        localLoginError = localErr.message || null;
      }

      // Prefer the Supabase error (e.g. "Email not confirmed") since it is more specific.
      showAuthAlert(supabaseError || localLoginError || 'Failed to sign in. Please check your credentials.');
      return false;
    } catch (err) {
      console.error('Login error:', err);
      showAuthAlert(err.message || 'Failed to sign in. Please check your credentials.');
      return false;
    }
  }

  async function handleRegister(name, email, password) {
    hideAuthAlert();
    try {
      const cleanEmail = (email || '').trim().toLowerCase();
      // 1. If Supabase is configured, try Supabase Cloud Auth (unless local domain)
      if (!cleanEmail.endsWith('.local') && window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        try {
          const { user, session } = await window.SupabaseManager.signUp(name, cleanEmail, password);
          if (!session && user) {
            showAuthAlert('Account created! Please check your email to confirm registration.', 'info');
            return true;
          }
          const userData = {
            id: user.id,
            email: user.email,
            name: name.trim(),
            avatar: null,
            provider: 'supabase',
            role: 'client'
          };
          const token = session ? session.access_token : `sb_user_${user.id}`;
          setSession(token, userData);
          closeAuthModal();
          if (typeof showToast === 'function') {
            showToast(`Account created! Welcome, ${name}! ☁️ Your workspace is cloud-synced.`, 'check-circle-2');
          }
          await initWorkspaceHub();
          return true;
        } catch (sbErr) {
          console.warn('[AUTH] Supabase sign up failed, trying local fallback:', sbErr.message);
          // If Supabase sign up failed, fall through to local fallback
        }
      }

      // 2. Local Fallback Auth
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: cleanEmail, password })
      });
      const data = await res.json();
      if (!res.ok) {
        showAuthAlert(data.error || 'Failed to create account');
        return false;
      }
      setSession(data.token, data.user);
      closeAuthModal();
      if (typeof showToast === 'function') {
        showToast(`Account created! Welcome, ${data.user.name}!`, 'check-circle-2');
      }
      await initWorkspaceHub();
      return true;
    } catch (err) {
      console.error('Register error:', err);
      showAuthAlert(err.message || 'Failed to create account. Please try again.');
      return false;
    }
  }

  async function handleGoogleAuth(credential, profile) {
    hideAuthAlert();
    try {
      if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        await window.SupabaseManager.signInWithGoogle();
        return true;
      }

      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, profile })
      });
      const data = await res.json();
      if (!res.ok) {
        showAuthAlert(data.error || 'Google Sign-In failed');
        return false;
      }
      setSession(data.token, data.user);
      closeAuthModal();
      if (typeof showToast === 'function') {
        showToast(`Signed in as ${data.user.name}!`, 'shield-check');
      }
      await initWorkspaceHub();
      return true;
    } catch (err) {
      console.error('Google Auth error:', err);
      showAuthAlert('Google Sign-In error. Please try again.');
      return false;
    }
  }

  function setSession(token, user) {
    authToken = token;
    currentUser = user;
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      showWelcomePage(false);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    if (user && !user.role) {
      user.role = 'client';
    }
    updateUIForUser(user);
  }

  async function clearSession() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem(TOKEN_KEY);
    updateUIForUser(null);
    if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
      try {
        await window.SupabaseManager.signOut();
      } catch (e) { }
    }
  }

  async function checkSession() {
    // 1. Check Supabase session first if Supabase is active
    if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
      try {
        const session = await window.SupabaseManager.getSession();
        if (session && session.user) {
          const u = session.user;
          const user = {
            id: u.id,
            email: u.email,
            name: u.user_metadata?.name || u.user_metadata?.full_name || u.email.split('@')[0] || 'User',
            avatar: u.user_metadata?.avatar_url || null,
            provider: 'supabase',
            role: 'client'
          };
          setSession(session.access_token, user);
          return user;
        }
      } catch (e) {
        console.warn('Supabase checkSession warning:', e);
      }
    }

    // 2. Token fallback (for demo accounts, local auth, or restored tokens)
    if (!authToken) {
      updateUIForUser(null);
      return null;
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSession(authToken, data.user);
        return data.user;
      } else {
        clearSession();
        return null;
      }
    } catch (e) {
      console.warn('Check session warning:', e);
      return null;
    }
  }

  function setupEvents() {
    // Password show/hide toggle
    document.querySelectorAll('.btn-toggle-password').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}"></i>`;
        safeCreateIcons();
      });
    });

    // Auth modal open/close
    if (btnOpenAuth) {
      // Header Sign In button — user voluntarily opens it, can close it
      btnOpenAuth.addEventListener('click', () => openAuthModal('login', { allowClose: true }));
    }
    if (btnCloseAuthModal) {
      btnCloseAuthModal.addEventListener('click', closeAuthModal);
    }
    if (modalAuth) {
      modalAuth.addEventListener('click', (e) => {
        // Only close on backdrop click if modal was opened with allowClose
        if (e.target === modalAuth && modalAuth._allowClose) closeAuthModal();
      });
    }

    // Tab buttons
    if (tabBtnLogin) {
      tabBtnLogin.addEventListener('click', () => switchTab('login'));
    }
    if (tabBtnRegister) {
      tabBtnRegister.addEventListener('click', () => switchTab('register'));
    }

    // Login submit
    if (formAuthLogin) {
      formAuthLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const submitBtn = document.getElementById('btn-submit-login');
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Signing In...</span>';
        await handleLogin(email, password);
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        safeCreateIcons();
      });
    }

    // Register submit
    if (formAuthRegister) {
      formAuthRegister.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;

        if (password !== confirmPassword) {
          showAuthAlert('Passwords do not match');
          return;
        }

        const submitBtn = document.getElementById('btn-submit-register');
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Creating Account...</span>';
        await handleRegister(name, email, password);
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        safeCreateIcons();
      });
    }

    // Google Sign-In button
    if (btnGoogleSignin) {
      btnGoogleSignin.addEventListener('click', () => {
        // Try Google Identity Services
        if (window.google && window.google.accounts && window.google.accounts.id) {
          try {
            google.accounts.id.prompt((notification) => {
              if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                fallbackGoogleDialog();
              }
            });
            return;
          } catch (e) {
            console.warn('Google One-Tap exception, using prompt dialog:', e);
          }
        }
        fallbackGoogleDialog();
      });
    }

    function fallbackGoogleDialog() {
      const email = prompt('Enter your Google Email address for Google Sign-In:', currentUser?.email || 'user@gmail.com');
      if (email && email.includes('@')) {
        const name = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        handleGoogleAuth(null, {
          email: email.trim(),
          name: name,
          picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`,
          id: `google_${Date.now()}`
        });
      }
    }

    // Quick Demo account
    if (btnDemoLogin) {
      btnDemoLogin.addEventListener('click', (e) => {
        e.preventDefault();
        handleDemoLogin();
      });
    }

    // User Dropdown toggle
    if (btnUserProfile) {
      btnUserProfile.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = userDropdownMenu.style.display === 'none' || !userDropdownMenu.style.display;
        userDropdownMenu.style.display = isHidden ? 'block' : 'none';
        btnUserProfile.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
      });
    }

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (userDropdownMenu && !userDropdownMenu.contains(e.target) && !btnUserProfile.contains(e.target)) {
        userDropdownMenu.style.display = 'none';
        if (btnUserProfile) btnUserProfile.setAttribute('aria-expanded', 'false');
      }
    });

    // Account Settings Modal
    if (btnDropdownProfile) {
      btnDropdownProfile.addEventListener('click', () => {
        if (userDropdownMenu) userDropdownMenu.style.display = 'none';
        if (modalUserSettings) modalUserSettings.classList.add('active');
        safeCreateIcons();
      });
    }

    if (btnDropdownWorkspace) {
      btnDropdownWorkspace.addEventListener('click', () => {
        if (userDropdownMenu) userDropdownMenu.style.display = 'none';
        if (btnAddWorkspace) btnAddWorkspace.click();
      });
    }

    if (btnCloseSettingsModal) {
      btnCloseSettingsModal.addEventListener('click', () => modalUserSettings.classList.remove('active'));
    }
    if (btnSettingsCancel) {
      btnSettingsCancel.addEventListener('click', () => modalUserSettings.classList.remove('active'));
    }
    if (modalUserSettings) {
      modalUserSettings.addEventListener('click', (e) => {
        if (e.target === modalUserSettings) modalUserSettings.classList.remove('active');
      });
    }

    // Update Profile Submit
    if (formUpdateProfile) {
      formUpdateProfile.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = settingsName.value.trim();
        const currentPassword = settingsCurrentPassword ? settingsCurrentPassword.value : '';
        const newPassword = settingsNewPassword ? settingsNewPassword.value : '';

        try {
          const res = await fetch('/api/auth/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, currentPassword, newPassword })
          });
          const data = await res.json();
          if (!res.ok) {
            alert(data.error || 'Failed to update profile');
            return;
          }
          setSession(data.token, data.user);
          modalUserSettings.classList.remove('active');
          if (settingsCurrentPassword) settingsCurrentPassword.value = '';
          if (settingsNewPassword) settingsNewPassword.value = '';
          if (typeof showToast === 'function') {
            showToast('Profile updated successfully!', 'check');
          }
        } catch (err) {
          console.error(err);
          alert('Error updating profile');
        }
      });
    }

    // Welcome Page Action Triggers
    const btnWelcomeDemoNav = document.getElementById('btn-welcome-demo-nav');
    const btnWelcomeLoginNav = document.getElementById('btn-welcome-login-nav');
    const btnWelcomeRegisterNav = document.getElementById('btn-welcome-register-nav');
    const btnHeroRegister = document.getElementById('btn-hero-register');
    const btnHeroLogin = document.getElementById('btn-hero-login');
    const btnHeroDemo = document.getElementById('btn-hero-demo');
    const btnBannerRegister = document.getElementById('btn-banner-register');
    const btnBannerDemo = document.getElementById('btn-banner-demo');
    const btnBannerReturn = document.getElementById('btn-banner-return');
    const btnDropdownWelcome = document.getElementById('btn-dropdown-welcome');

    if (btnWelcomeLoginNav) {
      btnWelcomeLoginNav.addEventListener('click', () => openAuthModal('login', { allowClose: true }));
    }
    if (btnHeroLogin) {
      btnHeroLogin.addEventListener('click', () => openAuthModal('login', { allowClose: true }));
    }
    if (btnWelcomeRegisterNav) {
      btnWelcomeRegisterNav.addEventListener('click', () => openAuthModal('register', { allowClose: true }));
    }
    if (btnHeroRegister) {
      btnHeroRegister.addEventListener('click', () => openAuthModal('register', { allowClose: true }));
    }
    if (btnBannerRegister) {
      btnBannerRegister.addEventListener('click', () => openAuthModal('register', { allowClose: true }));
    }

    // Demo triggers
    function launchDemoMode(e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      handleDemoLogin();
    }

    if (btnWelcomeDemoNav) btnWelcomeDemoNav.addEventListener('click', launchDemoMode);
    if (btnHeroDemo) btnHeroDemo.addEventListener('click', launchDemoMode);
    if (btnBannerDemo) btnBannerDemo.addEventListener('click', launchDemoMode);

    if (btnBannerReturn) {
      btnBannerReturn.addEventListener('click', () => showWelcomePage(false));
    }

    if (btnDropdownWelcome) {
      btnDropdownWelcome.addEventListener('click', () => {
        if (userDropdownMenu) userDropdownMenu.style.display = 'none';
        showWelcomePage(true, { isReturningUser: true });
      });
    }

    // Logout
    if (btnDropdownLogout) {
      btnDropdownLogout.addEventListener('click', async () => {
        if (userDropdownMenu) userDropdownMenu.style.display = 'none';
        // 1. Immediately reset workspace state and navigate to welcome page for instant response
        dbData = { categories: [], items: [] };
        workspaces = [];
        if (typeof renderGridItems === 'function') renderGridItems();
        showWelcomePage(true);
        if (typeof showToast === 'function') {
          showToast('Signed out successfully', 'log-out');
        }
        // 2. Perform background logout cleanup
        try {
          fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        } catch (e) { }
        await clearSession();
      });
    }
  }

  return {
    getToken: () => authToken,
    getUser: () => currentUser,
    checkSession,
    openAuthModal,
    closeAuthModal,
    showWelcome: showWelcomePage,
    setupEvents,
    handleGoogleAuth,
    handleDemoLogin,
    setSession,
    clearSession,
    updateUI: () => updateUIForUser(currentUser)
  };
})();

// Expose Auth globally for direct button access
window.Auth = Auth;

// Load data on page load
onReady(async () => {
  safeCreateIcons();

  // 1. Immediately setup all button and auth event listeners so UI is responsive without delay
  try {
    Auth.setupEvents();
  } catch (err) {
    console.error('Error setting up Auth events:', err);
  }

  // 2. Initialize Supabase Manager in non-blocking try-catch
  if (window.SupabaseManager) {
    try {
      await window.SupabaseManager.init();

      // Listen for Auth state changes across tabs/devices
      const client = window.SupabaseManager.getClient();
      if (client) {
        let lastHubUserId = null;
        client.auth.onAuthStateChange((event, session) => {
          // Defer out of the auth callback so we never call Supabase inside it (deadlock/loop risk)
          setTimeout(async () => {
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
              if (session && session.user) {
                const u = session.user;
                Auth.setSession(session.access_token, {
                  id: u.id,
                  email: u.email,
                  name: u.user_metadata?.name || u.user_metadata?.full_name || u.email?.split('@')[0] || 'User',
                  avatar: u.user_metadata?.avatar_url || null,
                  provider: 'supabase'
                });
                showAppLoading(false);
                Auth.showWelcome(false);
                // Reload the hub only when the signed-in user actually changes,
                // not on token refreshes / tab-focus SIGNED_IN repeats.
                if (lastHubUserId !== u.id) {
                  lastHubUserId = u.id;
                  await initWorkspaceHub();
                }
              }
            } else if (event === 'SIGNED_OUT') {
              lastHubUserId = null;
              _realtimeSubscribedWorkspaceId = null;
              authToken = null;
              currentUser = null;
              localStorage.removeItem(TOKEN_KEY);
              Auth.updateUI();
              showAppLoading(false);
              Auth.showWelcome(true);
            }
          }, 0);
        });
      }
    } catch (sbErr) {
      console.warn('Supabase initialization warning:', sbErr);
    }
  }

  // 3. Check existing user session
  let loggedInUser = null;
  try {
    loggedInUser = await Auth.checkSession();
  } catch (err) {
    console.warn('Check session error:', err);
  }

  // ── KEY BEHAVIOUR ──
  // If no one is logged in → show the Welcoming Landing Page first!
  if (!loggedInUser) {
    showAppLoading(false);
    Auth.showWelcome(true);
    setupEventListeners();
    return; // User can choose to sign in or explore demo
  }

  Auth.showWelcome(false);
  showAppLoading(false);
  await initWorkspaceHub();
  setupEventListeners();
});

// Show/hide a full-screen loading overlay during startup
function showAppLoading(show) {
  let overlay = document.getElementById('app-startup-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'app-startup-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:var(--bg-base, #0b0f19)',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'gap:16px', 'transition:opacity 0.3s ease'
    ].join(';');
    overlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span style="font-family:Outfit,sans-serif;font-size:24px;font-weight:700;color:#e2e8f0;letter-spacing:-0.5px;">Workspace Hub</span>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <span style="width:8px;height:8px;background:#6366f1;border-radius:50%;animation:dotPulse 1.2s ease-in-out infinite;"></span>
        <span style="width:8px;height:8px;background:#6366f1;border-radius:50%;animation:dotPulse 1.2s ease-in-out 0.2s infinite;"></span>
        <span style="width:8px;height:8px;background:#6366f1;border-radius:50%;animation:dotPulse 1.2s ease-in-out 0.4s infinite;"></span>
      </div>
      <style>@keyframes dotPulse{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}</style>
    `;
    document.body.appendChild(overlay);
  }
  if (show) {
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
  } else {
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
  }
}

// Initialize workspace listing and then load active data
async function initWorkspaceHub() {
  await fetchWorkspaces();
  await fetchWorkspaceData();
}

// Fetch list of workspaces
async function fetchWorkspaces(preferredActiveId) {
  try {
    if (preferredActiveId) {
      activeWorkspaceId = preferredActiveId;
    }

    // 1. Supabase Cloud Workspaces
    if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
      const sbData = await window.SupabaseManager.fetchWorkspaces();
      if (sbData && sbData.workspaces) {
        workspaces = sbData.workspaces;
        if (preferredActiveId && workspaces.some(w => w.id === preferredActiveId)) {
          activeWorkspaceId = preferredActiveId;
        } else if (!workspaces.some(w => w.id === activeWorkspaceId)) {
          activeWorkspaceId = sbData.activeWorkspace || (workspaces[0] ? workspaces[0].id : 'default');
        }
        window.workspaces = workspaces;
        window.activeWorkspaceId = activeWorkspaceId;
        localStorage.setItem('activeWorkspaceId', activeWorkspaceId);
        renderWorkspacesDropdown();
        return;
      }
    }

    // 2. Local Fallback Workspaces
    const response = await fetch('/api/workspaces');
    if (!response.ok) throw new Error('Failed to load workspaces');

    const data = await response.json();
    workspaces = data.workspaces || [];
    if (preferredActiveId && workspaces.some(w => w.id === preferredActiveId)) {
      activeWorkspaceId = preferredActiveId;
    } else if (!workspaces.some(w => w.id === activeWorkspaceId)) {
      activeWorkspaceId = data.activeWorkspace || (workspaces[0] ? workspaces[0].id : 'default');
    }

    window.workspaces = workspaces;
    window.activeWorkspaceId = activeWorkspaceId;
    localStorage.setItem('activeWorkspaceId', activeWorkspaceId);
    renderWorkspacesDropdown();
  } catch (error) {
    console.error('Error fetching workspaces:', error);
  }
}

// Populates and sets active workspace selector
function renderWorkspacesDropdown() {
  workspaceSelect.innerHTML = '';

  workspaces.forEach(ws => {
    const option = document.createElement('option');
    option.value = ws.id;
    option.textContent = ws.name;
    if (ws.id === activeWorkspaceId) {
      option.selected = true;
    }
    workspaceSelect.appendChild(option);
  });

  // Show delete button only if it's not the default workspace
  if (activeWorkspaceId === 'default') {
    btnDeleteWorkspace.style.display = 'none';
  } else {
    btnDeleteWorkspace.style.display = 'inline-flex';
  }
}

// Fetch all items and root folders for active workspace
let _realtimeSubscribedWorkspaceId = null;
let _realtimeRefreshTimer = null;
let _fetchInFlight = false;

async function fetchWorkspaceData(opts = {}) {
  const silent = !!opts.silent; // silent = realtime refresh: keep filters, don't resubscribe
  if (_fetchInFlight && silent) return; // drop overlapping realtime refreshes
  _fetchInFlight = true;
  try {
    // 1. Supabase Cloud Data & Realtime Sync
    if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
      const sbData = await window.SupabaseManager.fetchWorkspaceData(activeWorkspaceId);
      if (sbData) {
        dbData = {
          categories: sbData.categories || ['General'],
          items: sbData.items || []
        };
        workspaceFolders = sbData.folders || [];
        try {
          const lfRes = await fetch(`/api/workspaces/${activeWorkspaceId}/folders`);
          if (lfRes.ok) {
            const lfTree = await lfRes.json();
            const existingNames = new Set(workspaceFolders.map(f => f.path || f.name));
            (lfTree.folders || []).forEach(lf => {
              if (!existingNames.has(lf.path || lf.name)) {
                workspaceFolders.push(lf);
                existingNames.add(lf.path || lf.name);
              }
            });
            window.workspaceRootFiles = lfTree.files || [];
          }
        } catch (e) {
          /* ignore */
        }
        window.dbData = dbData;
        window.activeWorkspaceId = activeWorkspaceId;

        // Subscribe to real-time changes only once per workspace, debounced
        if (_realtimeSubscribedWorkspaceId !== activeWorkspaceId) {
          _realtimeSubscribedWorkspaceId = activeWorkspaceId;
          window.SupabaseManager.subscribeRealtime(activeWorkspaceId, () => {
            clearTimeout(_realtimeRefreshTimer);
            _realtimeRefreshTimer = setTimeout(() => fetchWorkspaceData({ silent: true }), 800);
          });
        }

        populateCategoriesDropdowns();
        if (!silent) resetFilters();
        updateUI();
        return;
      }
    }

    // 2. Local Fallback Data
    const [dataRes, foldersRes] = await Promise.all([
      fetch(`/api/workspaces/${activeWorkspaceId}/data`),
      fetch(`/api/workspaces/${activeWorkspaceId}/folders`).catch(() => null)
    ]);
    if (!dataRes.ok) throw new Error('Failed to fetch workspace items');

    dbData = await dataRes.json();
    window.dbData = dbData;
    window.activeWorkspaceId = activeWorkspaceId;

    if (foldersRes && foldersRes.ok) {
      const folderTree = await foldersRes.json();
      workspaceFolders = folderTree.folders || [];
      window.workspaceRootFiles = folderTree.files || []; // untracked files at the workspace root (used by Browse)
    } else {
      workspaceFolders = [];
      window.workspaceRootFiles = [];
    }

    populateCategoriesDropdowns();
    if (!silent) resetFilters();
    updateUI();
  } catch (error) {
    console.error(`Error loading data for workspace ${activeWorkspaceId}:`, error);
  } finally {
    _fetchInFlight = false;
  }
}

// Resets filters when switching workspaces
function resetFilters() {
  activeCategoryFilter = null;
  filterStatusBar.style.display = 'none';
  searchQuery = '';
  searchInput.value = '';

  // Reset type filter to all
  activeTypeFilter = 'all';
  [filterAll, filterLinks, filterFiles, filterNotes].forEach(el => el.classList.remove('active'));
  filterAll.classList.add('active');
}

// Set up UI component updates
function updateUI() {
  renderSidebarCategories();
  renderGridItems();
  updateStats();
  lucide.createIcons();
}

// Generate category options for form selects
function populateCategoriesDropdowns() {
  const dropdowns = document.querySelectorAll('.select-category');
  dropdowns.forEach(dropdown => {
    dropdown.innerHTML = '';
    dbData.categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      if (cat === 'General') option.selected = true;
      dropdown.appendChild(option);
    });
  });
}

// Render dynamic category list in Sidebar
function renderSidebarCategories() {
  categoriesList.innerHTML = '';

  dbData.categories.forEach(cat => {
    // Count items in this category
    const count = dbData.items.filter(item => item.category === cat).length;

    const li = document.createElement('li');
    if (activeCategoryFilter === cat) {
      li.className = 'active';
    }

    li.innerHTML = `
      <i data-lucide="folder"></i>
      <span>${escapeHTML(cat)}</span>
      <span class="badge">${count}</span>
    `;

    li.addEventListener('click', () => {
      selectCategoryFilter(cat);
    });

    categoriesList.appendChild(li);
  });
}

// Render workspace cards
function renderGridItems() {
  // Unified folders + files view for the default "All Items" scope; filtered views keep the original rendering
  if (window.Browse) {
    if (window.Browse.handles()) { window.Browse.render(); return; }
    window.Browse.hide();
  }
  itemsGrid.innerHTML = '';

  // Filter items
  let filteredItems = dbData.items;

  // Filter 1: Type
  if (activeTypeFilter !== 'all') {
    filteredItems = filteredItems.filter(item => item.type === activeTypeFilter);
  }

  // Filter 2: Category
  if (activeCategoryFilter) {
    filteredItems = filteredItems.filter(item => item.category === activeCategoryFilter);
  }

  // Filter 3: Search text
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredItems = filteredItems.filter(item => {
      const titleMatch = item.title && item.title.toLowerCase().includes(q);
      const descMatch = item.description && item.description.toLowerCase().includes(q);
      const categoryMatch = item.category && item.category.toLowerCase().includes(q);

      let typeSpecificMatch = false;
      if (item.type === 'link') {
        typeSpecificMatch = item.url && item.url.toLowerCase().includes(q);
      } else if (item.type === 'note') {
        typeSpecificMatch = item.content && item.content.toLowerCase().includes(q);
      } else if (item.type === 'file') {
        typeSpecificMatch = item.fileName && item.fileName.toLowerCase().includes(q);
      }

      return titleMatch || descMatch || categoryMatch || typeSpecificMatch;
    });
  }

  // Sort items: Newest first
  filteredItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Root folders in All Items (when not filtered by category)
  let filteredFolders = [];
  if (activeTypeFilter === 'all' && !activeCategoryFilter) {
    filteredFolders = workspaceFolders;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filteredFolders = filteredFolders.filter(f => f.name && f.name.toLowerCase().includes(q));
    }
  }

  // Toggle Empty State
  if (filteredItems.length === 0 && filteredFolders.length === 0) {
    itemsGrid.style.display = 'none';
    emptyState.style.display = 'flex';
  } else {
    itemsGrid.style.display = 'grid';
    emptyState.style.display = 'none';

    // Render Root Folder cards
    filteredFolders.forEach(folder => {
      const folderCard = createFolderCardElement(folder);
      itemsGrid.appendChild(folderCard);
    });

    // Render regular item cards
    filteredItems.forEach(item => {
      const card = createCardElement(item);
      itemsGrid.appendChild(card);
    });
  }
}

// Generate DOM element for a Root Folder (Small & Minimalist)
function createFolderCardElement(folder) {
  const el = document.createElement('div');
  el.className = 'mini-item mini-item-folder';
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');

  const filesCount = (folder.files || []).length;
  const subfoldersCount = (folder.folders || []).length;
  const totalItems = filesCount + subfoldersCount;
  const isEmpty = totalItems === 0;

  el.innerHTML = `
    <div class="mini-item-left">
      <i data-lucide="folder" class="mini-icon mini-icon-folder"></i>
      <span class="mini-title" title="${escapeHTML(folder.name)}">${escapeHTML(folder.name)}</span>
    </div>
    <div class="mini-item-right">
      <span class="mini-status ${isEmpty ? 'is-empty' : 'is-populated'}" title="${isEmpty ? 'Empty folder' : `${totalItems} item${totalItems !== 1 ? 's' : ''} (${filesCount} file${filesCount !== 1 ? 's' : ''})`}">
        <span class="status-dot"></span>
        ${!isEmpty ? `<span class="status-count">${totalItems}</span>` : ''}
      </span>
    </div>
  `;

  // Direct click -> open folder in explorer
  el.addEventListener('click', () => {
    if (window.Browse) { window.Browse.navigate(folder.path); return; }
    const filterFolders = document.getElementById('filter-folders');
    if (filterFolders) filterFolders.click();
    setTimeout(() => {
      FolderExplorer.navigateTo(folder.path);
    }, 50);
  });

  // Right-click on item / icon -> show context menu / info / history
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e, folder, 'folder');
  });

  return el;
}

// Generate DOM element for an item (Small & Minimalist)
function createCardElement(item) {
  const el = document.createElement('div');
  el.className = `mini-item mini-item-${item.type}`;
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');

  let iconHTML = '';
  let metaHTML = '';
  let titleText = item.title || '';

  if (item.type === 'link') {
    iconHTML = `<i data-lucide="link-2" class="mini-icon mini-icon-link"></i>`;
    metaHTML = `<i data-lucide="arrow-up-right" class="mini-subtle-arrow"></i>`;
  } else if (item.type === 'file') {
    titleText = item.title || item.fileName || 'Untitled File';
    const ext = (item.fileName || '').split('.').pop().toLowerCase();
    const isPdf = ext === 'pdf';
    const isPpt = ['ppt', 'pptx', 'pps', 'ppsx', 'potx', 'odp'].includes(ext);
    const isSheet = ['xls', 'xlsx', 'csv'].includes(ext);
    const isDoc = ['doc', 'docx', 'txt', 'md'].includes(ext);
    const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
    const isCode = ['js', 'ts', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp'].includes(ext);
    const iconName = isPdf ? 'file-text' : isPpt ? 'presentation' : isSheet ? 'table' : isDoc ? 'file-text' : isImg ? 'image' : isCode ? 'file-code' : 'file';
    const typeColorClass = isPdf ? 'pdf' : isPpt ? 'ppt' : isSheet ? 'sheet' : isDoc ? 'doc' : isImg ? 'img' : isCode ? 'code' : 'generic';

    // Reading progress badge
    let readBadgeHTML = '';
    if (window.ReadingProgressManager) {
      const prog = window.ReadingProgressManager.getProgress(item);
      if (prog && (prog.page > 1 || prog.percentage > 0)) {
        readBadgeHTML = `<span class="mini-read-badge" title="Reading Progress: Page ${prog.page} of ${prog.totalPages} (${prog.percentage}%)">📖 ${prog.percentage}% (Pg ${prog.page})</span>`;
      }
    }

    iconHTML = `<i data-lucide="${iconName}" class="mini-icon mini-icon-file file-${typeColorClass}"></i>`;
    metaHTML = `${readBadgeHTML}<span class="mini-meta-badge">${ext ? ext.toUpperCase() : 'FILE'}</span>`;
  } else if (item.type === 'note') {
    iconHTML = `<i data-lucide="sticky-note" class="mini-icon mini-icon-note"></i>`;
    metaHTML = `<span class="mini-meta-badge">NOTE</span>`;
  }

  el.innerHTML = `
    <div class="mini-item-left">
      ${iconHTML}
      <span class="mini-title" title="${escapeHTML(titleText)}">${escapeHTML(titleText)}</span>
    </div>
    <div class="mini-item-right">
      ${metaHTML}
    </div>
  `;

  // Direct touch/click:
  el.addEventListener('click', () => {
    if (item.type === 'link') {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    } else if (item.type === 'file') {
      if (window.WorkspaceViewer) {
        window.WorkspaceViewer.open(item);
      } else {
        window.open(item.filePath, '_blank');
      }
    } else if (item.type === 'note') {
      openNotePreview(item);
    }
  });

  // Right-click on item / icon -> show context menu / info / history
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e, item, item.type);
  });

  return el;
}

// Delete item helper
async function deleteItem(itemId) {
  if (!confirm('Are you sure you want to delete this resource? This action cannot be undone.')) {
    return;
  }

  try {
    if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
      await window.SupabaseManager.deleteItem(activeWorkspaceId, itemId);
    } else {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/items/${itemId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
    }

    // Update local copy and render
    dbData.items = dbData.items.filter(item => item.id !== itemId);
    updateUI();
  } catch (error) {
    console.error('Error deleting item:', error);
    alert('Failed to delete item: ' + error.message);
  }
}

// ================================================================
// CONTEXT MENU & DETAILS MODAL LOGIC
// ================================================================
let activeContextTarget = null;
let activeContextType = null;

const contextMenu = document.getElementById('custom-context-menu');
const ctxHeader = document.getElementById('ctx-header');
const ctxIcon = document.getElementById('ctx-icon');
const ctxTitle = document.getElementById('ctx-title');
const ctxOptDetails = document.getElementById('ctx-opt-details');
const ctxOptOpen = document.getElementById('ctx-opt-open');
const ctxOptViewer = document.getElementById('ctx-opt-viewer');
const ctxOptStartOver = document.getElementById('ctx-opt-startover');
const ctxOptDownload = document.getElementById('ctx-opt-download');
const ctxOptCopy = document.getElementById('ctx-opt-copy');
const ctxOptMove = document.getElementById('ctx-opt-move');
const ctxOptRename = document.getElementById('ctx-opt-rename');
const ctxOptDelete = document.getElementById('ctx-opt-delete');

// Details Modal
const modalItemDetails = document.getElementById('modal-item-details');
const btnCloseDetailsModal = document.getElementById('btn-close-details-modal');
const btnDetailsClose = document.getElementById('btn-details-close');
const btnDetailsOpen = document.getElementById('btn-details-open');
const detailsContent = document.getElementById('details-content');
const detailModalTitle = document.getElementById('detail-modal-title');
const detailHeaderIcon = document.getElementById('detail-header-icon');

// Note Preview Modal
const modalNotePreview = document.getElementById('modal-note-preview');
const btnCloseNotePreview = document.getElementById('btn-close-note-preview');
const btnNotePreviewClose = document.getElementById('btn-note-preview-close');
const btnNoteCopy = document.getElementById('btn-note-copy');
const notePreviewTitle = document.getElementById('note-preview-title');
const notePreviewMeta = document.getElementById('note-preview-meta');
const notePreviewBody = document.getElementById('note-preview-body');
let activePreviewNote = null;

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
}

function openContextMenu(e, target, type) {
  activeContextTarget = target;
  activeContextType = type;

  const targetTitle = type === 'folder'
    ? target.name
    : (target.title || target.fileName || 'Item');

  ctxTitle.textContent = targetTitle;

  if (type === 'folder') {
    ctxIcon.setAttribute('data-lucide', 'folder');
    ctxOptDownload.style.display = 'none';
    ctxOptMove.style.display = 'none';
    ctxOptRename.style.display = 'flex';
    ctxOptCopy.style.display = 'flex';
    ctxOptCopy.querySelector('span').textContent = 'Copy Folder Path';
    if (ctxOptViewer) ctxOptViewer.style.display = 'none';
    if (ctxOptStartOver) ctxOptStartOver.style.display = 'none';
  } else if (type === 'file') {
    ctxIcon.setAttribute('data-lucide', 'file-text');
    ctxOptDownload.style.display = 'flex';
    ctxOptMove.style.display = 'none';
    ctxOptRename.style.display = 'none';
    ctxOptCopy.style.display = 'flex';
    ctxOptCopy.querySelector('span').textContent = 'Copy File Link';
    if (ctxOptViewer) ctxOptViewer.style.display = 'flex';
    if (ctxOptStartOver) {
      const prog = window.ReadingProgressManager ? window.ReadingProgressManager.getProgress(target) : null;
      ctxOptStartOver.style.display = (prog && (prog.page > 1 || prog.percentage > 0)) ? 'flex' : 'none';
    }
  } else if (type === 'link') {
    ctxIcon.setAttribute('data-lucide', 'link-2');
    ctxOptDownload.style.display = 'none';
    ctxOptMove.style.display = 'none';
    ctxOptRename.style.display = 'none';
    ctxOptCopy.style.display = 'flex';
    ctxOptCopy.querySelector('span').textContent = 'Copy Web URL';
    if (ctxOptViewer) ctxOptViewer.style.display = 'none';
    if (ctxOptStartOver) ctxOptStartOver.style.display = 'none';
  } else if (type === 'note') {
    ctxIcon.setAttribute('data-lucide', 'sticky-note');
    ctxOptDownload.style.display = 'none';
    ctxOptMove.style.display = 'none';
    ctxOptRename.style.display = 'none';
    ctxOptCopy.style.display = 'flex';
    ctxOptCopy.querySelector('span').textContent = 'Copy Note Content';
    if (ctxOptViewer) ctxOptViewer.style.display = 'none';
    if (ctxOptStartOver) ctxOptStartOver.style.display = 'none';
  }

  // Calculate position with viewport boundary checking
  contextMenu.style.display = 'block';
  contextMenu.style.visibility = 'hidden';
  safeCreateIcons();

  const menuWidth = contextMenu.offsetWidth || 210;
  const menuHeight = contextMenu.offsetHeight || 220;
  let posX = e.clientX;
  let posY = e.clientY;

  if (posX + menuWidth > window.innerWidth) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (posY + menuHeight > window.innerHeight) {
    posY = window.innerHeight - menuHeight - 10;
  }
  if (posX < 10) posX = 10;
  if (posY < 10) posY = 10;

  contextMenu.style.left = posX + 'px';
  contextMenu.style.top = posY + 'px';
  contextMenu.style.visibility = 'visible';
}

// Toast Notification Helper
function showToast(message, iconName = 'check') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <i data-lucide="${iconName}"></i>
    <span>${escapeHTML(message)}</span>
  `;
  container.appendChild(toast);
  safeCreateIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px) scale(0.95)';
    setTimeout(() => toast.remove(), 260);
  }, 2200);
}

// Wire context menu options & details modal events
function setupContextMenuEvents() {
  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  window.addEventListener('scroll', hideContextMenu, true);
  window.addEventListener('resize', hideContextMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
      if (modalItemDetails) modalItemDetails.classList.remove('active');
      if (modalNotePreview) modalNotePreview.classList.remove('active');
    }
  });

  // Details option
  ctxOptDetails.addEventListener('click', () => {
    hideContextMenu();
    if (activeContextTarget) {
      openDetailsModal(activeContextTarget, activeContextType);
    }
  });

  // Open option
  ctxOptOpen.addEventListener('click', () => {
    hideContextMenu();
    if (!activeContextTarget) return;
    if (activeContextType === 'folder') {
      if (window.Browse) { window.Browse.navigate(activeContextTarget.path); return; }
      const filterFolders = document.getElementById('filter-folders');
      if (filterFolders) filterFolders.click();
      setTimeout(() => FolderExplorer.navigateTo(activeContextTarget.path), 50);
    } else if (activeContextType === 'link') {
      window.open(activeContextTarget.url, '_blank', 'noopener,noreferrer');
    } else if (activeContextType === 'file') {
      if (window.WorkspaceViewer) {
        window.WorkspaceViewer.open(activeContextTarget);
      } else {
        const fileUrl = activeContextTarget.filePath || `/uploads/${activeWorkspaceId}/${activeContextTarget.path}`;
        window.open(fileUrl, '_blank');
      }
    } else if (activeContextType === 'note') {
      openNotePreview(activeContextTarget);
    }
  });

  // Dedicated Open in PDF Viewer option
  if (ctxOptViewer) {
    ctxOptViewer.addEventListener('click', () => {
      hideContextMenu();
      if (activeContextTarget && window.WorkspaceViewer) {
        window.WorkspaceViewer.open(activeContextTarget);
      }
    });
  }

  // Start Over (Reset Progress) option
  if (ctxOptStartOver) {
    ctxOptStartOver.addEventListener('click', () => {
      hideContextMenu();
      if (activeContextTarget && window.WorkspaceViewer) {
        window.WorkspaceViewer.open(activeContextTarget, { forceStartOver: true });
      }
    });
  }

  // Download option
  ctxOptDownload.addEventListener('click', () => {
    hideContextMenu();
    if (activeContextTarget && activeContextType === 'file') {
      const a = document.createElement('a');
      const fileUrl = activeContextTarget.filePath || `/uploads/${activeWorkspaceId}/${activeContextTarget.path}`;
      const fileName = activeContextTarget.fileName || activeContextTarget.name || 'download';
      a.href = fileUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(`Downloading ${fileName}...`, 'download');
    }
  });

  // Copy option
  ctxOptCopy.addEventListener('click', async () => {
    hideContextMenu();
    if (!activeContextTarget) return;
    let textToCopy = '';
    let toastLabel = 'Copied to clipboard!';
    if (activeContextType === 'folder') {
      textToCopy = activeContextTarget.path || activeContextTarget.name;
      toastLabel = 'Folder path copied!';
    } else if (activeContextType === 'link') {
      textToCopy = activeContextTarget.url;
      toastLabel = 'URL copied to clipboard!';
    } else if (activeContextType === 'file') {
      const fileUrl = activeContextTarget.filePath || `/uploads/${activeWorkspaceId}/${activeContextTarget.path}`;
      textToCopy = window.location.origin + fileUrl;
      toastLabel = 'File link copied!';
    } else if (activeContextType === 'note') {
      textToCopy = activeContextTarget.content;
      toastLabel = 'Note text copied!';
    }
    if (textToCopy) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        showToast(toastLabel);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast(toastLabel);
      }
    }
  });

  // Move option
  ctxOptMove.addEventListener('click', () => {
    hideContextMenu();
    if (activeContextTarget && activeContextType === 'file' && activeContextTarget.path) {
      FolderExplorer.openMoveFileModal(activeContextTarget);
    }
  });

  // Delete option
  ctxOptDelete.addEventListener('click', async () => {
    hideContextMenu();
    if (!activeContextTarget) return;
    if (activeContextType === 'folder') {
      await FolderExplorer.deleteFolder(activeContextTarget);
    } else if (activeContextTarget.id) {
      await deleteItem(activeContextTarget.id);
    } else if (activeContextTarget.path) {
      await FolderExplorer.deleteFile(activeContextTarget);
    }
  });

  // Rename option
  ctxOptRename.addEventListener('click', () => {
    hideContextMenu();
    if (activeContextTarget) {
      if (activeContextType === 'folder') {
        FolderExplorer.openRenameFolder(activeContextTarget);
      } else if (activeContextType === 'file' && activeContextTarget.path) {
        FolderExplorer.openRenameFile(activeContextTarget);
      }
    }
  });

  // Modal close wiring
  if (btnCloseDetailsModal) {
    btnCloseDetailsModal.addEventListener('click', () => modalItemDetails.classList.remove('active'));
  }
  if (btnDetailsClose) {
    btnDetailsClose.addEventListener('click', () => modalItemDetails.classList.remove('active'));
  }
  if (modalItemDetails) {
    modalItemDetails.addEventListener('click', (e) => {
      if (e.target === modalItemDetails) modalItemDetails.classList.remove('active');
    });
  }

  // Note preview close wiring
  if (btnCloseNotePreview) {
    btnCloseNotePreview.addEventListener('click', () => modalNotePreview.classList.remove('active'));
  }
  if (btnNotePreviewClose) {
    btnNotePreviewClose.addEventListener('click', () => modalNotePreview.classList.remove('active'));
  }
  if (modalNotePreview) {
    modalNotePreview.addEventListener('click', (e) => {
      if (e.target === modalNotePreview) modalNotePreview.classList.remove('active');
    });
  }
  if (btnNoteCopy) {
    btnNoteCopy.addEventListener('click', async () => {
      if (activePreviewNote && activePreviewNote.content) {
        try {
          await navigator.clipboard.writeText(activePreviewNote.content);
          btnNoteCopy.innerHTML = `<i data-lucide="check"></i> Copied!`;
          safeCreateIcons();
          setTimeout(() => {
            btnNoteCopy.innerHTML = `<i data-lucide="copy"></i> Copy Content`;
            safeCreateIcons();
          }, 1500);
        } catch {
          alert('Copied to clipboard');
        }
      }
    });
  }
}

// Open Details & History Modal
function openDetailsModal(target, type) {
  if (!target) return;
  activeContextTarget = target;
  activeContextType = type;

  let html = '';
  if (type === 'folder') {
    detailModalTitle.textContent = 'Folder Details & History';
    detailHeaderIcon.setAttribute('data-lucide', 'folder');
    detailHeaderIcon.style.color = '#f59e0b';

    const filesCount = (target.files || []).length;
    const subfoldersCount = (target.folders || []).length;
    const totalCount = filesCount + subfoldersCount;

    html = `
      <div class="detail-row">
        <span class="detail-label">Name</span>
        <div class="detail-value" style="font-weight:600;">${escapeHTML(target.name)}</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Type</span>
        <div class="detail-value">Directory Folder</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <div class="detail-value">${totalCount === 0 ? 'Empty (0 items)' : `${totalCount} item(s) — ${filesCount} file(s), ${subfoldersCount} subfolder(s)`}</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Location Path</span>
        <div class="detail-value">Root / ${escapeHTML(target.path || target.name)}</div>
      </div>
    `;
  } else {
    detailModalTitle.textContent = `${capitalize(type)} Details & History`;
    const iconName = type === 'link' ? 'link-2' : type === 'file' ? 'file-text' : 'sticky-note';
    const iconColor = type === 'link' ? '#38bdf8' : type === 'file' ? '#f87171' : '#34d399';
    detailHeaderIcon.setAttribute('data-lucide', iconName);
    detailHeaderIcon.style.color = iconColor;

    const dateFormatted = formatDateFull(target.createdAt);

    html = `
      <div class="detail-row">
        <span class="detail-label">Title</span>
        <div class="detail-value" style="font-weight:600;">${escapeHTML(target.title || target.fileName || 'Untitled')}</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Type & Category</span>
        <div class="detail-value" style="display:flex; gap:8px; align-items:center;">
          <span class="mini-meta-badge" style="text-transform:uppercase;">${type}</span>
          <span style="color:var(--text-muted); font-size:0.85rem;">Category:</span>
          <strong>${escapeHTML(target.category || 'General')}</strong>
        </div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Created At (History)</span>
        <div class="detail-value">${dateFormatted}</div>
      </div>
    `;

    if (target.description) {
      html += `
        <div class="detail-row">
          <span class="detail-label">Description</span>
          <div class="detail-value">${escapeHTML(target.description)}</div>
        </div>
      `;
    }

    if (type === 'link') {
      html += `
        <div class="detail-row">
          <span class="detail-label">Destination URL</span>
          <div class="detail-value">
            <a href="${target.url}" target="_blank" rel="noopener noreferrer" style="color:#818cf8; word-break:break-all;">${escapeHTML(target.url)}</a>
          </div>
        </div>
      `;
    } else if (type === 'file') {
      html += `
        <div class="detail-row">
          <span class="detail-label">File Name & Size</span>
          <div class="detail-value">${escapeHTML(target.fileName)} (${formatBytes(target.fileSize)})</div>
        </div>
      `;
    } else if (type === 'note') {
      html += `
        <div class="detail-row">
          <span class="detail-label">Note Preview</span>
          <div class="detail-value" style="white-space:pre-wrap; max-height:150px; overflow-y:auto;">${escapeHTML(target.content)}</div>
        </div>
      `;
    }
  }

  detailsContent.innerHTML = html;
  btnDetailsOpen.onclick = () => {
    modalItemDetails.classList.remove('active');
    ctxOptOpen.click();
  };

  modalItemDetails.classList.add('active');
  safeCreateIcons();
}

function openNotePreview(noteItem) {
  activePreviewNote = noteItem;
  notePreviewTitle.textContent = noteItem.title || 'Note Preview';
  notePreviewMeta.innerHTML = `
    <span class="mini-meta-badge">Note</span>
    <span>Category: <strong>${escapeHTML(noteItem.category || 'General')}</strong></span>
    <span>•</span>
    <span>${formatDateFull(noteItem.createdAt)}</span>
  `;
  notePreviewBody.textContent = noteItem.content || '';
  modalNotePreview.classList.add('active');
  safeCreateIcons();
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDateFull(isoString) {
  if (!isoString) return 'Unknown';
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Calculate counts & size stats
function updateStats() {
  const items = dbData.items;
  const foldersCount = workspaceFolders ? workspaceFolders.length : 0;

  const totalCount = items.length + foldersCount;
  const linkCount = items.filter(item => item.type === 'link').length;
  const fileCount = items.filter(item => item.type === 'file').length;
  const noteCount = items.filter(item => item.type === 'note').length;

  countAll.textContent = totalCount;
  countLinks.textContent = linkCount;
  countFiles.textContent = fileCount;
  countNotes.textContent = noteCount;

  const countFolders = document.getElementById('count-folders');
  if (countFolders) {
    countFolders.textContent = foldersCount;
  }

  // File specific stats
  const uploadedFiles = items.filter(item => item.type === 'file');
  const totalSize = uploadedFiles.reduce((acc, curr) => acc + (curr.fileSize || 0), 0);

  statFilesCount.textContent = uploadedFiles.length;
  statFilesSize.textContent = formatBytes(totalSize);
}

// Category filter trigger
function selectCategoryFilter(catName) {
  activeCategoryFilter = catName;
  if (catName === null) {
    filterStatusBar.style.display = 'none';
  } else {
    activeCategoryLabel.textContent = catName;
    filterStatusBar.style.display = 'flex';
  }
  updateUI();
}

// Type filter trigger
function selectTypeFilter(element, typeName) {
  // Reset active classes
  [filterAll, filterLinks, filterFiles, filterNotes].forEach(el => el.classList.remove('active'));
  element.classList.add('active');

  activeTypeFilter = typeName;
  renderGridItems();
  lucide.createIcons();
}

// Reset dropzone files
function resetFileDropzone() {
  fileInput.value = '';
  selectedFileInfo.style.display = 'none';
  fileDropzone.style.display = 'flex';
  uploadProgressContainer.style.display = 'none';
  uploadProgressFill.style.width = '0%';
  btnSubmitUpload.disabled = false;
}

// Setup Event Listeners
function setupEventListeners() {
  setupContextMenuEvents();

  // WORKSPACE EVENT LISTENERS

  // Workspace select switch
  workspaceSelect.addEventListener('change', async (e) => {
    const wsId = e.target.value;
    try {
      activeWorkspaceId = wsId;
      window.activeWorkspaceId = activeWorkspaceId;
      localStorage.setItem('activeWorkspaceId', wsId);

      if (activeWorkspaceId === 'default') {
        btnDeleteWorkspace.style.display = 'none';
      } else {
        btnDeleteWorkspace.style.display = 'inline-flex';
      }

      // Immediately clear current items and folders before fetching the new workspace
      dbData = { categories: ['General', 'Work', 'Personal', 'Study', 'Finance'], items: [] };
      workspaceFolders = [];
      updateUI();

      // Notify backend if not in pure Supabase mode (non-blocking)
      if (!window.SupabaseManager || !window.SupabaseManager.isConfigured()) {
        fetch('/api/workspaces/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: wsId })
        }).catch(() => {});
      }

      await fetchWorkspaceData();
    } catch (err) {
      console.error('Error switching workspace:', err);
      showToast('Error loading workspace data', 'alert-triangle');
    }
  });

  // Open Workspace Modal
  btnAddWorkspace.addEventListener('click', () => {
    modalAddWorkspace.classList.add('active');
    document.getElementById('workspace-name').value = '';
  });

  // Close Workspace Modal
  btnCloseWsModal.addEventListener('click', () => {
    modalAddWorkspace.classList.remove('active');
  });

  modalAddWorkspace.addEventListener('click', (e) => {
    if (e.target === modalAddWorkspace) modalAddWorkspace.classList.remove('active');
  });

  // Create Workspace Form Submit
  formAddWorkspace.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('workspace-name').value;
    if (!name || !name.trim()) return;

    try {
      let createdWs = null;
      if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        try {
          createdWs = await window.SupabaseManager.createWorkspace(name.trim());
        } catch (sbErr) {
          console.warn('Supabase createWorkspace failed, falling back to local backend:', sbErr);
          const response = await fetch('/api/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
          });
          if (response.ok) {
            const resData = await response.json();
            createdWs = resData.newWorkspace;
          } else {
            throw sbErr;
          }
        }
      } else {
        const response = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create workspace');
        }
        const resData = await response.json();
        createdWs = resData.newWorkspace;
      }

      modalAddWorkspace.classList.remove('active');
      formAddWorkspace.reset();

      // Explicitly switch active workspace to the newly created workspace
      if (createdWs && createdWs.id) {
        activeWorkspaceId = createdWs.id;
        window.activeWorkspaceId = activeWorkspaceId;
        localStorage.setItem('activeWorkspaceId', activeWorkspaceId);
      }

      // Immediately clear previous workspace items from UI
      dbData = { categories: ['General', 'Work', 'Personal', 'Study', 'Finance'], items: [] };
      workspaceFolders = [];
      updateUI();

      // Update state and load newly created workspace
      await fetchWorkspaces(activeWorkspaceId);
      await fetchWorkspaceData();
      showToast(`Created workspace "${name}"`, 'check');
    } catch (error) {
      console.error('Error creating workspace:', error);
      if (error.message && error.message.includes('not logged in')) {
        alert('Please sign in or use Demo mode to create workspaces.');
        openAuthModal('login', { allowClose: true });
      } else {
        alert(error.message || 'Error creating workspace');
      }
    }
  });

  // Delete Active Workspace
  btnDeleteWorkspace.addEventListener('click', async () => {
    if (activeWorkspaceId === 'default') {
      return alert('Cannot delete the default workspace');
    }

    const wsName = workspaceSelect.options[workspaceSelect.selectedIndex] ? workspaceSelect.options[workspaceSelect.selectedIndex].text : 'Active Workspace';
    if (!confirm(`CAUTION: Are you sure you want to delete the workspace "${wsName}"?\n\nThis will permanently delete ALL links, notes, and uploaded PDF files inside it. This cannot be undone.`)) {
      return;
    }

    try {
      if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        await window.SupabaseManager.deleteWorkspace(activeWorkspaceId);
      } else {
        const response = await fetch(`/api/workspaces/${activeWorkspaceId}`, {
          method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete workspace');
      }

      // Reset activeWorkspaceId so it switches back to default
      activeWorkspaceId = 'default';
      window.activeWorkspaceId = 'default';
      localStorage.removeItem('activeWorkspaceId');

      dbData = { categories: ['General', 'Work', 'Personal', 'Study', 'Finance'], items: [] };
      workspaceFolders = [];
      updateUI();

      await fetchWorkspaces();
      await fetchWorkspaceData();
    } catch (error) {
      console.error(error);
      alert('Error deleting workspace: ' + error.message);
    }
  });

  // --- GENERAL ITEM EVENT LISTENERS ---

  // Search input change
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderGridItems();
    lucide.createIcons();
  });

  // Type filters in sidebar
  filterAll.addEventListener('click', () => selectTypeFilter(filterAll, 'all'));
  filterLinks.addEventListener('click', () => selectTypeFilter(filterLinks, 'link'));
  filterFiles.addEventListener('click', () => selectTypeFilter(filterFiles, 'file'));
  filterNotes.addEventListener('click', () => selectTypeFilter(filterNotes, 'note'));

  // Clear category filter bar button
  btnClearCategoryFilter.addEventListener('click', () => {
    selectCategoryFilter(null);
  });

  // Modal display toggles
  btnNewItem.addEventListener('click', () => {
    modalAddItem.classList.add('active');
    resetFileDropzone();
  });

  btnEmptyAdd.addEventListener('click', () => {
    modalAddItem.classList.add('active');
    resetFileDropzone();
  });

  btnCloseModal.addEventListener('click', () => {
    modalAddItem.classList.remove('active');
  });

  // Close modals on clicking backdrop
  modalAddItem.addEventListener('click', (e) => {
    if (e.target === modalAddItem) modalAddItem.classList.remove('active');
  });

  modalAddCategory.addEventListener('click', (e) => {
    if (e.target === modalAddCategory) modalAddCategory.classList.remove('active');
  });

  // Category addition dialog triggers
  btnAddCategory.addEventListener('click', () => {
    modalAddCategory.classList.add('active');
    document.getElementById('category-name').value = '';
  });

  btnCloseCatModal.addEventListener('click', () => {
    modalAddCategory.classList.remove('active');
  });

  // Modal Tab switching
  modalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      modalTabs.forEach(t => t.classList.remove('active'));
      modalForms.forEach(form => form.classList.remove('active'));

      tab.classList.add('active');
      const targetTabId = tab.dataset.tab;
      document.getElementById(targetTabId).classList.add('active');
    });
  });

  // File selection triggers
  fileDropzone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
      handleFilesSelected(fileInput.files);
    }
  });

  // Drag and Drop files
  ['dragenter', 'dragover'].forEach(eventName => {
    fileDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    fileDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropzone.classList.remove('dragover');
    }, false);
  });

  fileDropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleFilesSelected(files);
    }
  });

  btnRemoveFile.addEventListener('click', () => {
    resetFileDropzone();
  });

  // SUBMIT FORM: Add Link
  formAddLink.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('link-title').value;
    const url = document.getElementById('link-url').value;
    const description = document.getElementById('link-desc').value;
    const category = document.getElementById('link-category').value;

    try {
      if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        const newItem = await window.SupabaseManager.addItem(activeWorkspaceId, {
          type: 'link',
          title,
          url,
          description,
          category
        });
        dbData.items.unshift(newItem);
      } else {
        const response = await fetch(`/api/workspaces/${activeWorkspaceId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'link', title, url, description, category })
        });

        if (!response.ok) throw new Error('Failed to save link');
        const newItem = await response.json();
        dbData.items.push(newItem);
      }

      modalAddItem.classList.remove('active');
      formAddLink.reset();
      updateUI();
      if (typeof showToast === 'function') showToast('Bookmark saved successfully!');
    } catch (error) {
      console.error(error);
      alert('Error saving bookmark link: ' + error.message);
    }
  });

  // SUBMIT FORM: Add Note
  formAddNote.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('note-title').value;
    const content = document.getElementById('note-content').value;
    const category = document.getElementById('note-category').value;

    try {
      if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        const newItem = await window.SupabaseManager.addItem(activeWorkspaceId, {
          type: 'note',
          title,
          content,
          category
        });
        dbData.items.unshift(newItem);
      } else {
        const response = await fetch(`/api/workspaces/${activeWorkspaceId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'note', title, content, category })
        });

        if (!response.ok) throw new Error('Failed to save note');
        const newItem = await response.json();
        dbData.items.push(newItem);
      }

      modalAddItem.classList.remove('active');
      formAddNote.reset();
      updateUI();
      if (typeof showToast === 'function') showToast('Note saved successfully!');
    } catch (error) {
      console.error(error);
      alert('Error saving note: ' + error.message);
    }
  });

  // SUBMIT FORM: Create Category
  formAddCategory.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('category-name').value;

    try {
      if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        await window.SupabaseManager.addCategory(activeWorkspaceId, name);
        if (!dbData.categories.includes(name)) {
          dbData.categories.push(name);
        }
      } else {
        const response = await fetch(`/api/workspaces/${activeWorkspaceId}/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create category');
        }

        const data = await response.json();
        dbData.categories = data.categories;
      }

      modalAddCategory.classList.remove('active');
      populateCategoriesDropdowns();
      updateUI();
      if (typeof showToast === 'function') showToast(`Category "${name}" created!`);
    } catch (error) {
      console.error(error);
      alert(error.message || 'Error creating category');
    }
  });

  // SUBMIT FORM: Upload PDF/File(s) with Progress
  formUploadFile.addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = fileInput.files;
    if (!files || files.length === 0) return alert('Please select a file to upload');

    const title = document.getElementById('file-title').value;
    const description = document.getElementById('file-desc').value;
    const category = document.getElementById('file-category').value;

    uploadProgressContainer.style.display = 'block';
    btnSubmitUpload.disabled = true;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      uploadProgressText.textContent = `Uploading ${i + 1} of ${files.length}: ${file.name}…`;
      uploadProgressFill.style.width = '20%';

      try {
        if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
          uploadProgressFill.style.width = '60%';
          const { item } = await window.SupabaseManager.uploadFile(activeWorkspaceId, file);
          dbData.items.unshift(item);
          uploadProgressFill.style.width = '100%';
        } else {
          await new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('title', files.length === 1 ? title : '');
            formData.append('description', files.length === 1 ? description : '');
            formData.append('category', category);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/workspaces/${activeWorkspaceId}/upload`, true);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const pct = Math.round((event.loaded / event.total) * 100);
                uploadProgressFill.style.width = pct + '%';
                uploadProgressText.textContent = `Uploading ${i + 1} of ${files.length}: ${file.name} — ${pct}%`;
              }
            };

            xhr.onload = () => {
              if (xhr.status === 201) {
                const newItem = JSON.parse(xhr.responseText);
                dbData.items.push(newItem);
                resolve();
              } else {
                alert(`Failed to upload "${file.name}". Error: ` + xhr.responseText);
                reject(new Error(xhr.responseText));
              }
            };

            xhr.onerror = () => {
              alert(`Upload of "${file.name}" failed due to a network error.`);
              reject(new Error('Network error'));
            };

            xhr.send(formData);
          });
        }
      } catch (uploadError) {
        console.warn('File upload warning:', uploadError);
      }
    }

    uploadProgressText.textContent = `Done! ${files.length} file(s) uploaded.`;
    uploadProgressFill.style.width = '100%';

    setTimeout(() => {
      modalAddItem.classList.remove('active');
      formUploadFile.reset();
      resetFileDropzone();
      updateUI();
    }, 600);
  });
}

// Handle file selection from browse or drop
function handleFilesSelected(files) {
  if (files.length === 1) {
    fileNameLabel.textContent = `${files[0].name} (${formatBytes(files[0].size)})`;
  } else {
    const totalSize = Array.from(files).reduce((acc, f) => acc + f.size, 0);
    fileNameLabel.textContent = `${files.length} files selected (${formatBytes(totalSize)} total)`;
  }
  fileDropzone.style.display = 'none';
  selectedFileInfo.style.display = 'flex';
}

// Helpers
function formatDate(isoString) {
  if (!isoString) return 'Unknown';
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ================================================================
// FOLDER EXPLORER MODULE
// ================================================================

const FolderExplorer = (() => {
  // State
  let folderTree = null;         // full tree from server
  let currentFolderPath = '';    // '' = root
  let activeFolderNode = null;   // currently selected node in full tree
  let renameTarget = null;       // { type:'folder'|'file', path, name }
  let moveTarget = null;         // { path, name }

  // DOM refs (resolved lazily after DOM ready)
  const dom = () => ({
    explorer: document.getElementById('folder-explorer'),
    folderTree: document.getElementById('folder-tree'),
    breadcrumb: document.getElementById('folder-breadcrumb'),
    btnRoot: document.getElementById('btn-breadcrumb-root'),
    btnNewFolder: document.getElementById('btn-fe-new-folder'),
    btnUpload: document.getElementById('btn-fe-upload'),
    btnUploadFolder: document.getElementById('btn-fe-upload-folder'),
    btnUploadFolderEmpty: document.getElementById('btn-fe-upload-folder-empty'),
    feFolderInput: document.getElementById('fe-folder-input'),

    // Contents
    fileList: document.getElementById('folder-file-list'),
    subfolderGrid: document.getElementById('folder-subfolder-grid'),
    contentsEmpty: document.getElementById('folder-contents-empty'),
    btnUploadEmpty: document.getElementById('btn-fe-upload-empty'),

    // Create Folder modal
    modalCreateFolder: document.getElementById('modal-create-folder'),
    btnCloseFolderModal: document.getElementById('btn-close-folder-modal'),
    formCreateFolder: document.getElementById('form-create-folder'),
    folderNameInput: document.getElementById('folder-name-input'),

    // Upload modal
    modalFolderUpload: document.getElementById('modal-folder-upload'),
    btnCloseFolderUploadModal: document.getElementById('btn-close-folder-upload-modal'),
    formFolderUpload: document.getElementById('form-folder-upload'),
    feFileDropzone: document.getElementById('fe-file-dropzone'),
    feFileInput: document.getElementById('fe-file-input'),
    feSelectedInfo: document.getElementById('fe-selected-info'),
    feFileNameLabel: document.getElementById('fe-file-name-label'),
    btnFeRemoveFile: document.getElementById('btn-fe-remove-file'),
    feUploadProgress: document.getElementById('fe-upload-progress'),
    feProgressFill: document.getElementById('fe-progress-fill'),
    feProgressText: document.getElementById('fe-progress-text'),
    btnFeSubmitUpload: document.getElementById('btn-fe-submit-upload'),
    feTargetLabel: document.getElementById('fe-target-folder-label'),

    // Rename modal
    modalRename: document.getElementById('modal-fe-rename'),
    btnCloseRename: document.getElementById('btn-close-rename-modal'),
    formRename: document.getElementById('form-fe-rename'),
    renameInput: document.getElementById('fe-rename-input'),
    renameModalTitle: document.getElementById('fe-rename-modal-title'),

    // Move modal
    modalMove: document.getElementById('modal-fe-move'),
    btnCloseMove: document.getElementById('btn-close-move-modal'),
    btnCancelMove: document.getElementById('btn-cancel-move'),
    formMove: document.getElementById('form-fe-move'),
    moveFileName: document.getElementById('fe-move-file-name'),
    moveDestSelect: document.getElementById('fe-move-destination-select'),
    btnSubmitMove: document.getElementById('btn-submit-move'),

    // Sidebar folder count badge
    countFolders: document.getElementById('count-folders'),
  });

  // ---------- Public: activate / deactivate ----------

  function activate() {
    const d = dom();
    d.explorer.style.display = 'flex';
    fetchAndRender();
  }

  function deactivate() {
    const d = dom();
    d.explorer.style.display = 'none';
  }

  // ---------- Data fetching ----------

  async function fetchAndRender() {
    if (!activeWorkspaceId) return;
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/folders`);
      if (!res.ok) {
        console.warn(`FolderExplorer: Server returned status ${res.status} when fetching folders.`);
        return;
      }
      folderTree = await res.json();

      // Update sidebar badge (count top-level folders)
      const d = dom();
      if (d.countFolders) {
        d.countFolders.textContent = (folderTree.folders || []).length;
      }

      renderTree();
      navigateTo(currentFolderPath, false);
      if (window.Browse) window.Browse.invalidate(); // keep the unified view in sync after any folder/file operation
    } catch (err) {
      console.error('FolderExplorer: fetch error', err);
    }
  }

  // ---------- Tree rendering ----------

  function renderTree() {
    const d = dom();
    d.folderTree.innerHTML = '';

    // Root entry
    const rootLi = document.createElement('li');
    rootLi.className = 'folder-tree-root-item';

    const rootNode = makeTreeNode({
      name: 'Root',
      path: '',
      folders: folderTree.folders,
      files: folderTree.files,
    }, true);
    rootLi.appendChild(rootNode.el);

    if ((folderTree.folders || []).length > 0) {
      const childUl = buildTreeChildren(folderTree.folders);
      rootLi.appendChild(childUl);
    }

    d.folderTree.appendChild(rootLi);
    lucide.createIcons();
  }

  function buildTreeChildren(folders) {
    const ul = document.createElement('ul');
    ul.className = 'folder-tree-children';

    (folders || []).forEach(folder => {
      const li = document.createElement('li');
      const { el, childrenContainer } = makeTreeNode(folder, false);
      li.appendChild(el);

      if ((folder.folders || []).length > 0) {
        const nestedUl = buildTreeChildren(folder.folders);
        nestedUl.style.display = 'none';
        li.appendChild(nestedUl);
        childrenContainer.nestedUl = nestedUl;
      }

      ul.appendChild(li);
    });

    return ul;
  }

  function makeTreeNode(folder, isRoot) {
    const node = document.createElement('div');
    node.className = 'folder-tree-node';
    if (folder.path === currentFolderPath) node.classList.add('active');

    const hasChildren = (folder.folders || []).length > 0;

    node.innerHTML = `
      <i data-lucide="${isRoot ? 'hard-drive' : 'folder'}" class="node-icon"></i>
      <span class="node-label">${escapeHTML(folder.name)}</span>
      ${hasChildren ? '<i data-lucide="chevron-right" class="node-chevron"></i>' : ''}
      <span class="node-count">${(folder.files || []).length + (folder.folders || []).length}</span>
      ${!isRoot ? `
        <div class="node-actions">
          <button class="node-action-btn" data-action="rename" title="Rename"><i data-lucide="pencil"></i></button>
          <button class="node-action-btn danger" data-action="delete" title="Delete"><i data-lucide="trash-2"></i></button>
        </div>
      ` : ''}
    `;

    let nestedUl = null;

    // Drag-and-drop: tree node is a drop target
    node.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      node.classList.add('drag-hover');
    });
    node.addEventListener('dragleave', (e) => {
      if (!node.contains(e.relatedTarget)) {
        node.classList.remove('drag-hover');
      }
    });
    node.addEventListener('drop', async (e) => {
      e.preventDefault();
      node.classList.remove('drag-hover');
      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && data.filePath) {
          await moveFile(data.filePath, folder.path || '');
        }
      } catch (err) {
        console.error('Drop error:', err);
      }
    });

    // Right-click on node -> show context menu
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e, folder, 'folder');
    });

    // Click on the node label area = navigate
    node.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        if (action === 'rename') openRenameFolder(folder);
        if (action === 'delete') deleteFolder(folder);
        return;
      }

      // Toggle children if has sub-folders
      if (hasChildren && nestedUl) {
        const isOpen = node.classList.toggle('open');
        nestedUl.style.display = isOpen ? 'block' : 'none';
      }

      navigateTo(folder.path);
    });

    return { el: node, childrenContainer: { get nestedUl() { return nestedUl; }, set nestedUl(v) { nestedUl = v; } } };
  }

  // ---------- Navigation & breadcrumb ----------

  function navigateTo(path, scrollToTop = true) {
    currentFolderPath = path || '';
    updateBreadcrumb(currentFolderPath);
    updateTreeActiveState(currentFolderPath);

    const node = findNodeByPath(folderTree, currentFolderPath);
    activeFolderNode = node;
    renderContents(node || folderTree);

    if (scrollToTop) {
      const d = dom();
      d.explorer && d.explorer.scrollTop || 0;
    }
    safeCreateIcons();
  }

  function findNodeByPath(tree, path) {
    if (!path) return tree;
    function search(node) {
      if (node.path === path) return node;
      for (const f of (node.folders || [])) {
        const found = search(f);
        if (found) return found;
      }
      return null;
    }
    return search(tree);
  }

  function updateTreeActiveState(path) {
    const d = dom();
    d.folderTree.querySelectorAll('.folder-tree-node').forEach(n => n.classList.remove('active'));
    d.folderTree.querySelectorAll('.folder-tree-node').forEach(n => {
      // find by matching the label text (simplistic but works for unique paths)
      const label = n.querySelector('.node-label');
      if (!label) return;
      // We match via navigateTo path stored in data attribute
      if (n.dataset.path === path || (path === '' && n.closest('.folder-tree-root-item'))) {
        n.classList.add('active');
      }
    });
  }

  function updateBreadcrumb(path) {
    const d = dom();
    // Remove dynamic segments (keep the root button)
    d.breadcrumb.querySelectorAll('.breadcrumb-seg, .breadcrumb-sep').forEach(el => el.remove());

    if (!path) return;

    const parts = path.split('/').filter(Boolean);
    let accum = '';
    parts.forEach((part, idx) => {
      accum = accum ? `${accum}/${part}` : part;
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '/';
      d.breadcrumb.appendChild(sep);

      const btn = document.createElement('button');
      btn.className = 'breadcrumb-item breadcrumb-seg';
      btn.textContent = part;
      const capturePath = accum;
      btn.addEventListener('click', () => navigateTo(capturePath));

      // Drop target for breadcrumb segment
      btn.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        btn.classList.add('drag-hover');
      });
      btn.addEventListener('dragleave', (e) => {
        if (!btn.contains(e.relatedTarget)) {
          btn.classList.remove('drag-hover');
        }
      });
      btn.addEventListener('drop', async (e) => {
        e.preventDefault();
        btn.classList.remove('drag-hover');
        try {
          const raw = e.dataTransfer.getData('text/plain');
          if (!raw) return;
          const data = JSON.parse(raw);
          if (data && data.filePath) {
            await moveFile(data.filePath, capturePath);
          }
        } catch (err) {
          console.error('Drop error:', err);
        }
      });

      d.breadcrumb.appendChild(btn);
    });
  }

  // ---------- Contents rendering ----------

  function renderContents(node) {
    const d = dom();
    const folders = node.folders || [];
    const files = node.files || [];

    const isEmpty = folders.length === 0 && files.length === 0;

    d.contentsEmpty.style.display = isEmpty ? 'flex' : 'none';
    d.subfolderGrid.innerHTML = '';
    d.fileList.innerHTML = '';

    if (isEmpty) return;

    // Sub-folders grid
    if (folders.length > 0) {
      folders.forEach(folder => {
        const card = makeSubfolderCard(folder);
        d.subfolderGrid.appendChild(card);
      });
    }

    // Files section
    if (files.length > 0) {
      const header = document.createElement('div');
      header.className = 'file-section-header';
      header.textContent = `Files (${files.length})`;
      d.fileList.appendChild(header);

      files.forEach(file => {
        const row = makeFileRow(file);
        d.fileList.appendChild(row);
      });
    }

    safeCreateIcons();
  }

  function makeSubfolderCard(folder) {
    const card = document.createElement('div');
    card.className = 'subfolder-card';
    const fileCount = (folder.files || []).length;
    const folderCount = (folder.folders || []).length;
    const totalCount = fileCount + folderCount;

    card.innerHTML = `
      <div class="sf-actions">
        <button class="node-action-btn" data-action="rename" title="Rename"><i data-lucide="pencil"></i></button>
        <button class="node-action-btn danger" data-action="delete" title="Delete"><i data-lucide="trash-2"></i></button>
      </div>
      <i data-lucide="folder" class="sf-icon"></i>
      <span class="sf-name">${escapeHTML(folder.name)}</span>
      <span class="sf-count">${totalCount} item${totalCount !== 1 ? 's' : ''}</span>
    `;

    // Right-click on subfolder card -> show context menu
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e, folder, 'folder');
    });

    // Drop target for moving files into this folder
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-hover');
    });
    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-hover');
      }
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-hover');
      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && data.filePath) {
          await moveFile(data.filePath, folder.path);
        }
      } catch (err) {
        console.error('Drop error on subfolder card:', err);
      }
    });

    card.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        if (actionBtn.dataset.action === 'rename') openRenameFolder(folder);
        if (actionBtn.dataset.action === 'delete') deleteFolder(folder);
        return;
      }
      navigateTo(folder.path);
    });

    return card;
  }

  function makeFileRow(file) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const sizeStr = formatBytes(file.size || 0);
    const dateStr = file.modifiedAt ? formatDate(file.modifiedAt) : '';
    const fileUrl = `/uploads/${activeWorkspaceId}/${file.path}`;
    const fileTarget = {
      title: file.name,
      fileName: file.name,
      filePath: fileUrl,
      path: file.path,
      size: file.size,
      type: 'file'
    };
    const ext = file.name.split('.').pop().toLowerCase();
    const iconName = ['pdf'].includes(ext) ? 'file-text' : ['ppt', 'pptx', 'pps', 'ppsx', 'potx', 'odp'].includes(ext) ? 'presentation' : ['xls', 'xlsx', 'csv'].includes(ext) ? 'table' : ['doc', 'docx', 'txt', 'md'].includes(ext) ? 'file-text' : ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? 'image' : 'file';

    let readBadgeHTML = '';
    if (window.ReadingProgressManager) {
      const prog = window.ReadingProgressManager.getProgress(fileTarget);
      if (prog && (prog.page > 1 || prog.percentage > 0)) {
        readBadgeHTML = `<span class="fr-read-badge" title="Reading Progress: Page ${prog.page} of ${prog.totalPages} (${prog.percentage}%)">📖 ${prog.percentage}% (Pg ${prog.page})</span>`;
      }
    }

    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ filePath: file.path, name: file.name }));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
    });

    row.innerHTML = `
      <i data-lucide="${iconName}" class="fr-icon"></i>
      <div class="fr-name">
        <a href="${fileUrl}" class="fr-open-link" title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</a>
        ${readBadgeHTML}
      </div>
      <span class="fr-size">${sizeStr}</span>
      <span class="fr-date">${dateStr}</span>
      <div class="fr-actions">
        <a href="${fileUrl}" class="fr-action-btn fr-btn-open-view" title="Open in Viewer"><i data-lucide="eye"></i></a>
        <a href="${fileUrl}" download="${escapeHTML(file.name)}" class="fr-action-btn" title="Download"><i data-lucide="download"></i></a>
        <button class="fr-action-btn" data-action="move" title="Move to folder"><i data-lucide="folder-input"></i></button>
        <button class="fr-action-btn" data-action="rename" title="Rename file"><i data-lucide="pencil"></i></button>
        <button class="fr-action-btn danger" data-action="delete" title="Delete file"><i data-lucide="trash-2"></i></button>
      </div>
    `;

    // Click on filename or eye -> open in Dedicated Viewer
    const openLink = row.querySelector('.fr-open-link');
    if (openLink) {
      openLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.WorkspaceViewer) window.WorkspaceViewer.open(fileTarget);
        else window.open(fileUrl, '_blank');
      });
    }

    const openBtn = row.querySelector('.fr-btn-open-view');
    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.WorkspaceViewer) window.WorkspaceViewer.open(fileTarget);
        else window.open(fileUrl, '_blank');
      });
    }

    // Right-click on file row -> show context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e, fileTarget, 'file');
    });

    row.querySelector('[data-action="move"]').addEventListener('click', () => openMoveFileModal(file));
    row.querySelector('[data-action="rename"]').addEventListener('click', () => openRenameFile(file));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteFile(file));

    return row;
  }

  // ---------- Folder CRUD ----------

  function openCreateFolderModal(parent) {
    if (parent !== undefined) currentFolderPath = parent || '';
    const d = dom();
    if (d.folderNameInput) d.folderNameInput.value = '';
    const targetLabel = document.getElementById('create-folder-target-label');
    if (targetLabel) {
      targetLabel.textContent = currentFolderPath ? `Location: ${currentFolderPath}` : 'Location: Root';
    }
    if (d.modalCreateFolder) {
      d.modalCreateFolder.classList.add('active');
      setTimeout(() => d.folderNameInput && d.folderNameInput.focus(), 100);
    }
  }

  async function createFolder(name, parent) {
    const parentPath = parent !== undefined ? (parent || '') : (currentFolderPath || '');
    const cleanName = String(name || '').trim().replace(/[<>:"/\\|?*]/g, '_');
    if (!cleanName) return;

    // Optimistically register in workspaceFolders so it appears immediately!
    const newFolderObj = {
      name: cleanName,
      path: parentPath ? `${parentPath}/${cleanName}` : cleanName,
      parent: parentPath || ''
    };
    if (Array.isArray(workspaceFolders)) {
      if (!workspaceFolders.some(f => (f.path || f.name) === newFolderObj.path)) {
        workspaceFolders.push(newFolderObj);
      }
    }
    if (window.Browse && typeof window.Browse.render === 'function') {
      window.Browse.render();
    }

    try {
      // 1. Supabase Cloud: save to 'folders' table if configured
      if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        try {
          await window.SupabaseManager.createFolder(activeWorkspaceId, cleanName, parentPath);
        } catch (sbErr) {
          console.warn('Supabase createFolder warn:', sbErr);
        }
      }

      // 2. Local disk backend
      try {
        await fetch(`/api/workspaces/${activeWorkspaceId}/folders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentPath, name: cleanName })
        });
      } catch (localErr) {
        console.warn('Local createFolder warn:', localErr);
      }

      // 3. Immediately refresh workspace data & unified browser
      if (typeof fetchWorkspaceData === 'function') {
        await fetchWorkspaceData({ silent: true });
      }
      if (window.Browse && typeof window.Browse.invalidate === 'function') {
        window.Browse.invalidate();
      }
      if (typeof fetchAndRender === 'function') {
        await fetchAndRender();
      }
      if (typeof showToast === 'function') {
        showToast(`Folder "${cleanName}" created!`);
      }
    } catch (err) {
      alert(err.message || 'Failed to create folder');
    }
  }

  async function deleteFolder(folder) {
    if (!folder) return;
    const folderName = folder.name || folder.path || 'this folder';
    const folderPath = folder.path || folder.name || '';
    if (!folderPath) return;

    if (!confirm(`Delete folder "${folderName}" and ALL its contents? This cannot be undone.`)) return;

    try {
      let supabaseHandled = false;
      // 1. Supabase Cloud deletion
      if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        try {
          await window.SupabaseManager.deleteFolder(activeWorkspaceId, folderPath, folder.id);
          supabaseHandled = true;
        } catch (sbErr) {
          console.warn('Supabase deleteFolder error:', sbErr);
          if (currentUser && currentUser.provider === 'supabase') {
            throw sbErr;
          }
        }
      }

      // 2. Local disk backend
      try {
        const res = await fetch(`/api/workspaces/${activeWorkspaceId}/folders`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath })
        });
        if (!res.ok && !supabaseHandled) {
          let errMsg = 'Failed to delete folder';
          try {
            const err = await res.json();
            errMsg = err.error || errMsg;
          } catch {
            errMsg = `Server returned ${res.status}: ${res.statusText}`;
          }
          throw new Error(errMsg);
        }
      } catch (localErr) {
        if (!supabaseHandled) throw localErr;
      }

      // 3. Immediately clean up local in-memory state so UI updates instantly
      workspaceFolders = workspaceFolders.filter(f => {
        const p = f.path || (f.parent ? `${f.parent}/${f.name}` : f.name);
        return p !== folderPath && !p.startsWith(folderPath + '/');
      });

      if (dbData && dbData.items) {
        dbData.items = dbData.items.filter(it => {
          if (!it.folder) return true;
          return it.folder !== folderPath && !it.folder.startsWith(folderPath + '/');
        });
      }

      // If we were inside this folder or a child folder, navigate up
      if (currentFolderPath === folderPath || currentFolderPath.startsWith(folderPath + '/')) {
        currentFolderPath = folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : '';
      }
      if (window.Browse && typeof window.Browse.resetPathIfDeleted === 'function') {
        window.Browse.resetPathIfDeleted(folderPath);
      }

      // 4. Invalidate unified browse & re-render
      if (window.Browse && typeof window.Browse.invalidate === 'function') {
        window.Browse.invalidate();
      }
      if (typeof fetchWorkspaceData === 'function') {
        await fetchWorkspaceData({ silent: true });
      } else {
        await fetchAndRender();
      }
      if (typeof updateUI === 'function') {
        updateUI();
      }
      if (typeof showToast === 'function') {
        showToast(`Folder "${folderName}" deleted`);
      }
    } catch (err) {
      console.error('Error deleting folder:', err);
      alert(err.message || 'Failed to delete folder');
    }
  }

  // ---------- File CRUD ----------

  async function deleteFile(file) {
    if (!file) return;
    const fileName = file.name || file.fileName || file.title || 'file';
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return;
    try {
      let supabaseHandled = false;
      const matchingItem = (dbData && dbData.items)
        ? dbData.items.find(it => it.id === file.id || (file.path && it.filePath && (it.filePath.endsWith(file.path) || it.filePath.includes(file.path))))
        : null;

      if (matchingItem && window.SupabaseManager && window.SupabaseManager.isConfigured()) {
        try {
          await window.SupabaseManager.deleteItem(activeWorkspaceId, matchingItem.id);
          supabaseHandled = true;
        } catch (sbErr) {
          console.warn('Supabase deleteItem error:', sbErr);
        }
      }

      try {
        const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: file.path })
        });
        if (!res.ok && !supabaseHandled) {
          let errMsg = 'Failed to delete file';
          try {
            const err = await res.json();
            errMsg = err.error || errMsg;
          } catch {
            errMsg = `Server returned ${res.status}: ${res.statusText}`;
          }
          throw new Error(errMsg);
        }
      } catch (localErr) {
        if (!supabaseHandled) throw localErr;
      }

      if (matchingItem && dbData && dbData.items) {
        dbData.items = dbData.items.filter(it => it.id !== matchingItem.id);
      }
      if (window.Browse && typeof window.Browse.invalidate === 'function') {
        window.Browse.invalidate();
      }
      if (typeof fetchWorkspaceData === 'function') {
        await fetchWorkspaceData({ silent: true });
      } else {
        await fetchAndRender();
      }
      if (typeof updateUI === 'function') {
        updateUI();
      }
      if (typeof showToast === 'function') {
        showToast(`"${fileName}" deleted`);
      }
    } catch (err) {
      alert(err.message || 'Failed to delete file');
    }
  }

  // ---------- Rename modal ----------

  function openRenameFolder(folder) {
    renameTarget = { type: 'folder', path: folder.path, name: folder.name };
    const d = dom();
    d.renameModalTitle.textContent = 'Rename Folder';
    d.renameInput.value = folder.name;
    d.modalRename.classList.add('active');
    setTimeout(() => d.renameInput.focus(), 100);
  }

  function openRenameFile(file) {
    renameTarget = { type: 'file', path: file.path, name: file.name };
    const d = dom();
    d.renameModalTitle.textContent = 'Rename File';
    d.renameInput.value = file.name;
    d.modalRename.classList.add('active');
    setTimeout(() => d.renameInput.focus(), 100);
  }

  async function doRename(newName) {
    if (!renameTarget || !newName.trim()) return;
    const cleanNewName = newName.trim();
    try {
      let supabaseRenamed = false;
      if (renameTarget.type === 'folder') {
        if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
          try {
            await window.SupabaseManager.renameFolder(activeWorkspaceId, renameTarget.path, cleanNewName);
            supabaseRenamed = true;
          } catch (sbErr) {
            console.warn('Supabase renameFolder error:', sbErr);
            if (currentUser && currentUser.provider === 'supabase') throw sbErr;
          }
        }

        try {
          const res = await fetch(`/api/workspaces/${activeWorkspaceId}/folders`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: renameTarget.path, newName: cleanNewName })
          });
          if (!res.ok && !supabaseRenamed) {
            let errMsg = 'Rename failed';
            try {
              const err = await res.json();
              errMsg = err.error || errMsg;
            } catch {
              errMsg = `Server returned ${res.status}: ${res.statusText}`;
            }
            throw new Error(errMsg);
          }
        } catch (apiErr) {
          if (!supabaseRenamed) throw apiErr;
        }
      } else {
        const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/rename`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: renameTarget.path, newName: cleanNewName })
        });
        if (!res.ok) {
          let errMsg = 'Rename failed';
          try {
            const err = await res.json();
            errMsg = err.error || errMsg;
          } catch {
            errMsg = `Server returned ${res.status}: ${res.statusText}`;
          }
          throw new Error(errMsg);
        }
      }

      if (window.Browse && typeof window.Browse.invalidate === 'function') {
        window.Browse.invalidate();
      }
      if (typeof fetchWorkspaceData === 'function') {
        await fetchWorkspaceData({ silent: true });
      } else {
        await fetchAndRender();
      }
      if (typeof updateUI === 'function') {
        updateUI();
      }
      if (typeof showToast === 'function') {
        showToast('Renamed successfully');
      }
    } catch (err) {
      alert(err.message || 'Rename failed');
    }
    renameTarget = null;
  }

  // ---------- Move File ----------

  function getAllFoldersList(tree) {
    const list = [{ path: '', label: '📁 Root' }];
    if (!tree) return list;
    function traverse(node, currentPath) {
      (node.folders || []).forEach(f => {
        const fullPath = currentPath ? `${currentPath}/${f.name}` : f.name;
        const depth = fullPath.split('/').length;
        const indent = '　'.repeat(depth - 1) + '└─ 📁 ';
        list.push({ path: f.path, label: indent + f.name });
        traverse(f, fullPath);
      });
    }
    traverse(tree, '');
    return list;
  }

  function openMoveFileModal(file) {
    moveTarget = file;
    const d = dom();
    d.moveFileName.textContent = file.name;
    d.moveDestSelect.innerHTML = '';

    const allFolders = getAllFoldersList(folderTree);
    const currentFileParent = file.path.includes('/')
      ? file.path.substring(0, file.path.lastIndexOf('/'))
      : '';

    let hasValidTarget = false;
    allFolders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.path;
      option.textContent = folder.label;
      if (folder.path === currentFileParent) {
        option.textContent += ' (current location)';
        option.disabled = true;
      } else {
        if (!hasValidTarget) {
          option.selected = true;
          hasValidTarget = true;
        }
      }
      d.moveDestSelect.appendChild(option);
    });

    d.btnSubmitMove.disabled = !hasValidTarget;
    d.modalMove.classList.add('active');
  }

  async function moveFile(filePath, targetFolder) {
    const currentParent = filePath.includes('/')
      ? filePath.substring(0, filePath.lastIndexOf('/'))
      : '';
    if (currentParent === targetFolder) {
      alert('File is already in that folder.');
      return;
    }

    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, targetFolder })
      });
      if (!res.ok) {
        let errMsg = 'Failed to move file';
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch {
          errMsg = `Server returned ${res.status}: ${res.statusText}`;
        }
        throw new Error(errMsg);
      }
      await fetchAndRender();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- Upload to folder ----------

  function openUploadModal() {
    const d = dom();
    d.feTargetLabel.textContent = currentFolderPath ? currentFolderPath.split('/').pop() : 'Root';
    d.feFileInput.value = '';
    d.feSelectedInfo.style.display = 'none';
    d.feFileDropzone.style.display = 'flex';
    d.feUploadProgress.style.display = 'none';
    d.feProgressFill.style.width = '0%';
    d.btnFeSubmitUpload.disabled = false;
    d.modalFolderUpload.classList.add('active');
  }

  async function uploadFilesToFolder(files) {
    const d = dom();
    if (!files || files.length === 0) return;

    d.feUploadProgress.style.display = 'block';
    d.btnFeSubmitUpload.disabled = true;

    const url = `/api/workspaces/${activeWorkspaceId}/upload-to-folder?folder=${encodeURIComponent(currentFolderPath)}`;
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          d.feProgressFill.style.width = pct + '%';
          d.feProgressText.textContent = `Uploading... ${pct}%`;
        }
      };

      xhr.onload = () => {
        if (xhr.status === 201) {
          d.feProgressText.textContent = `Done! ${files.length} file(s) uploaded.`;
          d.feProgressFill.style.width = '100%';
          resolve();
        } else {
          alert('Upload failed: ' + xhr.responseText);
          reject(new Error(xhr.responseText));
        }
      };
      xhr.onerror = () => { alert('Network error during upload.'); reject(); };
      xhr.send(formData);
    }).catch(() => { });

    setTimeout(async () => {
      d.modalFolderUpload.classList.remove('active');
      await fetchAndRender();
    }, 600);
  }

  // ---------- Upload a whole folder (keeps subfolder structure) ----------

  const JUNK_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
  const FOLDER_BATCH_MAX_FILES = 20;
  const FOLDER_BATCH_MAX_BYTES = 40 * 1024 * 1024;

  function notify(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else alert(msg);
  }

  // Recursively read dropped FileSystemEntry items into [{ file, rel }]
  async function readDroppedEntries(entries) {
    const out = [];
    async function walk(entry, prefix) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        out.push({ file, rel: prefix + entry.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const child of batch) await walk(child, prefix + entry.name + '/');
        } while (batch.length);
      }
    }
    for (const e of entries) await walk(e, '');
    return out;
  }

  function postBatch(url, files, onProgress) {
    return new Promise((resolve) => {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
      xhr.onload = () => resolve({ ok: xhr.status === 201, text: xhr.responseText });
      xhr.onerror = () => resolve({ ok: false, text: 'Network error' });
      xhr.send(fd);
    });
  }

  // items: [{ file: File, rel: 'Folder/sub/name.pdf' }]
  async function uploadFolderItems(items) {
    const d = dom();
    const clean = (s) => s.replace(/[<>:"/\\|?*]/g, '_').trim();
    const groups = new Map(); // target folder path -> File[]
    let skipped = 0;
    for (const { file, rel } of items) {
      if (JUNK_FILES.has(file.name.toLowerCase())) { skipped++; continue; }
      const parts = rel.split('/').filter(p => p && p !== '.' && p !== '..').map(clean).filter(Boolean);
      const target = [currentFolderPath, ...parts.slice(0, -1)].filter(Boolean).join('/');
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push(file);
    }
    const totalFiles = [...groups.values()].reduce((a, g) => a + g.length, 0);
    if (!totalFiles) { notify('That folder has no files to upload.', 'error'); return; }
    const totalBytes = [...groups.values()].flat().reduce((a, f) => a + f.size, 0);

    // Build batches (never mixing destination folders)
    const batches = [];
    for (const [target, files] of groups) {
      let cur = [], bytes = 0;
      for (const f of files) {
        if (cur.length && (cur.length >= FOLDER_BATCH_MAX_FILES || bytes + f.size > FOLDER_BATCH_MAX_BYTES)) {
          batches.push({ target, files: cur }); cur = []; bytes = 0;
        }
        cur.push(f); bytes += f.size;
      }
      if (cur.length) batches.push({ target, files: cur });
    }

    const rootName = (items[0].rel.split('/')[0]) || 'folder';
    openUploadModal();
    d.feFileDropzone.style.display = 'none';
    d.feSelectedInfo.style.display = 'none';
    d.feUploadProgress.style.display = 'block';
    d.btnFeSubmitUpload.disabled = true;

    let doneBytes = 0, doneFiles = 0, failed = 0;

    if (window.SupabaseManager && window.SupabaseManager.isConfigured()) {
      // 1. Ensure all folder levels exist in Supabase
      const allFoldersMap = new Map();
      for (const target of groups.keys()) {
        if (!target) continue;
        const parts = target.split('/').filter(Boolean);
        let curr = '';
        for (const p of parts) {
          const parent = curr;
          curr = curr ? `${curr}/${p}` : p;
          if (!allFoldersMap.has(curr)) {
            allFoldersMap.set(curr, { name: p, parent });
          }
        }
      }

      for (const [fPath, fObj] of allFoldersMap) {
        try {
          await window.SupabaseManager.createFolder(activeWorkspaceId, fObj.name, fObj.parent);
        } catch (e) {
          console.warn('Folder creation warning in Supabase:', e);
        }
      }

      // 2. Upload files to Supabase Storage & insert items
      for (const [target, files] of groups) {
        for (const file of files) {
          try {
            d.feProgressText.textContent = `Uploading "${file.name}"... (${doneFiles + 1}/${totalFiles})`;
            const { item } = await window.SupabaseManager.uploadFile(activeWorkspaceId, file, target);
            if (item && dbData && Array.isArray(dbData.items)) {
              dbData.items.unshift(item);
            }
            doneFiles++;
          } catch (err) {
            console.error(`Failed to upload ${file.name} to Supabase:`, err);
            failed++;
          }
          doneBytes += file.size;
          const pct = totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 100;
          d.feProgressFill.style.width = pct + '%';
        }
      }

      // Also fire background upload to local server so disk is also populated
      batches.forEach(b => {
        const url = `/api/workspaces/${activeWorkspaceId}/upload-to-folder?folder=${encodeURIComponent(b.target)}`;
        postBatch(url, b.files, () => {}).catch(() => {});
      });
    } else {
      // Local Server mode
      for (const b of batches) {
        const batchBytes = b.files.reduce((a, f) => a + f.size, 0);
        const url = `/api/workspaces/${activeWorkspaceId}/upload-to-folder?folder=${encodeURIComponent(b.target)}`;
        const res = await postBatch(url, b.files, (loaded, total) => {
          const frac = total ? Math.min(1, loaded / total) : 0;
          const pct = totalBytes ? Math.round(((doneBytes + batchBytes * frac) / totalBytes) * 100) : 0;
          d.feProgressFill.style.width = pct + '%';
          d.feProgressText.textContent = `Uploading "${rootName}"... ${pct}% (${doneFiles}/${totalFiles} files)`;
        });
        if (res.ok) doneFiles += b.files.length; else failed += b.files.length;
        doneBytes += batchBytes;
      }
    }

    d.feProgressFill.style.width = '100%';
    d.feProgressText.textContent = failed
      ? `Finished: ${doneFiles} uploaded, ${failed} failed.`
      : `Done! ${doneFiles} file(s) uploaded from "${rootName}".`;
    if (failed) notify(`${failed} file(s) could not be uploaded. The rest of the folder was added.`, 'error');
    else notify(`Folder "${rootName}" uploaded (${doneFiles} files).`, 'success');

    setTimeout(async () => {
      d.modalFolderUpload.classList.remove('active');
      d.btnFeSubmitUpload.disabled = false;
      await fetchAndRender();
      if (typeof fetchWorkspaceData === 'function') await fetchWorkspaceData();
      if (window.Browse) window.Browse.invalidate();
    }, 900);
  }

  function pickFolderToUpload() {
    const d = dom();
    d.feFolderInput.value = '';
    d.feFolderInput.click();
  }

  // ---------- Event wiring ----------

  function setupEvents() {
    const d = dom();

    // Root breadcrumb
    d.btnRoot.addEventListener('click', () => navigateTo(''));

    // Root breadcrumb drop target (move file to root folder)
    d.btnRoot.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      d.btnRoot.classList.add('drag-hover');
    });
    d.btnRoot.addEventListener('dragleave', (e) => {
      if (!d.btnRoot.contains(e.relatedTarget)) {
        d.btnRoot.classList.remove('drag-hover');
      }
    });
    d.btnRoot.addEventListener('drop', async (e) => {
      e.preventDefault();
      d.btnRoot.classList.remove('drag-hover');
      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && data.filePath) {
          await moveFile(data.filePath, '');
        }
      } catch (err) {
        console.error('Drop error on root breadcrumb:', err);
      }
    });

    // New Folder button (toolbar)
    d.btnNewFolder.addEventListener('click', () => openCreateFolderModal());

    // Upload button (toolbar)
    d.btnUpload.addEventListener('click', () => openUploadModal());

    // Upload button (empty state)
    d.btnUploadEmpty.addEventListener('click', () => openUploadModal());

    // Upload whole folder (toolbar + empty state)
    if (d.btnUploadFolder) d.btnUploadFolder.addEventListener('click', pickFolderToUpload);
    if (d.btnUploadFolderEmpty) d.btnUploadFolderEmpty.addEventListener('click', pickFolderToUpload);
    if (d.feFolderInput) d.feFolderInput.addEventListener('change', () => {
      const files = Array.from(d.feFolderInput.files || []);
      d.feFolderInput.value = '';
      if (!files.length) return; // cancelled or empty folder
      uploadFolderItems(files.map(f => ({ file: f, rel: f.webkitRelativePath || f.name })));
    });

    // --- Create Folder modal ---
    d.btnCloseFolderModal.addEventListener('click', () => d.modalCreateFolder.classList.remove('active'));
    d.modalCreateFolder.addEventListener('click', (e) => {
      if (e.target === d.modalCreateFolder) d.modalCreateFolder.classList.remove('active');
    });
    d.formCreateFolder.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = d.folderNameInput.value.trim();
      if (!name) return;
      d.modalCreateFolder.classList.remove('active');
      await createFolder(name);
      d.formCreateFolder.reset();
    });

    // --- Upload to Folder modal ---
    d.btnCloseFolderUploadModal.addEventListener('click', () => d.modalFolderUpload.classList.remove('active'));
    d.modalFolderUpload.addEventListener('click', (e) => {
      if (e.target === d.modalFolderUpload) d.modalFolderUpload.classList.remove('active');
    });

    // Dropzone click
    d.feFileDropzone.addEventListener('click', () => d.feFileInput.click());
    d.feFileInput.addEventListener('change', () => {
      if (d.feFileInput.files.length > 0) handleFeFilesSelected(d.feFileInput.files);
    });

    // Drag and drop
    ['dragenter', 'dragover'].forEach(ev => {
      d.feFileDropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        d.feFileDropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      d.feFileDropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        d.feFileDropzone.classList.remove('dragover');
      });
    });
    d.feFileDropzone.addEventListener('drop', (e) => {
      // Folder drop: entries must be grabbed synchronously during the event
      const dtItems = e.dataTransfer.items;
      if (dtItems && dtItems.length && typeof dtItems[0].webkitGetAsEntry === 'function') {
        const entries = [];
        let hasDir = false;
        for (const it of dtItems) {
          if (it.kind !== 'file') continue;
          const en = it.webkitGetAsEntry();
          if (en) { entries.push(en); if (en.isDirectory) hasDir = true; }
        }
        if (hasDir) {
          readDroppedEntries(entries)
            .then(uploadFolderItems)
            .catch(err => notify('Could not read the dropped folder: ' + (err && err.message || err), 'error'));
          return;
        }
      }
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        d.feFileInput.files = files;
        handleFeFilesSelected(files);
      }
    });

    d.btnFeRemoveFile.addEventListener('click', () => {
      d.feFileInput.value = '';
      d.feSelectedInfo.style.display = 'none';
      d.feFileDropzone.style.display = 'flex';
    });

    d.formFolderUpload.addEventListener('submit', async (e) => {
      e.preventDefault();
      await uploadFilesToFolder(d.feFileInput.files);
    });

    // --- Rename modal ---
    d.btnCloseRename.addEventListener('click', () => d.modalRename.classList.remove('active'));
    d.modalRename.addEventListener('click', (e) => {
      if (e.target === d.modalRename) d.modalRename.classList.remove('active');
    });
    d.formRename.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = d.renameInput.value.trim();
      d.modalRename.classList.remove('active');
      if (newName) await doRename(newName);
    });

    // --- Move File modal ---
    d.btnCloseMove.addEventListener('click', () => d.modalMove.classList.remove('active'));
    d.btnCancelMove.addEventListener('click', () => d.modalMove.classList.remove('active'));
    d.modalMove.addEventListener('click', (e) => {
      if (e.target === d.modalMove) d.modalMove.classList.remove('active');
    });
    d.formMove.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!moveTarget) return;
      const targetFolder = d.moveDestSelect.value;
      d.modalMove.classList.remove('active');
      await moveFile(moveTarget.path, targetFolder);
      moveTarget = null;
    });
  }

  function handleFeFilesSelected(files) {
    const d = dom();
    if (files.length === 1) {
      d.feFileNameLabel.textContent = `${files[0].name} (${formatBytes(files[0].size)})`;
    } else {
      const total = Array.from(files).reduce((a, f) => a + f.size, 0);
      d.feFileNameLabel.textContent = `${files.length} files selected (${formatBytes(total)} total)`;
    }
    d.feFileDropzone.style.display = 'none';
    d.feSelectedInfo.style.display = 'flex';
  }

  // ---------- Public API ----------

  return {
    activate,
    deactivate,
    setupEvents,
    refresh: fetchAndRender,
    navigateTo,
    deleteFolder,
    openRenameFolder,
    deleteFile,
    openRenameFile,
    openMoveFileModal,
    // Used by the unified Browse view: upload into whichever folder is open there
    uploadHere(path, kind) {
      currentFolderPath = path || '';
      if (kind === 'folder') pickFolderToUpload(); else openUploadModal();
    },
    createFolderHere(path) {
      openCreateFolderModal(path || '');
    },
    createFolder,
    openCreateFolderModal
  };
})();

// Explicitly export to window so other scripts (like browse.js) can invoke them directly
window.FolderExplorer = FolderExplorer;
window.openCreateFolderModal = (path) => FolderExplorer.createFolderHere(path);
window.createFolder = (name, parent) => FolderExplorer.createFolder(name, parent);

// ================================================================
// Hook Folder Explorer into the sidebar filter system
// ================================================================

(function hookFolderExplorer() {
  // Wait for DOM using resilient onReady helper
  onReady(() => {
    FolderExplorer.setupEvents();

    const filterFolders = document.getElementById('filter-folders');
    if (!filterFolders) return;

    filterFolders.addEventListener('click', () => {
      // Folders now live in the unified view (sidebar tree + main area): go to All Items at the workspace root
      if (window.Browse) {
        filterAll.click();
        window.Browse.navigate('');
        return;
      }
      // Legacy fallback (Browse not loaded)
      [filterAll, filterLinks, filterFiles, filterNotes].forEach(el => el.classList.remove('active'));
      filterFolders.classList.add('active');

      // Hide regular grid, show explorer
      itemsGrid.style.display = 'none';
      emptyState.style.display = 'none';
      const statusBar = document.getElementById('filter-status-bar');
      if (statusBar) statusBar.style.display = 'none';

      FolderExplorer.activate();
    });

    // Patch existing type filter buttons to hide the explorer when clicked
    [filterAll, filterLinks, filterFiles, filterNotes].forEach(el => {
      el.addEventListener('click', () => {
        filterFolders.classList.remove('active');
        FolderExplorer.deactivate();
      });
    });

    // Also refresh when workspace changes
    window.addEventListener('workspaceChanged', () => {
      if (document.getElementById('folder-explorer').style.display !== 'none') {
        FolderExplorer.refresh();
      }
    });
  });
})();

// ================================================================
// Mobile / Android Compatibility & PWA Controller
// ================================================================

(function initMobileAndPWA() {
  onReady(() => {
    // 1. Service Worker Registration
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(reg => {
            console.log('[PWA] Service Worker registered successfully:', reg.scope);
          })
          .catch(err => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });
    }

    // 2. Mobile Drawer Navigation
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const btnMobileMenu = document.getElementById('btn-mobile-menu');
    const btnSidebarClose = document.getElementById('btn-sidebar-close');

    function openSidebar() {
      if (sidebar) sidebar.classList.add('open');
      if (backdrop) backdrop.classList.add('active');
    }

    function closeSidebar() {
      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('active');
    }

    if (btnMobileMenu) btnMobileMenu.addEventListener('click', openSidebar);
    if (btnSidebarClose) btnSidebarClose.addEventListener('click', closeSidebar);
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    // Auto-close drawer on mobile when selecting filters or navigating
    const navItems = document.querySelectorAll('.nav-list li');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          closeSidebar();
        }
      });
    });

    if (workspaceSelect) {
      workspaceSelect.addEventListener('change', () => {
        if (window.innerWidth <= 900) {
          closeSidebar();
        }
      });
    }

    // 3. PWA Installation Handler
    let deferredPrompt = null;
    const btnPwaInstall = document.getElementById('btn-pwa-install');

    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent automatic mini-infobar on mobile Chrome
      e.preventDefault();
      deferredPrompt = e;
      if (btnPwaInstall) {
        btnPwaInstall.style.display = 'inline-flex';
        if (window.lucide) lucide.createIcons();
      }
    });

    if (btnPwaInstall) {
      btnPwaInstall.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[PWA] User response to install prompt:', outcome);
        deferredPrompt = null;
        btnPwaInstall.style.display = 'none';
      });
    }

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] Workspace app was successfully installed on device.');
      if (btnPwaInstall) btnPwaInstall.style.display = 'none';
      if (typeof showToast === 'function') {
        showToast('App installed on your device!');
      }
    });

    // Wire PDF Viewer Header Button
    const btnOpenViewer = document.getElementById('btn-open-viewer');
    if (btnOpenViewer) {
      btnOpenViewer.addEventListener('click', () => {
        if (!window.WorkspaceViewer) return;
        const allFiles = (dbData.items || []).filter(i => i.type === 'file');
        let targetFile = null;

        // Check if any file was read recently
        if (window.ReadingProgressManager && allFiles.length > 0) {
          let latestTime = 0;
          for (const file of allFiles) {
            const prog = window.ReadingProgressManager.getProgress(file);
            if (prog && prog.lastReadAt) {
              const time = new Date(prog.lastReadAt).getTime();
              if (time > latestTime) {
                latestTime = time;
                targetFile = file;
              }
            }
          }
        }

        // If no recently read file, pick the first PDF/file
        if (!targetFile && allFiles.length > 0) {
          targetFile = allFiles.find(i => (i.fileName || '').toLowerCase().endsWith('.pdf')) || allFiles[0];
        }

        if (targetFile) {
          window.WorkspaceViewer.open(targetFile);
        } else {
          const fileInput = document.getElementById('dv-file-input');
          if (fileInput) fileInput.click();
        }
      });
    }

    // Dynamic live refresh when reading progress is updated
    window.addEventListener('workspace-reading-progress-updated', () => {
      updateUI();
      if (window.FolderExplorer && typeof window.FolderExplorer.fetchAndRender === 'function') {
        window.FolderExplorer.fetchAndRender();
      }
    });
  });
})();


