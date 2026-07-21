const db = require('../utils/db');

exports.getCalendar = async (req, res) => {
    try {
        const events = await db.all('SELECT * FROM term_events ORDER BY event_date ASC');
        res.render('calendar/index', {
            title: 'School Calendar',
            events,
            user: req.session.staff || req.session.student
        });
    } catch (err) {
        console.error('Calendar Fetch Error:', err);
        res.status(500).send('Database Error');
    }
};

exports.getManageCalendar = async (req, res) => {
    const user = req.session.staff;
    if (!user || user.role !== 'Admin') return res.status(403).send('Access Denied');
    
    try {
<<<<<<< HEAD
        const events = await db.all('SELECT * FROM term_events ORDER BY event_date DESC');
        res.render('calendar/manage', {
            title: 'Manage Calendar',
            events
=======
        const events = await db.all('SELECT e.*, s.name as section_name FROM term_events e LEFT JOIN sections s ON e.section_id = s.id ORDER BY event_date DESC');
        const sections = await db.all('SELECT * FROM sections ORDER BY name');
        const school = {};
        (await db.all('SELECT key, value FROM settings')).forEach(r => school[r.key] = r.value);
        res.render('calendar/manage', {
            title: 'Manage Calendar',
            events,
            sections,
            school
>>>>>>> local-master
        });
    } catch (err) {
        console.error('Calendar Manage Error:', err);
        res.status(500).send('Database Error');
    }
};

exports.createEvent = async (req, res) => {
<<<<<<< HEAD
    const { title, description, event_date, type, session, term } = req.body;
=======
    const { title, description, event_date, type, section_id } = req.body;
>>>>>>> local-master
    const user = req.session.staff;
    if (!user || user.role !== 'Admin') return res.status(403).send('Access Denied');

    try {
<<<<<<< HEAD
        await db.run(`
            INSERT INTO term_events (title, description, event_date, type, session, term)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [title, description, event_date, type, session, term]);
=======
        // Derive session and term from the chosen section (or global if no section)
        let session, term;
        if (section_id) {
            const sec = await db.get('SELECT current_session, current_term FROM sections WHERE id = ?', [section_id]);
            session = sec ? sec.current_session : null;
            term = sec ? sec.current_term : null;
        }
        if (!session || !term) {
            const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
            const termRow = await db.get("SELECT value FROM settings WHERE key = 'current_term'");
            session = session || (sessionRow ? sessionRow.value : '2024/2025');
            term = term || (termRow ? termRow.value : '1st Term');
        }

        await db.run(`
            INSERT INTO term_events (title, description, event_date, type, session, term, section_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [title, description, event_date, type, session, term, section_id || null]);
>>>>>>> local-master
        res.redirect('/calendar/manage?success=Event added');
    } catch (err) {
        console.error('Create Event Error:', err);
        res.redirect('/calendar/manage?error=Failed to add event');
    }
};

exports.deleteEvent = async (req, res) => {
    const user = req.session.staff;
    if (!user || user.role !== 'Admin') return res.status(403).send('Access Denied');

    try {
        await db.run('DELETE FROM term_events WHERE id = ?', [req.params.id]);
        res.redirect('/calendar/manage?success=Event deleted');
    } catch (err) {
        console.error('Delete Event Error:', err);
        res.redirect('/calendar/manage?error=Failed to delete event');
    }
};
