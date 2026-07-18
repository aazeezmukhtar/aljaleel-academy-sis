// middleware/autoLogout.js
module.exports = function (req, res, next) {
  // Define routes that require an active session
  const protectedPrefixes = [
    '/dashboard', '/students', '/results', '/academics', '/staff',
    '/attendance', '/fees', '/settings', '/reports', '/portal'
  ];
  const isProtected = protectedPrefixes.some(p => req.path.startsWith(p));

  // If the route is protected and there is no valid session/user, redirect to login
  if (isProtected && (!req.session || !req.session.user)) {
    return res.redirect('/auth/login');
  }
  next();
};
