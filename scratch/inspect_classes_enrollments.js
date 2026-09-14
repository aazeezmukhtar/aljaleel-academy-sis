const Database = require('better-sqlite3');
const db = new Database('database.sqlite', { readonly: true });

console.log('=== SECTIONS DETAIL ===');
const sections = db.prepare('SELECT * FROM sections').all();
sections.forEach(s => console.log(JSON.stringify(s)));

console.log('\n=== FULL CLASS LIST WITH SECTION AND SESSION ===');
const classes = db.prepare(`
  SELECT c.id, c.name, c.section_id, s.name as section_name, 
         s.current_session, s.current_term
  FROM classes c
  LEFT JOIN sections s ON c.section_id = s.id
  ORDER BY s.name, c.name
`).all();
classes.forEach(c => console.log(JSON.stringify(c)));

console.log('\n=== ALL student_enrollments WITH SESSION ===');
const se = db.prepare(`
  SELECT se.id, se.session, se.student_id, se.class_id,
         st.first_name || ' ' || st.last_name as student_name,
         st.status, st.current_class_id,
         c.name as class_name, c.section_id,
         s.name as section_name
  FROM student_enrollments se
  JOIN students st ON se.student_id = st.id
  JOIN classes c ON se.class_id = c.id
  LEFT JOIN sections s ON c.section_id = s.id
  ORDER BY se.session, s.name, c.name, st.last_name
`).all();
se.forEach(r => console.log(JSON.stringify(r)));
