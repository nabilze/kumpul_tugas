let currentUser = JSON.parse(localStorage.getItem('kumpul_user') || 'null');
let tasks = [];
let schedules = [];
let materials = [];
let activeFilter = 'ALL';
let searchQuery = '';

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initAuth();
    initModalsAndForms();
    syncUserUI();
    updateClock();
    setInterval(updateClock, 1000);
    loadAllData();
});

// ==========================================
// 1. NAVIGASI HALAMAN
// ==========================================
function initNavigation() {
    document.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-page]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetId = btn.dataset.page;
            document.querySelectorAll('.page-view').forEach(p => p.hidden = true);
            document.getElementById(targetId).hidden = false;

            const labels = {
                'page-tasks': 'Tugas & Penilaian',
                'page-schedule': 'Jadwal Harian',
                'page-materials': 'Materi Kuliah'
            };
            document.getElementById('currentBreadcrumb').textContent = labels[targetId] || 'Beranda';
        });
    });
}

// ==========================================
// 2. OTENTIKASI & ROLE UI (MAHASISWA VS GURU)
// ==========================================
function initAuth() {
    const authModal = document.getElementById('authModal');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    document.getElementById('openAuthModalBtn').addEventListener('click', () => authModal.hidden = false);
    document.getElementById('userProfileBox').addEventListener('click', () => authModal.hidden = false);

    document.getElementById('tabLogin').addEventListener('click', () => {
        document.getElementById('tabLogin').classList.add('active');
        document.getElementById('tabRegister').classList.remove('active');
        loginForm.hidden = false;
        registerForm.hidden = true;
        document.getElementById('authModalTitle').textContent = 'Masuk Akun';
    });

    document.getElementById('tabRegister').addEventListener('click', () => {
        document.getElementById('tabRegister').classList.add('active');
        document.getElementById('tabLogin').classList.remove('active');
        registerForm.hidden = false;
        loginForm.hidden = true;
        document.getElementById('authModalTitle').textContent = 'Daftar Akun Baru';
    });

    document.getElementById('regRoleSelect').addEventListener('change', (e) => {
        const isGuru = e.target.value === 'GURU';
        document.getElementById('regCourseField').hidden = !isGuru;
        document.getElementById('regCourseInput').required = isGuru;
    });

    loginForm.addEventListener('submit', async(e) => {
        e.preventDefault();
        const formData = Object.fromEntries(new FormData(loginForm));
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            saveUserSession(data.user);
            authModal.hidden = true;
            loginForm.reset();
            showToast('Berhasil Masuk', `Selamat datang, ${data.user.name}`);
        } catch (err) {
            showToast('Gagal Masuk', err.message, 'error');
        }
    });

    registerForm.addEventListener('submit', async(e) => {
        e.preventDefault();
        const formData = Object.fromEntries(new FormData(registerForm));
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            saveUserSession(data.user);
            authModal.hidden = true;
            registerForm.reset();
            showToast('Pendaftaran Berhasil', `Akun ${data.user.role} berhasil dibuat.`);
        } catch (err) {
            showToast('Gagal Daftar', err.message, 'error');
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('kumpul_user');
        currentUser = null;
        tasks = [];
        syncUserUI();
        loadAllData();
        showToast('Keluar', 'Anda telah keluar dari akun.');
    });
}

function saveUserSession(user) {
    currentUser = user;
    localStorage.setItem('kumpul_user', JSON.stringify(user));
    syncUserUI();
    loadAllData();
}

function syncUserUI() {
    const badge = document.getElementById('activeRoleBadge');
    const avatar = document.getElementById('userAvatar');
    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    const logoutBtn = document.getElementById('logoutBtn');
    const openTaskModalBtn = document.getElementById('openTaskModal');
    const openMaterialModalBtn = document.getElementById('openMaterialModal');

    if (!currentUser) {
        badge.textContent = 'Belum Login';
        badge.className = 'role-badge';
        avatar.textContent = '?';
        nameEl.textContent = 'Belum Login';
        roleEl.textContent = 'Klik untuk masuk';
        logoutBtn.style.display = 'none';
        openTaskModalBtn.hidden = true; // Wajib login dulu sebelum tambah tugas
        openMaterialModalBtn.hidden = true;
        document.getElementById('taskSectionTitle').textContent = 'Daftar Tugas';
        document.getElementById('authBtnText').textContent = 'Masuk / Daftar';
        return;
    }

    avatar.textContent = currentUser.name.charAt(0).toUpperCase();
    nameEl.textContent = currentUser.name;
    logoutBtn.style.display = 'block';
    document.getElementById('authBtnText').textContent = 'Ganti Akun';

    if (currentUser.role === 'GURU') {
        badge.textContent = `GURU • ${currentUser.assigned_course}`;
        badge.className = 'role-badge guru';
        roleEl.textContent = `Pengampu: ${currentUser.assigned_course}`;
        openTaskModalBtn.hidden = true;
        openMaterialModalBtn.hidden = false;
        document.getElementById('taskSectionTitle').textContent = `Pengumpulan Mahasiswa (${currentUser.assigned_course})`;
        document.getElementById('materialCourseInfo').textContent = `Mata Kuliah: ${currentUser.assigned_course}`;
    } else {
        badge.textContent = `MAHASISWA • ${currentUser.username}`;
        badge.className = 'role-badge';
        roleEl.textContent = `NIM/ID: ${currentUser.username}`;
        openTaskModalBtn.hidden = false;
        openMaterialModalBtn.hidden = true;
        document.getElementById('taskSectionTitle').textContent = `Tugas Milik ${currentUser.name}`;
    }
}

// ==========================================
// 3. LOAD DATA & FORM HANDLERS
// ==========================================
async function loadAllData() {
    await Promise.all([loadTasks(), loadSchedules(), loadMaterials()]);
}

function initModalsAndForms() {
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById(btn.dataset.closeModal).hidden = true;
        });
    });

    document.getElementById('openTaskModal').addEventListener('click', () => {
        if (!currentUser || currentUser.role !== 'MAHASISWA') {
            document.getElementById('authModal').hidden = false;
            return;
        }
        document.getElementById('taskModal').hidden = false;
    });
    document.getElementById('openScheduleModal').addEventListener('click', () => document.getElementById('scheduleModal').hidden = false);
    document.getElementById('openMaterialModal').addEventListener('click', () => document.getElementById('materialModal').hidden = false);

    // Filter & Search Tugas
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeFilter = btn.dataset.filter;
            document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
            renderTasks();
        });
    });
    document.getElementById('taskSearch').addEventListener('input', e => {
        searchQuery = e.target.value.toLowerCase();
        renderTasks();
    });
    document.getElementById('materialSearch').addEventListener('input', e => {
        renderMaterials(e.target.value.toLowerCase());
    });

    // Submit Tugas Baru (Mahasiswa)
    document.getElementById('taskForm').addEventListener('submit', async(e) => {
        e.preventDefault();
        if (!currentUser || currentUser.role !== 'MAHASISWA') {
            showToast('Akses Ditolak', 'Silakan login sebagai Mahasiswa.', 'error');
            return;
        }
        const formData = new FormData(e.target);
        formData.append('student_id', currentUser.id);
        const dl = document.getElementById('taskDeadline').value;
        if (dl) formData.set('deadline', new Date(dl).toISOString());

        const res = await fetch('/api/tasks', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
            e.target.reset();
            document.getElementById('taskModal').hidden = true;
            showToast('Berhasil', 'Tugas pribadi Anda ditambahkan.');
            loadTasks();
        } else {
            showToast('Gagal', data.error, 'error');
        }
    });

    // Submit Jadwal Harian
    document.getElementById('scheduleForm').addEventListener('submit', async(e) => {
        e.preventDefault();
        const payload = Object.fromEntries(new FormData(e.target));
        const res = await fetch('/api/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            e.target.reset();
            document.getElementById('scheduleModal').hidden = true;
            showToast('Berhasil', 'Jadwal harian disimpan.');
            loadSchedules();
        }
    });

    // Submit Materi Kuliah (Guru)
    document.getElementById('materialForm').addEventListener('submit', async(e) => {
        e.preventDefault();
        if (!currentUser || currentUser.role !== 'GURU') return;
        const formData = new FormData(e.target);
        formData.append('teacher_id', currentUser.id);

        const res = await fetch('/api/materials', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
            e.target.reset();
            document.getElementById('materialModal').hidden = true;
            showToast('Materi Dipublikasikan', 'Seluruh mahasiswa kini dapat melihat materi ini.');
            loadMaterials();
        } else {
            showToast('Gagal', data.error, 'error');
        }
    });

    // Submit Penilaian Guru
    document.getElementById('gradeForm').addEventListener('submit', async(e) => {
        e.preventDefault();
        const taskId = document.getElementById('gradeTaskId').value;
        const grade = document.getElementById('gradeScoreInput').value;
        const feedback = document.getElementById('gradeFeedbackInput').value;

        const res = await fetch(`/api/tasks/${taskId}/grade`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacher_id: currentUser.id, grade, feedback })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('gradeModal').hidden = true;
            showToast('Nilai Tersimpan', 'Penilaian mahasiswa berhasil diperbarui.');
            loadTasks();
        } else {
            showToast('Gagal Menilai', data.error, 'error');
        }
    });

    document.getElementById('taskGrid').addEventListener('click', handleTaskCardClick);
    document.getElementById('taskGrid').addEventListener('change', handleInlineUpload);
}

// ==========================================
// 4. RENDER TUGAS & PENILAIAN
// ==========================================
async function loadTasks() {
    if (!currentUser) {
        tasks = [];
        updateStats();
        renderTasks();
        return;
    }

    const params = new URLSearchParams({ userId: currentUser.id });
    const res = await fetch(`/api/tasks?${params.toString()}`);
    const data = await res.json();
    tasks = data.tasks || [];
    updateStats();
    renderTasks();
}

function renderTasks() {
    const grid = document.getElementById('taskGrid');

    if (!currentUser) {
        grid.innerHTML = `
            <div class="state-card">
                <strong>Silakan Masuk Terlebih Dahulu</strong>
                <span class="state-detail">Login sebagai Mahasiswa untuk mengelola tugas pribadi Anda, atau sebagai Guru untuk menilai tugas mahasiswa di mata kuliah Anda.</span>
                <button class="primary-button" type="button" style="margin-top:12px;" onclick="document.getElementById('authModal').hidden=false">Masuk / Daftar Akun</button>
            </div>
        `;
        return;
    }

    const filtered = tasks.filter(t => {
        const matchStatus = activeFilter === 'ALL' || t.status === activeFilter;
        const matchText = `${t.title} ${t.course} ${t.studentName} ${t.studentUsername}`.toLowerCase().includes(searchQuery);
        return matchStatus && matchText;
    });

    if (!filtered.length) {
        const msg = currentUser.role === 'GURU' ?
            `Belum ada mahasiswa yang mengumpulkan tugas untuk mata kuliah ${escapeHtml(currentUser.assigned_course)}.` :
            'Anda belum memiliki catatan tugas. Klik "+ Tambah tugas" untuk memulai.';
        grid.innerHTML = `<div class="state-card"><strong>Daftar kosong</strong><span class="state-detail">${msg}</span></div>`;
        return;
    }

    const isGuru = currentUser.role === 'GURU';

    grid.innerHTML = filtered.map(task => `
        <article class="task-card ${task.status === 'SELESAI' ? 'is-completed' : ''}">
            <div class="task-card-top">
                <span class="course-tag">${escapeHtml(task.course)}</span>
                <span class="status-pill ${task.status === 'SELESAI' ? 'completed' : 'pending'}">
                    ${task.status === 'SELESAI' ? 'Selesai' : 'Belum selesai'}
                </span>
            </div>
            <h3 class="task-title">${escapeHtml(task.title)}</h3>
            
            ${isGuru ? `
                <div style="background:#f3f4f6; padding:6px 10px; border-radius:8px; margin:6px 0; font-size:0.82rem; color:#1f2937;">
                    👤 Pengumpul: <strong>${escapeHtml(task.studentName)}</strong> 
                    <span style="color:#6b7280;">(${escapeHtml(task.studentUsername)})</span>
                </div>
            ` : ''}
            
            <p class="task-file" style="margin:6px 0; font-size:0.85rem;">
                ${task.originalName ? `📎 ${escapeHtml(task.originalName)}` : '<i>Belum ada lampiran file</i>'}
            </p>

            ${task.grade !== null && task.grade !== undefined ? `
                <div class="grade-box">
                    <strong>Nilai: ${task.grade}/100</strong>
                    ${task.feedback ? `<p style="margin:4px 0 0; font-size:0.8rem;">"${escapeHtml(task.feedback)}"</p>` : ''}
                </div>
            ` : ''}

            <div class="task-card-actions" style="margin-top:12px;">
                ${isGuru ? `
                    <button class="task-action complete" type="button" data-action="grade" data-id="${task.id}">
                        ★ ${task.grade !== null ? 'Edit Nilai' : 'Beri Nilai'}
                    </button>
                ` : `
                    <button class="task-action ${task.status === 'BELUM_SELESAI' ? 'complete' : ''}" type="button" data-action="toggle" data-id="${task.id}">
                        ${task.status === 'SELESAI' ? 'Batalkan' : '✓ Selesai'}
                    </button>
                    <label class="task-action" style="cursor:pointer;">
                        ${task.filePath ? 'Ganti File' : '+ Upload File'}
                        <input type="file" data-upload-id="${task.id}" style="display:none;">
                    </label>
                    <button class="task-action delete" type="button" data-action="delete" data-id="${task.id}">Hapus</button>
                `}
                ${task.filePath ? `<a class="task-open-link" href="${task.filePath}" target="_blank">Buka File ↗</a>` : ''}
            </div>
        </article>
    `).join('');
}

async function handleTaskCardClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !currentUser) return;
    const task = tasks.find(t => t.id === btn.dataset.id);
    if (!task) return;

    if (btn.dataset.action === 'grade') {
        document.getElementById('gradeTaskId').value = task.id;
        document.getElementById('gradeStudentInfo').textContent = `${task.studentName} (${task.studentUsername}) — ${task.title}`;
        document.getElementById('gradeScoreInput').value = task.grade ?? '';
        document.getElementById('gradeFeedbackInput').value = task.feedback || '';
        document.getElementById('gradeModal').hidden = false;
    } else if (btn.dataset.action === 'toggle') {
        const nextStatus = task.status === 'SELESAI' ? 'BELUM_SELESAI' : 'SELESAI';
        const res = await fetch(`/api/tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus, student_id: currentUser.id })
        });
        const data = await res.json();
        if (!res.ok) return showToast('Gagal', data.error, 'error');
        loadTasks();
    } else if (btn.dataset.action === 'delete') {
        if (!confirm('Hapus tugas ini?')) return;
        const res = await fetch(`/api/tasks/${task.id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: currentUser.id })
        });
        const data = await res.json();
        if (!res.ok) return showToast('Gagal', data.error, 'error');
        loadTasks();
    }
}

async function handleInlineUpload(e) {
    const taskId = e.target.dataset.uploadId;
    if (!taskId || !e.target.files.length || !currentUser) return;
    const formData = new FormData();
    formData.append('taskFile', e.target.files[0]);
    formData.append('student_id', currentUser.id);
    showToast('Mengunggah...', 'Menyimpan lampiran tugas.');
    const res = await fetch(`/api/tasks/${taskId}/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (res.ok) {
        showToast('Sukses', 'Lampiran berhasil diunggah.');
        loadTasks();
    } else {
        showToast('Gagal', data.error, 'error');
    }
}

// ==========================================
// 5. RENDER JADWAL HARIAN
// ==========================================
async function loadSchedules() {
    const res = await fetch('/api/schedules');
    const data = await res.json();
    schedules = data.schedules || [];
    renderSchedules();
}

function renderSchedules() {
    const grid = document.getElementById('scheduleGrid');
    const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

    grid.innerHTML = days.map(day => {
        const dayItems = schedules.filter(s => s.day_of_week === day);
        return `
            <div class="schedule-card">
                <h3 style="margin:0 0 8px; font-size:1.05rem;">${day}</h3>
                ${dayItems.length ? dayItems.map(item => `
                    <div class="schedule-item">
                        <div>
                            <strong style="display:block; font-size:0.95rem;">${escapeHtml(item.course)}</strong>
                            <span style="font-size:0.8rem; color:#4f46e5; font-weight:600;">
                                ${item.start_time.slice(0,5)} - ${item.end_time.slice(0,5)}
                            </span>
                            <div style="font-size:0.78rem; color:#6b7280; margin-top:2px;">
                                ${item.room ? `📍 ${escapeHtml(item.room)}` : ''} 
                                ${item.lecturer ? `• 👤 ${escapeHtml(item.lecturer)}` : ''}
                            </div>
                        </div>
                        <button type="button" onclick="deleteSchedule(${item.id})" style="border:none; background:none; color:#ef4444; cursor:pointer;" title="Hapus">×</button>
                    </div>
                `).join('') : `<p style="font-size:0.85rem; color:#9ca3af; margin:0;">Tidak ada jadwal kuliah.</p>`}
            </div>
        `;
    }).join('');
}

window.deleteSchedule = async function(id) {
    if (!confirm('Hapus jadwal ini?')) return;
    await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    loadSchedules();
};

// ==========================================
// 6. RENDER MATERI KULIAH
// ==========================================
async function loadMaterials() {
    const res = await fetch('/api/materials');
    const data = await res.json();
    materials = data.materials || [];
    renderMaterials();
}

function renderMaterials(filter = '') {
    const grid = document.getElementById('materialGrid');
    const list = materials.filter(m => `${m.title} ${m.course} ${m.description}`.toLowerCase().includes(filter));

    if (!list.length) {
        grid.innerHTML = `<div class="state-card"><strong>Belum ada materi kuliah yang diunggah</strong></div>`;
        return;
    }

    grid.innerHTML = list.map(m => {
        const canDelete = currentUser && currentUser.role === 'GURU' && Number(currentUser.id) === Number(m.teacher_id);
        return `
            <article class="task-card">
                <div class="task-card-top">
                    <span class="course-tag">${escapeHtml(m.course)}</span>
                    <span style="font-size:0.75rem; color:#6b7280;">Oleh: ${escapeHtml(m.teacher_name || 'Dosen')}</span>
                </div>
                <h3 class="task-title">${escapeHtml(m.title)}</h3>
                <p style="font-size:0.85rem; color:#4b5563; margin:6px 0;">${escapeHtml(m.description || 'Tidak ada catatan tambahan.')}</p>
                <div class="task-card-actions" style="margin-top:12px;">
                    ${m.filePath ? `<a class="task-open-link" href="${m.filePath}" target="_blank">Unduh / Buka Materi ↗</a>` : '<span style="font-size:0.8rem; color:#9ca3af;">Tanpa file lampiran</span>'}
                    ${canDelete ? `<button class="task-action delete" type="button" onclick="deleteMaterial(${m.id})">Hapus</button>` : ''}
                </div>
            </article>
        `;
    }).join('');
}

window.deleteMaterial = async function(id) {
    if (!confirm('Hapus materi ini?')) return;
    const res = await fetch(`/api/materials/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: currentUser?.id })
    });
    const data = await res.json();
    if (!res.ok) return showToast('Gagal', data.error, 'error');
    loadMaterials();
};

// ==========================================
// 7. UTILITAS
// ==========================================
function updateStats() {
    const pending = tasks.filter(t => t.status === 'BELUM_SELESAI').length;
    document.getElementById('totalCount').textContent = tasks.length;
    document.getElementById('pendingCount').textContent = pending;
    document.getElementById('completedCount').textContent = tasks.length - pending;
    document.getElementById('urgentCount').textContent = tasks.filter(t => {
        if (t.status === 'SELESAI' || !t.deadline) return false;
        const diff = new Date(t.deadline).getTime() - Date.now();
        return diff > 0 && diff <= 86400000;
    }).length;
}

function updateClock() {
    document.getElementById('liveClock').textContent = new Intl.DateTimeFormat('id-ID', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    }).format(new Date());
}

function showToast(title, message, type = '') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`.trim();
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    document.getElementById('toastRegion').append(toast);
    setTimeout(() => toast.remove(), 4500);
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}