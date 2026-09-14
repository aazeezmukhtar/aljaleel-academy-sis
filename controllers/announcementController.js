const db = require('../utils/db');

exports.getIndex = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const announcements = await db.all(
        'SELECT a.*, s.name as section_name FROM announcements a LEFT JOIN sections s ON a.section_id = s.id WHERE a.school_id = ? ORDER BY a.created_at DESC',
        [schoolId]
    );
    
    res.render('announcements/index', {
        title: 'Announcement Management',
        path: '/announcements',
        announcements
    });
};

exports.createAnnouncement = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const sections = await db.all('SELECT * FROM sections WHERE school_id = ?', [schoolId]);
    res.render('announcements/form', {
        title: 'Create Announcement',
        path: '/announcements',
        sections
    });
};

exports.storeAnnouncement = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    try {
        const { title, content, target_role, is_published, type, event_date, section_id } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
        const image_path = req.file ? req.file.filename : null;

        await db.run(`
            INSERT INTO announcements (school_id, title, slug, content, target_role, image_path, is_published, type, event_date, section_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            schoolId,
            title, 
            slug, 
            content, 
            target_role || 'All', 
            image_path, 
            is_published === '1' ? 1 : 0,
            type || 'Announcement',
            (type === 'Event' && event_date) ? event_date : null,
            section_id || null
        ]);

        res.redirect('/announcements?success=Announcement created successfully');
    } catch (e) {
        console.error(e);
        res.redirect('/announcements?error=Failed to create announcement');
    }
};

exports.toggleAnnouncement = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    await db.run(
        `UPDATE announcements SET is_published = CASE WHEN is_published = 1 THEN 0 ELSE 1 END WHERE id = ? AND school_id = ?`,
        [req.params.id, schoolId]
    );
    res.redirect('/announcements');
};

exports.deleteAnnouncement = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    await db.run('DELETE FROM announcements WHERE id = ? AND school_id = ?', [req.params.id, schoolId]);
    res.redirect('/announcements?success=Announcement deleted');
};

exports.viewAnnouncement = async (req, res) => {
    const schoolId = req.schoolId || (req.school ? req.school.id : 1);
    const id = req.params.id;
    try {
        const announcement = await db.get('SELECT * FROM announcements WHERE id = ? AND school_id = ?', [id, schoolId]);
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


