const db = require('../utils/db');

exports.getIndex = async (req, res) => {
    const announcements = await db.all('SELECT * FROM announcements ORDER BY created_at DESC');
    
    res.render('announcements/index', {
        title: 'Announcement Management',
        path: '/announcements',
        announcements
    });
};

exports.createAnnouncement = (req, res) => {
    res.render('announcements/form', {
        title: 'Create Announcement',
        path: '/announcements'
    });
};

exports.storeAnnouncement = async (req, res) => {
    try {
        const { title, content, target_role, is_published, type, event_date } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
        const image_path = req.file ? req.file.filename : null;

        await db.run(`
            INSERT INTO announcements (title, slug, content, target_role, image_path, is_published, type, event_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            title, 
            slug, 
            content, 
            target_role || 'All', 
            image_path, 
            is_published === '1' ? 1 : 0,
            type || 'Announcement',
            (type === 'Event' && event_date) ? event_date : null
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

