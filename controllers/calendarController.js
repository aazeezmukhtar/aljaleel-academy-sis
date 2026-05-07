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
        const events = await db.all('SELECT * FROM term_events ORDER BY event_date DESC');
        res.render('calendar/manage', {
            title: 'Manage Calendar',
            events
        });
    } catch (err) {
        console.error('Calendar Manage Error:', err);
        res.status(500).send('Database Error');
    }
};

exports.createEvent = async (req, res) => {
    const { title, description, event_date, type, session, term } = req.body;
    const user = req.session.staff;
    if (!user || user.role !== 'Admin') return res.status(403).send('Access Denied');

    try {
        await db.run(`
            INSERT INTO term_events (title, description, event_date, type, session, term)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [title, description, event_date, type, session, term]);
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
