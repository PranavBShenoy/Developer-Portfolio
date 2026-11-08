/**
 * PS. Console — Developer Portfolio Admin Single Page Application Controller
 * Pure Vanilla JavaScript (zero external client dependencies)
 */

(function () {
  'use strict';

  // Application State
  const state = {
    user: null,
    preview: null,
    audit: null,
    activeTab: 'telemetry',
    isLoading: false
  };

  // DOM Elements
  const el = {
    authGate: document.getElementById('auth-gate'),
    adminApp: document.getElementById('admin-app'),
    loginForm: document.getElementById('login-form'),
    loginEmail: document.getElementById('login-email'),
    loginPassword: document.getElementById('login-password'),
    loginSubmit: document.getElementById('login-submit'),
    authError: document.getElementById('auth-error'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    sidebar: document.getElementById('admin-sidebar'),
    topbarUser: document.getElementById('topbar-user'),
    topbarVersion: document.getElementById('topbar-version'),
    btnLogout: document.getElementById('btn-logout'),
    btnPublishAll: document.getElementById('btn-publish-all'),
    btnPreviewModal: document.getElementById('btn-preview-modal'),
    btnRefreshData: document.getElementById('btn-refresh-data'),
    sidebarDraftCount: document.getElementById('sidebar-draft-count'),
    sidebarDraftProgress: document.getElementById('sidebar-draft-progress'),
    navItems: document.querySelectorAll('.nav-item'),
    panes: document.querySelectorAll('.admin-pane'),
    // Stats
    statLiveVersion: document.getElementById('stat-live-version'),
    statPendingDrafts: document.getElementById('stat-pending-drafts'),
    statActiveProjects: document.getElementById('stat-active-projects'),
    statMediaCount: document.getElementById('stat-media-count'),
    statPublishedTime: document.getElementById('stat-published-time'),
    // Containers & Tables
    tableRecentAudit: document.getElementById('table-recent-audit')?.querySelector('tbody'),
    tableProjects: document.getElementById('table-projects')?.querySelector('tbody'),
    skillsContainer: document.getElementById('skills-container'),
    experienceContainer: document.getElementById('experience-container'),
    tableCertifications: document.getElementById('table-certifications')?.querySelector('tbody'),
    tableMedia: document.getElementById('table-media')?.querySelector('tbody'),
    tableSnapshots: document.getElementById('table-snapshots')?.querySelector('tbody'),
    tableFullAudit: document.getElementById('table-full-audit')?.querySelector('tbody'),
    // Settings Form
    formSettings: document.getElementById('form-settings'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    // Media Dropzone
    mediaDropzone: document.getElementById('media-dropzone'),
    mediaFileInput: document.getElementById('media-file-input'),
    btnBrowseFile: document.getElementById('btn-browse-file'),
    // Action Buttons
    btnNewProject: document.getElementById('btn-new-project'),
    btnNewCategory: document.getElementById('btn-new-category'),
    btnNewSkill: document.getElementById('btn-new-skill'),
    btnNewExperience: document.getElementById('btn-new-experience'),
    btnNewCertification: document.getElementById('btn-new-certification'),
    // Modal
    modal: document.getElementById('admin-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    modalClose: document.getElementById('modal-close'),
    // Toast Container
    toastContainer: document.getElementById('toast-container')
  };

  // ==========================================================================
  // Helper: Toast Notifications
  // ==========================================================================

  function showToast(message, type = 'info') {
    if (!el.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'opacity 0.2s, transform 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, 4000);
  }

  // ==========================================================================
  // Helper: API Fetcher with JSON handling & Error detection
  // ==========================================================================

  async function api(path, options = {}) {
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    try {
      const res = await fetch(path, config);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }
      return data;
    } catch (err) {
      console.error(`[API Error] ${path}:`, err);
      throw err;
    }
  }

  // ==========================================================================
  // Helper: Modal Management
  // ==========================================================================

  function openModal(title, contentHtml) {
    if (!el.modal) return;
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = contentHtml;
    el.modal.showModal();
  }

  function closeModal() {
    if (!el.modal) return;
    el.modal.close();
    el.modalBody.innerHTML = '';
  }

  if (el.modalClose) {
    el.modalClose.addEventListener('click', closeModal);
  }

  if (el.modal) {
    el.modal.addEventListener('click', (e) => {
      if (e.target === el.modal) closeModal();
    });
  }

  // ==========================================================================
  // Authentication Lifecycle
  // ==========================================================================

  async function checkAuthSession() {
    try {
      const data = await api('/api/admin/auth/me');
      if (data && data.authenticated && data.user) {
        setAuthenticatedState(data.user);
        await refreshAllData();
      } else {
        setUnauthenticatedState();
      }
    } catch (_err) {
      setUnauthenticatedState();
    }
  }

  function setAuthenticatedState(user) {
    state.user = user;
    if (el.authGate) el.authGate.hidden = true;
    if (el.adminApp) el.adminApp.hidden = false;
    if (el.topbarUser) el.topbarUser.textContent = `USER: ${user.email}`;
  }

  function setUnauthenticatedState() {
    state.user = null;
    if (el.authGate) el.authGate.hidden = false;
    if (el.adminApp) el.adminApp.hidden = true;
  }

  if (el.loginForm) {
    el.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = el.loginEmail.value.trim();
      const password = el.loginPassword.value;
      if (!email || !password) return;

      el.loginSubmit.disabled = true;
      el.loginSubmit.textContent = 'AUTHENTICATING...';
      if (el.authError) el.authError.hidden = true;

      try {
        const res = await api('/api/admin/auth/login', {
          method: 'POST',
          body: { email, password }
        });
        showToast('Authentication successful', 'success');
        setAuthenticatedState(res.user);
        await refreshAllData();
      } catch (err) {
        if (el.authError) {
          el.authError.textContent = err.message || 'Authentication failed. Please check credentials.';
          el.authError.hidden = false;
        }
        showToast(err.message, 'error');
      } finally {
        el.loginSubmit.disabled = false;
        el.loginSubmit.textContent = 'AUTHENTICATE SESSION →';
      }
    });
  }

  if (el.btnLogout) {
    el.btnLogout.addEventListener('click', async () => {
      try {
        await api('/api/admin/auth/logout', { method: 'POST' });
        showToast('Logged out successfully', 'info');
      } catch (_err) {
        // Continue logout anyway
      } finally {
        setUnauthenticatedState();
      }
    });
  }

  // ==========================================================================
  // Tab Navigation & Mobile Sidebar
  // ==========================================================================

  function switchTab(tabId) {
    state.activeTab = tabId;
    el.navItems.forEach((btn) => {
      const match = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', match);
    });

    el.panes.forEach((pane) => {
      const match = pane.id === `pane-${tabId}`;
      pane.classList.toggle('active', match);
    });

    if (window.innerWidth <= 768 && el.sidebar) {
      el.sidebar.classList.remove('open');
    }
  }

  el.navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });

  // Handle cross-tab action links (e.g., "VIEW COMPLETE AUDIT TRAIL →")
  document.querySelectorAll('button[data-tab]').forEach((btn) => {
    if (!btn.classList.contains('nav-item')) {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) switchTab(tab);
      });
    }
  });

  if (el.sidebarToggle && el.sidebar) {
    el.sidebarToggle.addEventListener('click', () => {
      el.sidebar.classList.toggle('open');
    });
  }

  // ==========================================================================
  // Data Fetching & State Refresh
  // ==========================================================================

  async function refreshAllData() {
    if (state.isLoading) return;
    state.isLoading = true;
    if (el.btnRefreshData) el.btnRefreshData.textContent = '↻ LOADING...';

    try {
      const [preview, audit] = await Promise.all([
        api('/api/admin/content/preview').catch((e) => {
          console.warn('Failed preview fetch:', e);
          return null;
        }),
        api('/api/admin/audit-logs').catch((e) => {
          console.warn('Failed audit fetch:', e);
          return null;
        })
      ]);

      if (preview) {
        const previewData = preview.preview ? { ...preview, ...preview.preview } : preview;
        const allSkills = previewData.skills || [];
        if (previewData.skill_categories) {
          previewData.skill_categories.forEach(cat => {
            cat.skills = allSkills.filter(s => s.category_entity_id === cat.entity_id || s.category_id === cat.entity_id);
          });
        }
        state.preview = previewData;
      }
      if (audit) state.audit = audit;

      renderAllViews();
      showToast('Dashboard data synchronized', 'info');
    } catch (err) {
      showToast(`Error refreshing data: ${err.message}`, 'error');
    } finally {
      state.isLoading = false;
      if (el.btnRefreshData) el.btnRefreshData.textContent = '↻ REFRESH DATA';
    }
  }

  if (el.btnRefreshData) {
    el.btnRefreshData.addEventListener('click', refreshAllData);
  }

  // ==========================================================================
  // View Rendering
  // ==========================================================================

  function renderAllViews() {
    renderTelemetry();
    renderProjects();
    renderSkills();
    renderExperience();
    renderCertifications();
    renderMedia();
    renderSettings();
    renderAuditAndSnapshots();
  }

  // Status badge pill generator
  function renderStatusPill(status, isTombstone = false) {
    if (isTombstone) return '<span class="status-pill tombstone">TOMBSTONE</span>';
    if (status === 'published') return '<span class="status-pill published">PUBLISHED</span>';
    if (status === 'draft') return '<span class="status-pill draft">DRAFT</span>';
    return `<span class="status-pill archived">${escapeHtml(status || 'archived')}</span>`;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 1. Telemetry View
  function renderTelemetry() {
    const p = state.preview;
    if (!p) return;

    const liveVer = p.current_version != null ? p.current_version : (p.liveVersion != null ? p.liveVersion : 1);
    const drafts = p.pending_drafts_count != null ? p.pending_drafts_count : (p.totalDrafts != null ? p.totalDrafts : 0);
    const projectsCount = (p.projects || []).filter((x) => x.status === 'published' && !x.is_tombstone).length;
    const mediaCount = (p.media_assets || []).length;

    if (el.statLiveVersion) el.statLiveVersion.textContent = liveVer;
    if (el.topbarVersion) el.topbarVersion.textContent = `VER: ${liveVer}`;
    if (el.statPendingDrafts) el.statPendingDrafts.textContent = drafts;
    if (el.sidebarDraftCount) el.sidebarDraftCount.textContent = drafts;
    if (el.sidebarDraftProgress) {
      const pct = Math.min(100, drafts * 20);
      el.sidebarDraftProgress.style.width = `${pct}%`;
    }
    if (el.statActiveProjects) el.statActiveProjects.textContent = projectsCount;
    if (el.statMediaCount) el.statMediaCount.textContent = mediaCount;

    // Recent audit events in telemetry pane
    if (el.tableRecentAudit && state.audit) {
      const logs = (state.audit.logs || state.audit.audit_logs || []).slice(0, 5);
      if (logs.length === 0) {
        el.tableRecentAudit.innerHTML = '<tr><td colspan="5" class="empty-cell">No recent events recorded.</td></tr>';
      } else {
        el.tableRecentAudit.innerHTML = logs.map((log) => {
          const timestamp = log.created_at || log.performed_at;
          const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : '—';
          return `
          <tr>
            <td class="mono">${timeStr}</td>
            <td class="mono"><strong>${escapeHtml(log.action)}</strong></td>
            <td class="mono">${escapeHtml(log.entity_type)}</td>
            <td class="mono">${escapeHtml(log.ip_address || '—')}</td>
            <td>${escapeHtml(JSON.stringify(log.details || {}).slice(0, 48))}...</td>
          </tr>
        `;
        }).join('');
      }
    }
  }

  // 2. Projects View
  function renderProjects() {
    if (!el.tableProjects || !state.preview) return;
    const projects = state.preview.projects || [];

    if (projects.length === 0) {
      el.tableProjects.innerHTML = '<tr><td colspan="6" class="empty-cell">No projects found. Create one below.</td></tr>';
      return;
    }

    el.tableProjects.innerHTML = projects.map((prj) => {
      const sortOrder = prj.display_order !== undefined ? prj.display_order : (prj.sort_order !== undefined ? prj.sort_order : 0);
      return `
      <tr data-entity-id="${escapeHtml(prj.entity_id)}">
        <td class="mono">${sortOrder}</td>
        <td class="mono"><code>${escapeHtml(prj.slug)}</code></td>
        <td>
          <strong>${escapeHtml(prj.title)}</strong>
          <small class="mono d-block text-muted">${escapeHtml(prj.category)}</small>
        </td>
        <td>${renderStatusPill(prj.status, prj.is_tombstone)}</td>
        <td class="mono">v${escapeHtml(prj.version)}</td>
        <td class="text-right">
          <div class="row-actions">
            <button class="admin-btn admin-btn-sm btn-edit-project" data-id="${escapeHtml(prj.entity_id)}">EDIT</button>
            <button class="admin-btn admin-btn-sm admin-btn-danger btn-delete-project" data-id="${escapeHtml(prj.entity_id)}">TOMBSTONE</button>
          </div>
        </td>
      </tr>
    `;
    }).join('');

    // Attach row listeners
    el.tableProjects.querySelectorAll('.btn-edit-project').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const item = projects.find((p) => p.entity_id === id);
        if (item) openProjectModal(item);
      });
    });

    el.tableProjects.querySelectorAll('.btn-delete-project').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const item = projects.find((p) => p.entity_id === id);
        if (!item) return;
        if (!confirm(`Create tombstone deletion draft for project "${item.title}"?`)) return;

        try {
          await api(`/api/admin/projects/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            body: { entity_id: id }
          });
          showToast(`Tombstone draft created for ${item.title}`, 'info');
          await refreshAllData();
        } catch (err) {
          showToast(`Error deleting project: ${err.message}`, 'error');
        }
      });
    });
  }

  function openProjectModal(existing = null) {
    const isEdit = !!existing;
    const title = isEdit ? `Edit Project Draft: ${existing.title}` : 'Create New Project Draft';

    const currentSummary = existing?.summary || existing?.short_description || existing?.description || '';
    const currentTags = Array.isArray(existing?.tags)
      ? existing.tags.join(', ')
      : (Array.isArray(existing?.tech_stack)
          ? existing.tech_stack.join(', ')
          : (typeof existing?.tags === 'string'
              ? existing.tags
              : (typeof existing?.tech_stack === 'string' ? existing.tech_stack : '')));
    const currentRepo = existing?.repo_url || existing?.github_url || '';
    const currentDemo = existing?.demo_url || existing?.live_url || '';
    const currentOrder = existing?.display_order !== undefined ? existing.display_order : (existing?.sort_order !== undefined ? existing.sort_order : 0);
    const currentProjNumber = existing?.project_number || '';

    const formHtml = `
      <form id="modal-project-form" class="modal-form">
        <input type="hidden" name="entity_id" value="${escapeHtml(existing ? existing.entity_id : '')}">
        <input type="hidden" name="project_number" value="${escapeHtml(currentProjNumber)}">
        <div class="form-group">
          <label class="mono">PROJECT TITLE</label>
          <input type="text" name="title" required value="${escapeHtml(existing?.title || '')}">
        </div>
        <div class="form-group">
          <label class="mono">SLUG (URL KEY)</label>
          <input type="text" name="slug" required value="${escapeHtml(existing?.slug || '')}">
        </div>
        <div class="form-group">
          <label class="mono">CATEGORY</label>
          <input type="text" name="category" required value="${escapeHtml(existing?.category || 'AI Systems / Architecture')}">
        </div>
        <div class="form-group">
          <label class="mono">SHORT DESCRIPTION</label>
          <textarea name="short_description" rows="2" required placeholder="Project summary / description">${escapeHtml(currentSummary)}</textarea>
        </div>
        <div class="form-group">
          <label class="mono">TECH STACK (COMMA-SEPARATED)</label>
          <input type="text" name="tech_stack" value="${escapeHtml(currentTags)}" placeholder="e.g. PYTHON, FASTAPI, POSTGRESQL">
        </div>
        <div class="form-group">
          <label class="mono">REPOSITORY URL</label>
          <input type="url" name="repo_url" value="${escapeHtml(currentRepo)}">
        </div>
        <div class="form-group">
          <label class="mono">LIVE DEMO URL</label>
          <input type="url" name="live_url" value="${escapeHtml(currentDemo)}">
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="mono">SORT ORDER</label>
            <input type="number" name="sort_order" value="${currentOrder}">
          </div>
          <div class="form-group">
            <label class="mono">LAYOUT</label>
            <label class="form-check-label">
              <input type="checkbox" name="is_wide" ${existing?.is_wide ? 'checked' : ''}> Full Width Card
            </label>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="admin-btn" id="modal-cancel">CANCEL</button>
          <button type="submit" class="admin-btn admin-btn-primary">SAVE DRAFT</button>
        </div>
      </form>
    `;

    openModal(title, formHtml);

    const form = document.getElementById('modal-project-form');
    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const rawShortDesc = fd.get('short_description') || '';
      const rawTechStack = fd.get('tech_stack') || '';
      const tagsArray = rawTechStack.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const sortOrderVal = parseInt(fd.get('sort_order'), 10) || 0;
      const repoUrlVal = (fd.get('repo_url') || '').trim() || null;
      const liveUrlVal = (fd.get('live_url') || '').trim() || null;
      const cleanSummary = String(rawShortDesc).trim();

      const payload = {
        title: String(fd.get('title') || '').trim(),
        slug: String(fd.get('slug') || '').trim(),
        category: String(fd.get('category') || '').trim(),
        project_number: fd.get('project_number') || null,
        summary: cleanSummary,
        short_description: cleanSummary,
        description: cleanSummary,
        tags: tagsArray,
        tech_stack: tagsArray,
        repo_url: repoUrlVal,
        github_url: repoUrlVal,
        demo_url: liveUrlVal,
        live_url: liveUrlVal,
        display_order: sortOrderVal,
        sort_order: sortOrderVal,
        is_wide: fd.get('is_wide') === 'on'
      };

      try {
        if (isEdit) {
          const entityId = fd.get('entity_id');
          await api(`/api/admin/projects/${encodeURIComponent(entityId)}`, {
            method: 'PUT',
            body: { entity_id: entityId, ...payload }
          });
          showToast('Project draft updated', 'success');
        } else {
          await api('/api/admin/projects', {
            method: 'POST',
            body: payload
          });
          showToast('Project draft created', 'success');
        }
        closeModal();
        await refreshAllData();
      } catch (err) {
        showToast(`Failed to save project draft: ${err.message}`, 'error');
      }
    });
  }

  if (el.btnNewProject) {
    el.btnNewProject.addEventListener('click', () => openProjectModal(null));
  }

  // 3. Skills View
  function renderSkills() {
    if (!el.skillsContainer || !state.preview) return;
    const categories = state.preview.skill_categories || [];

    if (categories.length === 0) {
      el.skillsContainer.innerHTML = '<p class="empty-cell">No skill categories configured.</p>';
      return;
    }

    el.skillsContainer.innerHTML = categories.map((cat) => {
      const skills = cat.skills || [];
      return `
        <div class="category-card" data-cat-id="${escapeHtml(cat.entity_id)}">
          <div class="category-head">
            <div class="category-title">${escapeHtml(cat.name)}</div>
            <div class="category-order mono">ORDER: ${parseInt(cat.sort_order, 10) || 0}</div>
          </div>
          <div class="skill-chips">
            ${skills.map((sk) => `
              <span class="skill-chip ${sk.status === 'draft' ? 'draft' : ''}">
                ${escapeHtml(sk.name)}
                <button class="skill-chip-delete" data-skill-id="${escapeHtml(sk.entity_id)}" title="Delete skill draft">✕</button>
              </span>
            `).join('')}
            ${skills.length === 0 ? '<span class="mono text-muted">No skills in category</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    // Attach skill chip delete handlers
    el.skillsContainer.querySelectorAll('.skill-chip-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const skillId = btn.getAttribute('data-skill-id');
        if (!confirm('Tombstone this skill draft?')) return;
        try {
          await api('/api/admin/skills', {
            method: 'DELETE',
            body: { entity_id: skillId }
          });
          showToast('Skill draft tombstoned', 'info');
          await refreshAllData();
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error');
        }
      });
    });
  }

  if (el.btnNewCategory) {
    el.btnNewCategory.addEventListener('click', () => {
      const formHtml = `
        <form id="modal-cat-form" class="modal-form">
          <div class="form-group">
            <label class="mono">CATEGORY NAME</label>
            <input type="text" name="name" required placeholder="e.g. Systems & Cloud Infrastructure">
          </div>
          <div class="form-group">
            <label class="mono">SLUG IDENTIFIER</label>
            <input type="text" name="slug" required placeholder="systems-cloud">
          </div>
          <div class="form-group">
            <label class="mono">SORT ORDER</label>
            <input type="number" name="sort_order" value="10">
          </div>
          <div class="modal-actions">
            <button type="button" class="admin-btn" id="modal-cancel">CANCEL</button>
            <button type="submit" class="admin-btn admin-btn-primary">CREATE CATEGORY</button>
          </div>
        </form>
      `;
      openModal('New Skill Category', formHtml);
      document.getElementById('modal-cancel').addEventListener('click', closeModal);
      document.getElementById('modal-cat-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('/api/admin/skills', {
            method: 'POST',
            body: {
              type: 'category',
              name: fd.get('name'),
              slug: fd.get('slug'),
              sort_order: parseInt(fd.get('sort_order'), 10) || 0
            }
          });
          showToast('Category draft created', 'success');
          closeModal();
          await refreshAllData();
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error');
        }
      });
    });
  }

  if (el.btnNewSkill) {
    el.btnNewSkill.addEventListener('click', () => {
      const categories = state.preview?.skill_categories || [];
      const catOptions = categories.map((c) => `<option value="${escapeHtml(c.entity_id)}">${escapeHtml(c.name)}</option>`).join('');

      const formHtml = `
        <form id="modal-skill-form" class="modal-form">
          <div class="form-group">
            <label class="mono">PARENT CATEGORY</label>
            <select name="category_id" required>${catOptions}</select>
          </div>
          <div class="form-group">
            <label class="mono">SKILL NAME</label>
            <input type="text" name="name" required placeholder="e.g. Rust, Docker, Kubernetes">
          </div>
          <div class="form-group">
            <label class="mono">SORT ORDER</label>
            <input type="number" name="sort_order" value="10">
          </div>
          <div class="modal-actions">
            <button type="button" class="admin-btn" id="modal-cancel">CANCEL</button>
            <button type="submit" class="admin-btn admin-btn-primary">ADD SKILL DRAFT</button>
          </div>
        </form>
      `;
      openModal('Add Skill Draft', formHtml);
      document.getElementById('modal-cancel').addEventListener('click', closeModal);
      document.getElementById('modal-skill-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('/api/admin/skills', {
            method: 'POST',
            body: {
              type: 'skill',
              category_id: fd.get('category_id'),
              name: fd.get('name'),
              sort_order: parseInt(fd.get('sort_order'), 10) || 0
            }
          });
          showToast('Skill draft added', 'success');
          closeModal();
          await refreshAllData();
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error');
        }
      });
    });
  }

  // 4. Experience View
  function renderExperience() {
    if (!el.experienceContainer || !state.preview) return;
    const experiences = state.preview.experiences || [];

    if (experiences.length === 0) {
      el.experienceContainer.innerHTML = '<p class="empty-cell">No experience records found.</p>';
      return;
    }

    el.experienceContainer.innerHTML = experiences.map((exp) => `
      <div class="experience-card" data-exp-id="${escapeHtml(exp.entity_id)}">
        <div class="experience-symbol">${escapeHtml(exp.symbol_mark || exp.symbol || '◈')}</div>
        <div>
          <h4>${escapeHtml(exp.role_title || exp.role)}</h4>
          <div class="experience-company mono">${escapeHtml(exp.company)}</div>
          <p class="experience-desc">${escapeHtml(exp.description)}</p>
          ${exp.certificate_url ? `
            <div class="mt-8" style="display: flex; align-items: center; gap: 8px;">
              <span class="mono" style="font-size: 9px; color: var(--admin-red); border: 1px solid var(--admin-red); padding: 2px 5px; border-radius: 2px; font-weight: 600;">CERTIFICATE</span>
              <a href="${escapeHtml(exp.certificate_url)}" target="_blank" rel="noopener noreferrer" class="mono text-muted" style="font-size: 10px;">${escapeHtml(exp.certificate_filename || 'View Attached Certificate')} ↗</a>
            </div>
          ` : ''}
        </div>
        <div class="experience-meta">
          ${renderStatusPill(exp.status, exp.is_tombstone)}
          <span class="mono text-muted">${escapeHtml(exp.period_label || (exp.start_date ? `${exp.start_date} — ${exp.is_current ? 'PRESENT' : (exp.end_date || '')}` : ''))}</span>
          <div class="row-actions mt-8" style="display: flex; gap: 8px;">
            <button class="admin-btn admin-btn-sm btn-edit-exp" data-id="${escapeHtml(exp.entity_id)}">EDIT</button>
            <button class="admin-btn admin-btn-sm admin-btn-danger btn-delete-exp" data-id="${escapeHtml(exp.entity_id)}">TOMBSTONE</button>
          </div>
        </div>
      </div>
    `).join('');

    el.experienceContainer.querySelectorAll('.btn-edit-exp').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const targetExp = experiences.find(e => e.entity_id === id);
        if (targetExp) openExperienceModal(targetExp);
      });
    });

    el.experienceContainer.querySelectorAll('.btn-delete-exp').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!confirm('Create tombstone draft for this experience entry?')) return;
        try {
          await api('/api/admin/experience', {
            method: 'DELETE',
            body: { entity_id: id }
          });
          showToast('Experience draft tombstoned', 'info');
          await refreshAllData();
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error');
        }
      });
    });
  }

  function openExperienceModal(existing) {
    const isEdit = !!existing;
    const title = isEdit ? 'Edit Experience Draft' : 'New Experience Draft';
    const roleTitle = existing?.role_title || existing?.role || '';
    const company = existing?.company || '';
    const symbolMark = existing?.symbol_mark || existing?.symbol || '✳';
    const description = existing?.description || '';
    const periodLabel = existing?.period_label || '';
    const certUrl = existing?.certificate_url || '';
    const certFilename = existing?.certificate_filename || '';
    const isPdf = certUrl.toLowerCase().endsWith('.pdf') || certFilename.toLowerCase().endsWith('.pdf');

    const formHtml = `
      <form id="modal-exp-form" class="modal-form">
        <input type="hidden" name="entity_id" value="${escapeHtml(existing?.entity_id || '')}">
        <input type="hidden" name="certificate_url" id="modal-exp-cert-val" value="${escapeHtml(certUrl)}">
        <input type="hidden" name="certificate_filename" id="modal-exp-cert-fn" value="${escapeHtml(certFilename)}">

        <div class="form-group">
          <label class="mono">COMPANY / INSTITUTION</label>
          <input type="text" name="company" required value="${escapeHtml(company)}" placeholder="e.g. MANIPAL TECHNOLOGIES LTD">
        </div>
        <div class="form-group">
          <label class="mono">ROLE TITLE</label>
          <input type="text" name="role_title" required value="${escapeHtml(roleTitle)}" placeholder="e.g. Intern">
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="mono">SYMBOL MARK</label>
            <input type="text" name="symbol_mark" value="${escapeHtml(symbolMark)}" maxlength="4">
          </div>
          <div class="form-group">
            <label class="mono">PERIOD / DATE LABEL</label>
            <input type="text" name="period_label" required value="${escapeHtml(periodLabel || 'PROFESSIONAL EXPERIENCE')}" placeholder="e.g. PROFESSIONAL EXPERIENCE">
          </div>
        </div>
        <div class="form-group">
          <label class="mono">DESCRIPTION</label>
          <textarea name="description" rows="3" required placeholder="Detail key responsibilities, deliverables, and outcomes...">${escapeHtml(description)}</textarea>
        </div>

        <div class="form-group">
          <label class="mono">EXPERIENCE CERTIFICATE / ATTACHMENT (OPTIONAL)</label>
          <div id="exp-cert-preview-area" style="margin-bottom: 8px;">
            ${certUrl ? `
              <div id="exp-cert-card" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px; border: 1px solid var(--admin-line); border-radius: 4px; background: rgba(255,255,255,0.02);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  ${isPdf ? `
                    <div style="width: 44px; height: 36px; background: rgba(237,64,46,0.15); border: 1px solid var(--admin-red); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--admin-red); letter-spacing: 0.05em;">PDF</div>
                  ` : `
                    <img src="${escapeHtml(certUrl)}" alt="Certificate preview" style="max-height: 44px; max-width: 64px; border-radius: 2px; object-fit: contain; border: 1px solid var(--admin-line);">
                  `}
                  <div>
                    <span class="mono d-block" style="font-size: 11px; font-weight: 600;">${escapeHtml(certFilename || 'Attached Certificate')}</span>
                    <a href="${escapeHtml(certUrl)}" target="_blank" rel="noopener noreferrer" class="mono text-muted" style="font-size: 10px; color: var(--admin-red);">View Document ↗</a>
                  </div>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button type="button" class="admin-btn admin-btn-sm" id="btn-replace-exp-cert">REPLACE</button>
                  <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" id="btn-remove-exp-cert">REMOVE</button>
                </div>
              </div>
            ` : `
              <div id="exp-cert-placeholder" class="mono text-muted" style="font-size: 11px; padding: 8px; border: 1px dashed var(--admin-line); border-radius: 4px; text-align: center;">No certificate attached.</div>
            `}
          </div>

          <input type="file" id="exp-cert-file-input" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" style="display:none;">
          <div id="exp-cert-dropzone" class="media-dropzone" style="cursor: pointer; padding: 12px; border: 1px dashed var(--admin-line); border-radius: 4px; text-align: center; transition: border-color .2s; background: rgba(255,255,255,0.01);">
            <span id="exp-cert-dropzone-label" class="mono text-muted" style="font-size: 10px;">CLICK OR DRAG FILE TO ATTACH (PDF, PNG, JPG, WEBP — MAX 5MB)</span>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="admin-btn" id="modal-cancel">CANCEL</button>
          <button type="submit" class="admin-btn admin-btn-primary">${isEdit ? 'SAVE EXPERIENCE DRAFT' : 'CREATE EXPERIENCE DRAFT'}</button>
        </div>
      </form>
    `;

    openModal(title, formHtml);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    const form = document.getElementById('modal-exp-form');
    const certValInput = document.getElementById('modal-exp-cert-val');
    const certFnInput = document.getElementById('modal-exp-cert-fn');
    const previewArea = document.getElementById('exp-cert-preview-area');
    const dropzone = document.getElementById('exp-cert-dropzone');
    const dropzoneLabel = document.getElementById('exp-cert-dropzone-label');
    const fileInput = document.getElementById('exp-cert-file-input');

    function wireRemoveButton() {
      const btnRemove = document.getElementById('btn-remove-exp-cert');
      if (btnRemove) {
        btnRemove.addEventListener('click', () => {
          certValInput.value = '';
          certFnInput.value = '';
          previewArea.innerHTML = '<div id="exp-cert-placeholder" class="mono text-muted" style="font-size: 11px; padding: 8px; border: 1px dashed var(--admin-line); border-radius: 4px; text-align: center;">No certificate attached.</div>';
          showToast('Certificate removed from draft', 'info');
        });
      }
      const btnReplace = document.getElementById('btn-replace-exp-cert');
      if (btnReplace) {
        btnReplace.addEventListener('click', () => {
          fileInput.click();
        });
      }
    }
    wireRemoveButton();

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropzone.style.borderColor = 'var(--admin-red)';
        });
      });

      ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropzone.style.borderColor = 'var(--admin-line)';
        });
      });

      const handleExpFile = (file) => {
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          showToast('File exceeds 5MB size limit', 'error');
          return;
        }

        const ext = file.name.split('.').pop().toLowerCase();
        const allowedExts = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
        if (!allowedExts.includes(ext)) {
          showToast('Unsupported file type. Use PDF, PNG, JPG, or WebP.', 'error');
          return;
        }

        const reader = new FileReader();
        dropzoneLabel.textContent = 'UPLOADING TO SECURE STORAGE...';
        reader.onload = async () => {
          try {
            const base64Data = reader.result.split(',')[1];
            const uploadRes = await api('/api/admin/media/upload', {
              method: 'POST',
              body: {
                filename: file.name,
                content_type: file.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg'),
                data_base64: base64Data,
                purpose: 'experience_certificate'
              }
            });

            const mediaEntityId = uploadRes?.media?.entity_id;
            const assetUrl = mediaEntityId ? `/api/public/media/${mediaEntityId}` : reader.result;
            certValInput.value = assetUrl;
            certFnInput.value = file.name;

            const fileIsPdf = ext === 'pdf' || (file.type && file.type.includes('pdf'));
            previewArea.innerHTML = `
              <div id="exp-cert-card" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px; border: 1px solid var(--admin-line); border-radius: 4px; background: rgba(255,255,255,0.02);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  ${fileIsPdf ? `
                    <div style="width: 44px; height: 36px; background: rgba(237,64,46,0.15); border: 1px solid var(--admin-red); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--admin-red); letter-spacing: 0.05em;">PDF</div>
                  ` : `
                    <img src="${escapeHtml(assetUrl)}" alt="Certificate preview" style="max-height: 44px; max-width: 64px; border-radius: 2px; object-fit: contain; border: 1px solid var(--admin-line);">
                  `}
                  <div>
                    <span class="mono d-block" style="font-size: 11px; font-weight: 600;">Uploaded: ${escapeHtml(file.name)}</span>
                    <small class="mono text-muted" style="font-size: 9px;">Stored securely in portfolio-storage</small>
                  </div>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button type="button" class="admin-btn admin-btn-sm" id="btn-replace-exp-cert">REPLACE</button>
                  <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" id="btn-remove-exp-cert">REMOVE</button>
                </div>
              </div>
            `;
            wireRemoveButton();
            showToast('Certificate uploaded successfully', 'success');
          } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
          } finally {
            dropzoneLabel.textContent = 'CLICK OR DRAG FILE TO ATTACH (PDF, PNG, JPG, WEBP — MAX 5MB)';
          }
        };
        reader.readAsDataURL(file);
      };

      fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) handleExpFile(fileInput.files[0]);
      });

      dropzone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          handleExpFile(e.dataTransfer.files[0]);
        }
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const entityId = fd.get('entity_id');
      const payload = {
        entity_id: entityId || undefined,
        company: String(fd.get('company') || '').trim(),
        role_title: String(fd.get('role_title') || '').trim(),
        symbol_mark: String(fd.get('symbol_mark') || '✳').trim(),
        period_label: String(fd.get('period_label') || '').trim(),
        description: String(fd.get('description') || '').trim(),
        certificate_url: fd.get('certificate_url') ? String(fd.get('certificate_url')).trim() : null,
        certificate_filename: fd.get('certificate_filename') ? String(fd.get('certificate_filename')).trim() : null,
        sort_order: 10
      };

      try {
        if (isEdit && entityId) {
          await api('/api/admin/experience', {
            method: 'PUT',
            body: payload
          });
          showToast('Experience draft updated successfully', 'success');
        } else {
          await api('/api/admin/experience', {
            method: 'POST',
            body: payload
          });
          showToast('Experience draft created successfully', 'success');
        }
        closeModal();
        await refreshAllData();
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      }
    });
  }

  if (el.btnNewExperience) {
    el.btnNewExperience.addEventListener('click', () => {
      openExperienceModal(null);
    });
  }

  // 5. Certifications View
  function renderCertifications() {
    if (!el.tableCertifications || !state.preview) return;
    const certs = state.preview.certifications || [];

    if (certs.length === 0) {
      el.tableCertifications.innerHTML = '<tr><td colspan="5" class="empty-cell">No certifications recorded.</td></tr>';
      return;
    }

    el.tableCertifications.innerHTML = certs.map((c) => {
      const order = parseInt(c.display_order ?? c.sort_order, 10) || 0;
      const mark = c.mark || c.mark_symbol || '✳';
      const hasImg = !!c.certificate_image_url;
      const dateStr = c.date ? ` · <span class="mono">${escapeHtml(c.date)}</span>` : '';
      const linkStr = c.credential_url ? ` · <a href="${escapeHtml(c.credential_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--admin-red)">LINK ↗</a>` : '';

      return `
        <tr data-cert-id="${escapeHtml(c.entity_id)}">
          <td class="mono">${order}</td>
          <td class="cert-mark-cell">${escapeHtml(mark)}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
              ${hasImg ? `
                <a href="${escapeHtml(c.certificate_image_url)}" target="_blank" rel="noopener noreferrer" title="View certificate image" class="cert-thumb-box">
                  <img src="${escapeHtml(c.certificate_image_url)}" alt="Certificate Thumbnail" class="cert-thumb-img">
                </a>
              ` : `
                <div class="cert-thumb-box" style="border-style: dashed; font-size: 8px; color: var(--admin-muted);" title="No certificate image attached">NO IMG</div>
              `}
              <div style="min-width: 0;">
                <strong>${escapeHtml(c.title)}</strong>
                <small class="mono d-block text-muted">${escapeHtml(c.issuer)}${dateStr}${linkStr}</small>
              </div>
            </div>
          </td>
          <td>${renderStatusPill(c.status, c.is_tombstone)}</td>
          <td class="text-right">
            <div class="row-actions">
              <button class="admin-btn admin-btn-sm btn-edit-cert" data-id="${escapeHtml(c.entity_id)}">EDIT</button>
              <button class="admin-btn admin-btn-sm admin-btn-danger btn-delete-cert" data-id="${escapeHtml(c.entity_id)}">TOMBSTONE</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach Edit handlers
    el.tableCertifications.querySelectorAll('.btn-edit-cert').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const item = certs.find((c) => c.entity_id === id);
        if (item) openCertificationModal(item);
      });
    });

    // Attach Tombstone handlers
    el.tableCertifications.querySelectorAll('.btn-delete-cert').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const item = certs.find((c) => c.entity_id === id);
        if (!confirm(`Tombstone certification "${item?.title || 'this certification'}"?`)) return;
        try {
          await api('/api/admin/certifications', {
            method: 'DELETE',
            body: { entity_id: id }
          });
          showToast('Certification draft tombstoned', 'info');
          await refreshAllData();
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error');
        }
      });
    });
  }

  function openCertificationModal(existing = null) {
    const isEdit = !!existing;
    const title = isEdit ? `Edit Certification Draft: ${existing.title}` : 'Add Certification Draft';

    // Defensive unpacking in case a raw record with fallback metadata JSON is provided
    let item = existing ? { ...existing } : {};
    if (typeof item.url === 'string' && item.url.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(item.url);
        item.credential_url = item.credential_url || parsed.credential_url || parsed.url || null;
        item.certificate_image_url = item.certificate_image_url || parsed.certificate_image_url || null;
        item.date = item.date || parsed.date || null;
      } catch {}
    }

    const currentImgUrl = (typeof item.certificate_image_url === 'string' && !item.certificate_image_url.trim().startsWith('{'))
      ? item.certificate_image_url.trim()
      : '';

    const currentDate = (typeof item.date === 'string' && !item.date.trim().startsWith('{'))
      ? item.date.trim()
      : '';

    // Requirement 2 & 5: Map credential_url exclusively to the Credential / Verification URL input.
    // Never serialize or allow metadata objects into the URL input.
    const rawCredUrl = item.credential_url ?? (item.url && !String(item.url).trim().startsWith('{') ? item.url : '');
    const currentCredUrl = (typeof rawCredUrl === 'string' && !rawCredUrl.trim().startsWith('{'))
      ? rawCredUrl.trim()
      : '';

    const formHtml = `
      <form id="modal-cert-form" class="modal-form">
        <input type="hidden" name="entity_id" value="${escapeHtml(existing ? existing.entity_id : '')}">
        <input type="hidden" name="certificate_image_url" id="modal-cert-img-val" value="${escapeHtml(currentImgUrl)}">
        <div class="form-group">
          <label class="mono">TITLE / COMPETITION</label>
          <input type="text" name="title" required value="${escapeHtml(existing?.title || '')}" placeholder="e.g. 6-Day AI Workshop">
        </div>
        <div class="form-group">
          <label class="mono">ISSUING BODY</label>
          <input type="text" name="issuer" required value="${escapeHtml(existing?.issuer || '')}" placeholder="e.g. L&T">
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="mono">DATE / PERIOD</label>
            <input type="text" name="date" value="${escapeHtml(currentDate)}" placeholder="e.g. JAN 2024">
          </div>
          <div class="form-group">
            <label class="mono">MARK SYMBOL</label>
            <input type="text" name="mark_symbol" value="${escapeHtml(existing?.mark || existing?.mark_symbol || '✳')}" maxlength="2">
          </div>
        </div>
        <div class="form-group">
          <label class="mono">CREDENTIAL / VERIFICATION URL</label>
          <input type="url" name="credential_url" value="${escapeHtml(currentCredUrl)}" placeholder="https://...">
        </div>
        <div class="form-group">
          <label class="mono">CERTIFICATE IMAGE</label>
          <div id="modal-cert-img-container" style="margin-bottom: 8px;">
            ${currentImgUrl ? `
              <div id="cert-img-card" class="cert-preview-card">
                <div class="cert-preview-wrap">
                  <img src="${escapeHtml(currentImgUrl)}" alt="Certificate preview" id="cert-img-preview" class="cert-preview-img">
                </div>
                <div class="cert-preview-meta">
                  <div class="cert-preview-info">
                    <span class="mono cert-preview-title">Image Attached</span>
                    <small class="mono text-muted">Ready for static build bundling</small>
                  </div>
                  <div class="cert-preview-actions">
                    <a href="${escapeHtml(currentImgUrl)}" target="_blank" rel="noopener noreferrer" class="admin-btn admin-btn-sm" style="text-decoration:none;">VIEW FULL ↗</a>
                    <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" id="btn-remove-cert-img">REMOVE</button>
                  </div>
                </div>
              </div>
            ` : `
              <div id="cert-img-placeholder" class="mono text-muted" style="font-size: 11px; padding: 8px; border: 1px dashed var(--admin-line); border-radius: 4px; text-align: center;">
                No certificate image attached.
              </div>
            `}
          </div>
          <div class="media-dropzone" id="cert-dropzone" style="padding: 14px; text-align: center; border: 1px dashed var(--admin-line); border-radius: 4px; cursor: pointer; transition: border-color .2s;">
            <span class="mono" id="cert-dropzone-label" style="font-size: 11px;">CLICK OR DRAG IMAGE TO UPLOAD</span>
            <small class="mono d-block text-muted" style="margin-top: 4px;">JPEG, PNG, WebP up to 5MB</small>
            <input type="file" id="modal-cert-file" accept="image/jpeg,image/png,image/webp" style="display: none;">
          </div>
        </div>
        <div class="form-group">
          <label class="mono">SORT ORDER</label>
          <input type="number" name="sort_order" value="${existing?.display_order ?? existing?.sort_order ?? 10}">
        </div>
        <div class="modal-actions">
          <button type="button" class="admin-btn" id="modal-cancel">CANCEL</button>
          <button type="submit" class="admin-btn admin-btn-primary" id="btn-save-cert">${isEdit ? 'SAVE CHANGES' : 'ADD CERTIFICATION DRAFT'}</button>
        </div>
      </form>
    `;

    openModal(title, formHtml);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    const form = document.getElementById('modal-cert-form');
    const dropzone = document.getElementById('cert-dropzone');
    const fileInput = document.getElementById('modal-cert-file');
    const imgValInput = document.getElementById('modal-cert-img-val');
    const imgContainer = document.getElementById('modal-cert-img-container');
    const dropzoneLabel = document.getElementById('cert-dropzone-label');
    const removeBtn = document.getElementById('btn-remove-cert-img');

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        imgValInput.value = '';
        imgContainer.innerHTML = '<div id="cert-img-placeholder" class="mono text-muted" style="font-size: 11px; padding: 8px; border: 1px dashed var(--admin-line); border-radius: 4px; text-align: center;">No certificate image attached.</div>';
        showToast('Certificate image removed', 'info');
      });
    }

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropzone.style.borderColor = 'var(--admin-red)';
        });
      });

      ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          dropzone.style.borderColor = 'var(--admin-line)';
        });
      });

      const handleCertFile = (file) => {
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          showToast('Image exceeds 5MB size limit', 'error');
          return;
        }

        const reader = new FileReader();
        dropzoneLabel.textContent = 'UPLOADING TO SECURE STORAGE...';
        reader.onload = async () => {
          try {
            const base64Data = reader.result.split(',')[1];
            const uploadRes = await api('/api/admin/media/upload', {
              method: 'POST',
              body: {
                filename: file.name,
                content_type: file.type || 'image/jpeg',
                data_base64: base64Data,
                purpose: 'certification_image'
              }
            });

            const mediaEntityId = uploadRes?.media?.entity_id;
            const assetUrl = mediaEntityId ? `/api/public/media/${mediaEntityId}` : reader.result;
            imgValInput.value = assetUrl;

            imgContainer.innerHTML = `
              <div id="cert-img-card" class="cert-preview-card">
                <div class="cert-preview-wrap">
                  <img src="${escapeHtml(assetUrl)}" alt="Certificate preview" id="cert-img-preview" class="cert-preview-img">
                </div>
                <div class="cert-preview-meta">
                  <div class="cert-preview-info">
                    <span class="mono cert-preview-title">Uploaded: ${escapeHtml(file.name)}</span>
                    <small class="mono text-muted">Ready for static build bundling</small>
                  </div>
                  <div class="cert-preview-actions">
                    <a href="${escapeHtml(assetUrl)}" target="_blank" rel="noopener noreferrer" class="admin-btn admin-btn-sm" style="text-decoration:none;">VIEW FULL ↗</a>
                    <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" id="btn-remove-cert-img-dynamic">REMOVE</button>
                  </div>
                </div>
              </div>
            `;

            document.getElementById('btn-remove-cert-img-dynamic')?.addEventListener('click', () => {
              imgValInput.value = '';
              imgContainer.innerHTML = '<div id="cert-img-placeholder" class="mono text-muted" style="font-size: 11px; padding: 8px; border: 1px dashed var(--admin-line); border-radius: 4px; text-align: center;">No certificate image attached.</div>';
              showToast('Certificate image removed', 'info');
            });

            showToast('Certificate image uploaded successfully', 'success');
          } catch (err) {
            showToast(`Image upload failed: ${err.message}`, 'error');
          } finally {
            dropzoneLabel.textContent = 'CLICK OR DRAG IMAGE TO UPLOAD';
          }
        };
        reader.readAsDataURL(file);
      };

      fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) handleCertFile(fileInput.files[0]);
      });

      dropzone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          handleCertFile(e.dataTransfer.files[0]);
        }
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const entityId = fd.get('entity_id');

      const rawCred = fd.get('credential_url');
      const cleanCredUrl = (typeof rawCred === 'string' && rawCred.trim() && !rawCred.trim().startsWith('{'))
        ? rawCred.trim()
        : null;

      const rawDate = fd.get('date');
      const cleanDate = (typeof rawDate === 'string' && rawDate.trim() && !rawDate.trim().startsWith('{'))
        ? rawDate.trim()
        : null;

      const rawImg = imgValInput?.value || fd.get('certificate_image_url');
      const cleanImgUrl = (typeof rawImg === 'string' && rawImg.trim() && !rawImg.trim().startsWith('{'))
        ? rawImg.trim()
        : null;

      const payload = {
        title: String(fd.get('title') || '').trim(),
        issuer: String(fd.get('issuer') || '').trim(),
        date: cleanDate,
        mark_symbol: String(fd.get('mark_symbol') || '✳').trim(),
        credential_url: cleanCredUrl,
        certificate_image_url: cleanImgUrl,
        sort_order: parseInt(fd.get('sort_order'), 10) || 10
      };

      try {
        if (isEdit && entityId) {
          await api(`/api/admin/certifications/${encodeURIComponent(entityId)}`, {
            method: 'PUT',
            body: { entity_id: entityId, ...payload }
          });
          showToast('Certification draft updated', 'success');
        } else {
          await api('/api/admin/certifications', {
            method: 'POST',
            body: payload
          });
          showToast('Certification draft added', 'success');
        }
        closeModal();
        await refreshAllData();
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      }
    });
  }

  if (el.btnNewCertification) {
    el.btnNewCertification.addEventListener('click', () => openCertificationModal(null));
  }

  // 6. Media & Resume Dropzone View
  function renderMedia() {
    if (!el.tableMedia || !state.preview) return;
    const media = state.preview.media_assets || [];

    if (media.length === 0) {
      el.tableMedia.innerHTML = '<tr><td colspan="6" class="empty-cell">No assets stored. Drop files above.</td></tr>';
      return;
    }

    el.tableMedia.innerHTML = media.map((m) => `
      <tr data-media-id="${escapeHtml(m.entity_id)}">
        <td><strong>${escapeHtml(m.filename)}</strong></td>
        <td class="mono">${escapeHtml(m.mime_type)}</td>
        <td class="mono">${(m.size_bytes / 1024).toFixed(1)} KB</td>
        <td>${renderStatusPill(m.status, m.is_tombstone)}</td>
        <td class="mono"><code>${escapeHtml((m.sha256_hash || '').slice(0, 16))}...</code></td>
        <td class="text-right">
          <a href="/api/public/media/${encodeURIComponent(m.entity_id)}" target="_blank" class="admin-btn admin-btn-sm">PREVIEW</a>
        </td>
      </tr>
    `).join('');
  }

  function setupMediaDropzone() {
    if (!el.mediaDropzone || !el.mediaFileInput || !el.btnBrowseFile) return;

    el.btnBrowseFile.addEventListener('click', () => el.mediaFileInput.click());

    el.mediaFileInput.addEventListener('change', () => {
      if (el.mediaFileInput.files.length > 0) {
        handleMediaUpload(el.mediaFileInput.files[0]);
      }
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      el.mediaDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        el.mediaDropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((evt) => {
      el.mediaDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        el.mediaDropzone.classList.remove('dragover');
      });
    });

    el.mediaDropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        handleMediaUpload(e.dataTransfer.files[0]);
      }
    });
  }

  async function handleMediaUpload(file) {
    if (file.size > 5 * 1024 * 1024) {
      showToast('File exceeds 5MB maximum limit', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result.split(',')[1];
        showToast(`Uploading ${file.name} to private storage...`, 'info');
        await api('/api/admin/media/upload', {
          method: 'POST',
          body: {
            filename: file.name,
            content_type: file.type || 'application/octet-stream',
            data_base64: base64Data,
            purpose: file.type === 'application/pdf' ? 'resume' : 'portfolio_asset'
          }
        });
        showToast(`${file.name} uploaded and verified successfully`, 'success');
        await refreshAllData();
      } catch (err) {
        showToast(`Upload failed: ${err.message}`, 'error');
      }
    };
    reader.readAsDataURL(file);
  }

  // 7. Site Settings View
  function renderSettings() {
    if (!el.formSettings || !state.preview) return;
    const s = state.preview.settings || state.preview.site_settings || {};

    setInputValue('set-profile-name', s.profile_name || 'Pranav Shenoy');
    setInputValue('set-role-title', s.role_title || 'INFORMATION SCIENCE ENGINEER');
    setInputValue('set-eyebrow-bio', s.eyebrow_bio || s.eyebrow_greeting || "A LITTLE ABOUT ME");
    setInputValue('set-full-bio', s.full_bio || '');
    setInputValue('set-email', s.email || s.contact_email || 'nnm24is160@nmamit.in');
    setInputValue('set-github', s.github_url || 'https://github.com/PranavBShenoy');
    setInputValue('set-linkedin', s.linkedin_url || 'https://www.linkedin.com/in/pranav-shenoy-b54288312');
    setInputValue('set-cgpa', s.cgpa ?? 8.46);
    setInputValue('set-class12', s.class_12_pct ?? s.class_12_percentage ?? 92.0);
    setInputValue('set-class10', s.class_10_pct ?? s.class_10_percentage ?? 83.0);
  }

  function setInputValue(id, val) {
    const input = document.getElementById(id);
    if (input) input.value = val;
  }

  if (el.btnSaveSettings && el.formSettings) {
    el.btnSaveSettings.addEventListener('click', async () => {
      const payload = {
        profile_name: document.getElementById('set-profile-name')?.value,
        role_title: document.getElementById('set-role-title')?.value,
        eyebrow_bio: document.getElementById('set-eyebrow-bio')?.value,
        eyebrow_greeting: document.getElementById('set-eyebrow-bio')?.value,
        full_bio: document.getElementById('set-full-bio')?.value,
        email: document.getElementById('set-email')?.value,
        contact_email: document.getElementById('set-email')?.value,
        github_url: document.getElementById('set-github')?.value,
        linkedin_url: document.getElementById('set-linkedin')?.value,
        cgpa: parseFloat(document.getElementById('set-cgpa')?.value) || 0,
        class_12_pct: parseFloat(document.getElementById('set-class12')?.value) || 0,
        class_12_percentage: parseFloat(document.getElementById('set-class12')?.value) || 0,
        class_10_pct: parseFloat(document.getElementById('set-class10')?.value) || 0,
        class_10_percentage: parseFloat(document.getElementById('set-class10')?.value) || 0,
      };

      try {
        await api('/api/admin/settings', {
          method: 'PUT',
          body: payload
        });
        showToast('Site settings draft saved', 'success');
        await refreshAllData();
      } catch (err) {
        showToast(`Failed to save settings: ${err.message}`, 'error');
      }
    });
  }

  // 8. Audit & Snapshots View
  function renderAuditAndSnapshots() {
    if (!state.audit) return;

    // Snapshots
    if (el.tableSnapshots) {
      const snapshots = state.audit.snapshots || [];
      if (snapshots.length === 0) {
        el.tableSnapshots.innerHTML = '<tr><td colspan="5" class="empty-cell">No publication snapshots recorded.</td></tr>';
      } else {
        el.tableSnapshots.innerHTML = snapshots.map((s) => {
          const rawDate = s.created_at || s.published_at;
          const dateStr = rawDate ? new Date(rawDate).toLocaleString() : '—';
          return `
          <tr>
            <td class="mono"><strong>v${s.version}</strong></td>
            <td class="mono">${dateStr}</td>
            <td class="mono">${escapeHtml(s.published_by_email || 'ADMIN')}</td>
            <td>${escapeHtml(s.notes || 'Routine publication release')}</td>
            <td class="text-right">
              <button class="admin-btn admin-btn-sm admin-btn-danger btn-rollback" data-target-ver="${parseInt(s.version, 10)}">ROLLBACK</button>
            </td>
          </tr>
        `;
        }).join('');

        el.tableSnapshots.querySelectorAll('.btn-rollback').forEach((btn) => {
          btn.addEventListener('click', () => {
            const ver = parseInt(btn.getAttribute('data-target-ver'), 10);
            openRollbackModal(ver);
          });
        });
      }
    }

    // Full Audit Log
    if (el.tableFullAudit) {
      const logs = state.audit.logs || state.audit.audit_logs || [];
      if (logs.length === 0) {
        el.tableFullAudit.innerHTML = '<tr><td colspan="6" class="empty-cell">No audit entries found.</td></tr>';
      } else {
        el.tableFullAudit.innerHTML = logs.map((l) => {
          const rawDate = l.created_at || l.performed_at;
          const dateStr = rawDate ? new Date(rawDate).toLocaleString() : '—';
          return `
          <tr>
            <td class="mono">${dateStr}</td>
            <td class="mono"><strong>${escapeHtml(l.action)}</strong></td>
            <td class="mono">${escapeHtml(l.entity_type)}</td>
            <td class="mono"><code>${escapeHtml((l.entity_id || '—').slice(0, 8))}...</code></td>
            <td class="mono">${escapeHtml(l.ip_address || '—')}</td>
            <td><small class="mono">${escapeHtml(JSON.stringify(l.details || {}))}</small></td>
          </tr>
        `;
        }).join('');
      }
    }
  }

  // ==========================================================================
  // Publication & Rollback RPC Invocation
  // ==========================================================================

  if (el.btnPublishAll) {
    el.btnPublishAll.addEventListener('click', () => {
      const draftCount = state.preview?.pending_drafts_count || 0;
      if (draftCount === 0) {
        showToast('No pending draft changes to publish.', 'info');
        return;
      }

      const formHtml = `
        <form id="modal-publish-form" class="modal-form">
          <p class="modal-lead">
            You have <strong class="text-amber">${parseInt(draftCount, 10)} pending draft revisions</strong> waiting for release.
            Publishing will atomically snapshot current state, advance live version from 
            <strong class="text-paper">v${parseInt(state.preview.current_version, 10)}</strong> to 
            <strong class="text-green">v${parseInt(state.preview.current_version, 10) + 1}</strong>, and purge the public CDN cache.
          </p>
          <div class="form-group">
            <label class="mono">RELEASE NOTES / AUDIT SUMMARY</label>
            <input type="text" name="notes" required placeholder="e.g. Updated AI project architecture and certifications">
          </div>
          <div class="modal-actions">
            <button type="button" class="admin-btn" id="modal-cancel">CANCEL</button>
            <button type="submit" class="admin-btn admin-btn-primary">CONFIRM &amp; PUBLISH RELEASE ✳</button>
          </div>
        </form>
      `;

      openModal('Publish Portfolio Changes', formHtml);
      document.getElementById('modal-cancel').addEventListener('click', closeModal);
      document.getElementById('modal-publish-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const notes = fd.get('notes');

        try {
          showToast('Executing atomic publication RPC...', 'info');
          await api('/api/admin/publish', {
            method: 'POST',
            body: {
              expected_base_version: state.preview.current_version,
              notes
            }
          });
          showToast('Changes published successfully!', 'success');
          closeModal();
          await refreshAllData();
        } catch (err) {
          showToast(`Publishing failed: ${err.message}`, 'error');
        }
      });
    });
  }

  function openRollbackModal(targetVersion) {
    const formHtml = `
      <form id="modal-rollback-form" class="modal-form">
        <p class="modal-lead-danger">
          ⚠️ <strong>CRITICAL ROLLBACK OPERATION</strong><br>
          This will restore portfolio content state to snapshot <strong>v${parseInt(targetVersion, 10)}</strong>, 
          creating a new monotonically incremented release version (v${(parseInt(state.preview?.current_version, 10) || 1) + 1}).
        </p>
        <div class="form-group">
          <label class="mono">ROLLBACK REASON</label>
          <input type="text" name="reason" required placeholder="e.g. Reverting unvetted copy changes">
        </div>
        <div class="form-group">
          <label class="mono">CONFIRMATION: TYPE "ROLLBACK" BELOW</label>
          <input type="text" name="confirm_str" required placeholder="ROLLBACK">
        </div>
        <div class="modal-actions">
          <button type="button" class="admin-btn" id="modal-cancel">CANCEL</button>
          <button type="submit" class="admin-btn admin-btn-danger">EXECUTE ATOMIC ROLLBACK</button>
        </div>
      </form>
    `;

    openModal(`Rollback to Snapshot v${targetVersion}`, formHtml);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-rollback-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (fd.get('confirm_str') !== 'ROLLBACK') {
        showToast('Confirmation string did not match "ROLLBACK"', 'error');
        return;
      }

      try {
        showToast(`Executing rollback to v${targetVersion}...`, 'info');
        await api('/api/admin/publish/rollback', {
          method: 'POST',
          body: {
            target_version: targetVersion,
            expected_current_version: state.preview.current_version,
            reason: fd.get('reason')
          }
        });
        showToast(`Rollback to v${targetVersion} completed successfully!`, 'success');
        closeModal();
        await refreshAllData();
      } catch (err) {
        showToast(`Rollback failed: ${err.message}`, 'error');
      }
    });
  }

  // Preview Drafts Modal
  if (el.btnPreviewModal) {
    el.btnPreviewModal.addEventListener('click', () => {
      const p = state.preview;
      const jsonStr = JSON.stringify(p, null, 2);
      const contentHtml = `
        <div class="gap-12">
          <p class="modal-lead">
            Below is the aggregated preview payload merging all pending draft modifications over current published records.
          </p>
          <pre class="preview-code-block">${escapeHtml(jsonStr)}</pre>
          <div class="modal-actions">
            <button type="button" class="admin-btn admin-btn-primary" id="modal-cancel">CLOSE PREVIEW</button>
          </div>
        </div>
      `;
      openModal('Draft Over Published Content Preview', contentHtml);
      document.getElementById('modal-cancel').addEventListener('click', closeModal);
    });
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  function init() {
    setupMediaDropzone();
    checkAuthSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
