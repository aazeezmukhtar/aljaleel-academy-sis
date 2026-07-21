const db = require('../utils/db');

exports.getIndex = async (req, res) => {
<<<<<<< HEAD
    const announcements = await db.all('SELECT * FROM announcements ORDER BY created_at DESC');
=======
    const announcements = await db.all('SELECT a.*, s.name as section_name FROM announcements a LEFT JOIN sections s ON a.section_id = s.id ORDER BY a.created_at DESC');
>>>>>>> local-master
    
    res.render('announcements/index', {
        title: 'Announcement Management',
        path: '/announcements',
        announcements
    });
};

<<<<<<< HEAD
exports.createAnnouncement = (req, res) => {
    res.render('announcements/form', {
        title: 'Create Announcement',
        path: '/announcements'
=======
exports.createAnnouncement = async (req, res) => {
    const sections = await db.all('SELECT * FROM sections');
    res.render('announcements/form', {
        title: 'Create Announcement',
        path: '/announcements',
        sections
>>>>>>> local-master
    });
};

exports.storeAnnouncement = async (req, res) => {
    try {
<<<<<<< HEAD
        const { title, content, target_role, is_published, type, event_date } = req.body;
=======
        const { title, content, target_role, is_published, type, event_date, section_id } = req.body;
>>>>>>> local-master
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
        const image_path = req.file ? req.file.filename : null;

        await db.run(`
<<<<<<< HEAD
            INSERT INTO announcements (title, slug, content, target_role, image_path, is_published, type, event_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
=======
            INSERT INTO announcements (title, slug, content, target_role, image_path, is_published, type, event_date, section_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
>>>>>>> local-master
        `, [
            title, 
            slug, 
            content, 
            target_role || 'All', 
            image_path, 
            is_published === '1' ? 1 : 0,
            type || 'Announcement',
<<<<<<< HEAD
            (type === 'Event' && event_date) ? event_date : null
=======
            (type === 'Event' && event_date) ? event_date : null,
            section_id || null
>>>>>>> local-master
        ]);

        res.redirect('/announcements?success=Announcement created successfully');
    } catch (e) {
        console.error(e);
        res.redirect('/announcements?error=Failed to create announcement');
    }
};

exports.toggleAnnouncement = async (req, res) => {
    await db.run(`UPDATE announcements SET is_published = CASE WHEN is_published = 1 THEN 0 ELSE 1 END WHERE id = ?`, [req.params.id]);
    res.redirect('/announcements');
};

exports.deleteAnnouncement = async (req, res) => {
    await db.run('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    res.redirect('/announcements?success=Announcement deleted');
};

exports.viewAnnouncement = async (req, res) => {
    const id = req.params.id;
    try {
        const announcement = await db.get('SELECT * FROM announcements WHERE id = ?', [id]);
        if (!announcement) return res.status(404).send('Announcement not found');
        
        res.render('announcements/view', {
            title: announcement.title,
            announcement,
            user: req.session.staff || req.session.student
        });
    } catch (err) {
        console.error('View Announcement Error:', err);
        res.status(500).send('Database Error');
    }
};

