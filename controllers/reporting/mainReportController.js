const getReportDashboard = (req, res) => {
    res.render('reports/index', {
        title: 'Report Center',
        user: req.session.staff
    });
};

module.exports = { getReportDashboard };
