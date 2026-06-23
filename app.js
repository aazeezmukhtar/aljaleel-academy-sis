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
const SQLiteStore = require('connect-sqlite3')(session);
const { isAuthenticated, injectUser, isAnyAuthenticated } = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded passport photos
const uploadDir = path.join(__dirname, 'public', 'uploads');
app.use('/uploads', express.static(uploadDir));

// Static files serving
app.use(express.static(path.join(__dirname, 'public')));

// Session Middleware
const isPostgres = process.env.DB_TYPE === 'postgres' || !!process.env.DATABASE_URL;

const sessionStore = isPostgres
    ? new (require('connect-pg-simple')(session))({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true,
        poolSize: 30, // increased to match DB pool
        pgOptions: {
            ssl: { rejectUnauthorized: false }
        }
    })
    : new SQLiteStore({ db: 'database.sqlite', dir: '.' });

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'nexus-sis-secret-key-offline-first',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax', secure: false }
}));

app.use(injectUser);

const homeController = require('./controllers/homeController');
const portalRoutes = require('./routes/portalRoutes');
const { isStudentAuthenticated, injectStudent } = require('./middleware/studentAuthMiddleware');

// Settings injection and global vars
app.use(settingsMiddleware);

// Run non-destructive startup migrations (creates sections, enrollments tables etc.)
const { runMigrations } = require('./utils/migrateOnStartup');
runMigrations().catch(err => console.error('[migrate] Startup migration error:', err.message));

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
app.use('/api/notifications', isAnyAuthenticated, require('./routes/notificationRoutes'));
app.use('/calendar', require('./routes/calendarRoutes'));

// Protected Student Portal Routes
app.use(injectStudent);
app.use('/portal', isStudentAuthenticated, portalRoutes);

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Nexus Local SIS running at http://localhost:${PORT}`);
        console.log(`Mode: LAN Access Only`);
    });
}

module.exports = app;
