require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const mysql = require('mysql2/promise');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_NAME = process.env.DB_NAME || 'kumpul_tugas';
const uploadDir = path.join(__dirname, 'uploads');
const allowedStatuses = new Set(['BELUM_SELESAI', 'SELESAI']);

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const databaseConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    ssl: { rejectUnauthorized: true }, // Tambahkan baris ini untuk TiDB Cloud
    dateStrings: true,
    charset: 'utf8mb4'
};

const pool = mysql.createPool({
    ...databaseConfig,
    database: DATABASE_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const safeName = path.basename(file.originalname).replace(/[^\w.-]/g, '_');
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(uploadDir));

app.get(['/', '/index.html'], (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (_req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/script.js', (_req, res) => res.sendFile(path.join(__dirname, 'script.js')));

function hashPassword(pwd) {
    return crypto.createHash('sha256').update(pwd).digest('hex');
}

function cleanupUploadedFile(filePath) {
    if (!filePath) return;
    fs.unlink(filePath, () => {});
}

function parseDeadline(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

// ==========================================
// 1. AUTHENTICATION & USER MANAGEMENT
// ==========================================
app.post('/api/auth/register', async(req, res, next) => {
    try {
        const { name, username, password, role, assigned_course } = req.body;
        if (!name || !username || !password || !['MAHASISWA', 'GURU'].includes(role)) {
            return res.status(400).json({ error: 'Data pendaftaran tidak lengkap.' });
        }
        if (role === 'GURU' && (!assigned_course || !assigned_course.trim())) {
            return res.status(400).json({ error: 'Guru wajib mengisi mata kuliah yang diampu.' });
        }

        const [existing] = await pool.execute('SELECT id FROM users WHERE username = ?', [username.trim()]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Username / NIM sudah terdaftar.' });
        }

        const courseValue = role === 'GURU' ? assigned_course.trim() : null;
        const [result] = await pool.execute(
            'INSERT INTO users (name, username, password, role, assigned_course) VALUES (?, ?, ?, ?, ?)', [name.trim(), username.trim(), hashPassword(password), role, courseValue]
        );

        res.status(201).json({
            user: {
                id: result.insertId,
                name: name.trim(),
                username: username.trim(),
                role,
                assigned_course: courseValue
            }
        });
    } catch (err) {
        next(err);
    }
});

app.post('/api/auth/login', async(req, res, next) => {
    try {
        const { username, password } = req.body;
        const [rows] = await pool.execute(
            'SELECT id, name, username, role, assigned_course FROM users WHERE username = ? AND password = ?', [username.trim(), hashPassword(password)]
        );
        if (!rows.length) {
            return res.status(401).json({ error: 'Username atau password salah.' });
        }
        res.json({ user: rows[0] });
    } catch (err) {
        next(err);
    }
});

// ==========================================
// 2. JADWAL HARIAN
// ==========================================
app.get('/api/schedules', async(_req, res, next) => {
    try {
        const [rows] = await pool.execute(
            `SELECT * FROM schedules 
             ORDER BY FIELD(day_of_week, 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'), start_time ASC`
        );
        res.json({ schedules: rows });
    } catch (err) {
        next(err);
    }
});

app.post('/api/schedules', async(req, res, next) => {
    try {
        const { day_of_week, start_time, end_time, course, room, lecturer } = req.body;
        if (!day_of_week || !start_time || !end_time || !course) {
            return res.status(400).json({ error: 'Hari, jam mulai, jam selesai, dan mata kuliah wajib diisi.' });
        }
        await pool.execute(
            'INSERT INTO schedules (day_of_week, start_time, end_time, course, room, lecturer) VALUES (?, ?, ?, ?, ?, ?)', [day_of_week, start_time, end_time, course.trim(), room || '', lecturer || '']
        );
        res.status(201).json({ success: true });
    } catch (err) {
        next(err);
    }
});

app.delete('/api/schedules/:id', async(req, res, next) => {
    try {
        await pool.execute('DELETE FROM schedules WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// ==========================================
// 3. MATERI KULIAH
// ==========================================
app.get('/api/materials', async(_req, res, next) => {
    try {
        const [rows] = await pool.execute(
            `SELECT m.*, u.name AS teacher_name 
             FROM materials m 
             LEFT JOIN users u ON m.teacher_id = u.id 
             ORDER BY m.created_at DESC`
        );
        const materials = rows.map(m => ({
            ...m,
            filePath: m.stored_name ? `/uploads/${encodeURIComponent(m.stored_name)}` : null
        }));
        res.json({ materials });
    } catch (err) {
        next(err);
    }
});

app.post('/api/materials', upload.single('materialFile'), async(req, res, next) => {
    try {
        const { teacher_id, title, description } = req.body;
        if (!teacher_id || !title) {
            if (req.file) cleanupUploadedFile(req.file.path);
            return res.status(400).json({ error: 'Judul materi wajib diisi.' });
        }

        const [users] = await pool.execute('SELECT role, assigned_course FROM users WHERE id = ?', [teacher_id]);
        if (!users.length || users[0].role !== 'GURU') {
            if (req.file) cleanupUploadedFile(req.file.path);
            return res.status(403).json({ error: 'Hanya akun Guru yang dapat mengunggah materi.' });
        }

        const course = users[0].assigned_course;
        const origName = req.file ? path.basename(req.file.originalname) : null;
        const storedName = req.file ? req.file.filename : null;

        await pool.execute(
            'INSERT INTO materials (teacher_id, course, title, description, original_name, stored_name) VALUES (?, ?, ?, ?, ?, ?)', [teacher_id, course, title.trim(), description || '', origName, storedName]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        if (req.file) cleanupUploadedFile(req.file.path);
        next(err);
    }
});

app.delete('/api/materials/:id', async(req, res, next) => {
    try {
        const { teacher_id } = req.body;
        const [rows] = await pool.execute('SELECT teacher_id, stored_name FROM materials WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Materi tidak ditemukan.' });

        if (Number(rows[0].teacher_id) !== Number(teacher_id)) {
            return res.status(403).json({ error: 'Anda tidak berhak menghapus materi guru lain.' });
        }

        if (rows[0].stored_name) {
            cleanupUploadedFile(path.join(uploadDir, rows[0].stored_name));
        }
        await pool.execute('DELETE FROM materials WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// ==========================================
// 4. TUGAS & PENILAIAN (TERISOLASI PER USER)
// ==========================================
function toApiTask(row) {
    return {
        id: String(row.id),
        studentId: row.student_id,
        studentName: row.user_full_name || row.student_name || 'Tanpa Nama',
        studentUsername: row.user_username || '-',
        title: row.title,
        course: row.course,
        originalName: row.original_name || null,
        filePath: row.stored_name ? `/uploads/${encodeURIComponent(row.stored_name)}` : null,
        deadline: row.deadline ? new Date(`${row.deadline.replace(' ', 'T')}Z`).toISOString() : null,
        status: row.status,
        grade: row.grade,
        feedback: row.feedback || '',
        createdAt: row.created_at
    };
}

app.get('/api/tasks', async(req, res, next) => {
    try {
        const { userId } = req.query;
        // Jika belum login, jangan tampilkan tugas milik siapa pun
        if (!userId) {
            return res.json({ tasks: [] });
        }

        // Validasi user langsung dari database (bukan percaya query frontend semata)
        const [users] = await pool.execute('SELECT id, role, assigned_course FROM users WHERE id = ?', [userId]);
        if (!users.length) {
            return res.json({ tasks: [] });
        }

        const currentUser = users[0];
        let query = `
            SELECT t.*, u.name AS user_full_name, u.username AS user_username 
            FROM tasks t
            LEFT JOIN users u ON t.student_id = u.id
        `;
        const params = [];

        if (currentUser.role === 'GURU') {
            // Guru hanya melihat tugas mahasiswa pada mata kuliah yang diampunya
            query += ' WHERE LOWER(TRIM(t.course)) = LOWER(TRIM(?))';
            params.push(currentUser.assigned_course);
        } else {
            // Mahasiswa HANYA melihat tugas miliknya sendiri (strict isolation)
            query += ' WHERE t.student_id = ?';
            params.push(currentUser.id);
        }

        query += ' ORDER BY t.deadline IS NULL, t.deadline ASC, t.created_at DESC';
        const [rows] = await pool.execute(query, params);
        res.json({ tasks: rows.map(toApiTask) });
    } catch (error) {
        next(error);
    }
});

// Tambah Tugas (Wajib Login sebagai Mahasiswa)
app.post('/api/tasks', upload.single('taskFile'), async(req, res, next) => {
    const title = (req.body.title || '').trim();
    const course = (req.body.course || '').trim();
    const studentId = req.body.student_id;
    const deadline = parseDeadline(req.body.deadline);

    if (!studentId) {
        if (req.file) cleanupUploadedFile(req.file.path);
        return res.status(401).json({ error: 'Silakan login sebagai Mahasiswa terlebih dahulu.' });
    }

    if (!title || !course) {
        if (req.file) cleanupUploadedFile(req.file.path);
        return res.status(400).json({ error: 'Nama tugas dan mata kuliah wajib diisi.' });
    }

    try {
        const [users] = await pool.execute('SELECT id, name, role FROM users WHERE id = ?', [studentId]);
        if (!users.length || users[0].role !== 'MAHASISWA') {
            if (req.file) cleanupUploadedFile(req.file.path);
            return res.status(403).json({ error: 'Hanya akun Mahasiswa yang dapat membuat tugas.' });
        }

        await pool.execute(
            `INSERT INTO tasks (student_id, student_name, title, course, original_name, stored_name, mime_type, size_bytes, deadline)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                users[0].id,
                users[0].name,
                title,
                course,
                req.file ? path.basename(req.file.originalname) : null,
                req.file ? req.file.filename : null,
                req.file ? req.file.mimetype : null,
                req.file ? req.file.size : null,
                deadline
            ]
        );
        res.status(201).json({ success: true });
    } catch (error) {
        if (req.file) cleanupUploadedFile(req.file.path);
        next(error);
    }
});

// Upload Lampiran pada Card (Hanya Pemilik Tugas yang Boleh)
app.post('/api/tasks/:id/upload', upload.single('taskFile'), async(req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'File wajib dipilih.' });
    const studentId = req.body.student_id;

    try {
        const [rows] = await pool.execute('SELECT student_id, stored_name FROM tasks WHERE id = ?', [req.params.id]);
        if (!rows.length) {
            cleanupUploadedFile(req.file.path);
            return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
        }

        // Cek kepemilikan tugas
        if (Number(rows[0].student_id) !== Number(studentId)) {
            cleanupUploadedFile(req.file.path);
            return res.status(403).json({ error: 'Akses ditolak: Ini bukan tugas milik Anda.' });
        }

        if (rows[0].stored_name) {
            cleanupUploadedFile(path.join(uploadDir, rows[0].stored_name));
        }
        await pool.execute(
            'UPDATE tasks SET original_name = ?, stored_name = ?, mime_type = ?, size_bytes = ? WHERE id = ?', [path.basename(req.file.originalname), req.file.filename, req.file.mimetype, req.file.size, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        cleanupUploadedFile(req.file.path);
        next(err);
    }
});

// Penilaian Khusus Guru
app.patch('/api/tasks/:id/grade', async(req, res, next) => {
    try {
        const { teacher_id, grade, feedback } = req.body;
        const [users] = await pool.execute('SELECT role, assigned_course FROM users WHERE id = ?', [teacher_id]);
        if (!users.length || users[0].role !== 'GURU') {
            return res.status(403).json({ error: 'Akses ditolak. Hanya Guru yang dapat menilai.' });
        }

        const [tasks] = await pool.execute('SELECT course FROM tasks WHERE id = ?', [req.params.id]);
        if (!tasks.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });

        if (tasks[0].course.trim().toLowerCase() !== users[0].assigned_course.trim().toLowerCase()) {
            return res.status(403).json({ error: 'Anda hanya berhak menilai tugas pada mata kuliah Anda sendiri.' });
        }

        const numericGrade = grade !== '' && grade !== null ? Number(grade) : null;
        if (numericGrade !== null && (Number.isNaN(numericGrade) || numericGrade < 0 || numericGrade > 100)) {
            return res.status(400).json({ error: 'Nilai harus berupa angka antara 0 - 100.' });
        }

        await pool.execute(
            'UPDATE tasks SET grade = ?, feedback = ?, status = "SELESAI" WHERE id = ?', [numericGrade, feedback || '', req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// Update Status (Hanya Pemilik Tugas)
app.patch('/api/tasks/:id', async(req, res, next) => {
    try {
        const { status, student_id } = req.body;
        const [rows] = await pool.execute('SELECT student_id FROM tasks WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });

        if (Number(rows[0].student_id) !== Number(student_id)) {
            return res.status(403).json({ error: 'Akses ditolak: Anda tidak berhak mengubah tugas mahasiswa lain.' });
        }

        if (status && allowedStatuses.has(status)) {
            await pool.execute('UPDATE tasks SET status = ? WHERE id = ?', [status, req.params.id]);
        }
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// Hapus Tugas (Hanya Pemilik Tugas)
app.delete('/api/tasks/:id', async(req, res, next) => {
    try {
        const { student_id } = req.body;
        const [rows] = await pool.execute('SELECT student_id, stored_name FROM tasks WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });

        if (Number(rows[0].student_id) !== Number(student_id)) {
            return res.status(403).json({ error: 'Akses ditolak: Anda tidak dapat menghapus tugas mahasiswa lain.' });
        }

        if (rows[0].stored_name) {
            cleanupUploadedFile(path.join(uploadDir, rows[0].stored_name));
        }
        await pool.execute('DELETE FROM tasks WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

app.listen(PORT, () => {
    console.log(`Kumpul berjalan di http://localhost:${PORT} (database: ${DATABASE_NAME})`);
});