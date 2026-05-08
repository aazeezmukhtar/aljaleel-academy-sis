require('dotenv').config();
const express = require('express');
const path = require('path');
const morgan = require('morgan');
const settingsMiddleware = require('./middleware/settingsMiddleware');
const studentRoutes = require('./routes/studentRoutes');
const resultRoutes = require('./routes/resultRoutes');
const academicRoutes = require('./routes/academicRoutes');
const staffRoutes = require('./routes/staffRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const feeRoutes = require('./routes/feeRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const authRoutes = require('./routes/authRoutes');
const reportRoutes = require('./routes/reportRoutes');
const session = require('express-session');
const { isAuthenticated, injectUser } = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session Middleware
const DB_TYPE = process.env.DB_TYPE || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');
let sessionStore;

if (DB_TYPE === 'postgres') {
    const PostgresStore = require('connect-pg-simple')(session);
    sessionStore = new PostgresStore({ 
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true
    });
    console.log('[Session] Using PostgreSQL Store');
} else {
    const SQLiteStore = require('connect-sqlite3')(session);
    sessionStore = new SQLiteStore({ 
        db: process.env.DB_PATH || 'database.sqlite', 
        dir: '.' 
    });
    console.log('[Session] Using SQLite Store');
}

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'nexus-sis-secret-key-offline-first',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 week
}));

app.use(injectUser);

const homeController = require('./controllers/homeController');
const portalRoutes = require('./routes/portalRoutes');
const { isStudentAuthenticated, injectStudent } = require('./middleware/studentAuthMiddleware');

// Settings injection and global vars
app.use(settingsMiddleware);

// Routes
app.use('/auth', authRoutes);

// Public Routes
app.get('/', (req, res) => {
    res.redirect('/auth/login');
});

// Protected Staff/Admin Routes
app.use('/dashboard', isAuthenticated, homeController.getDashboard);
app.use('/students', isAuthenticated, studentRoutes);
app.use('/results', isAuthenticated, resultRoutes);
app.use('/academics', isAuthenticated, academicRoutes);
app.use('/staff', isAuthenticated, staffRoutes);
app.use('/attendance', isAuthenticated, attendanceRoutes);
app.use('/fees', isAuthenticated, feeRoutes);
app.use('/settings', isAuthenticated, settingsRoutes);
app.use('/reports', isAuthenticated, reportRoutes);
app.use('/announcements', isAuthenticated, require('./routes/announcementRoutes'));
app.use('/api/notifications', isAuthenticated, require('./routes/notificationRoutes'));
app.use('/calendar', require('./routes/calendarRoutes'));

// Protected Student Portal Routes
app.use(injectStudent);
app.use('/portal', isStudentAuthenticated, portalRoutes);

if (process.env.NODE_ENV !== 'production' || process.env.VITE_DEV_SERVER) {
    app.listen(PORT, () => {
        console.log(`Nexus Local SIS running at http://localhost:${PORT}`);
        console.log(`Mode: ${DB_TYPE === 'postgres' ? 'Cloud' : 'Local'} Database`);
    });
}

module.exports = app;
