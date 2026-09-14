const Database = require('better-sqlite3');
const db = new Database('database.sqlite', {readonly: true});

console.log('=== SECTIONS ===');
const sections = db.prepare('SELECT * FROM sections').all();
console.log(JSON.stringify(sections, null, 2));

console.log('\n=== STUDENT ENROLLMENTS BY SESSION ===');
const enrollments = db.prepare(`
  SELECT se.id, se.student_id, se.class_id, se.session,
         s.first_name || ' ' || s.last_name as student_name, 
         s.status as student_status, 
         s.current_class_id,
         cc.name as current_class_name,
         c.name as enrolled_class_name, 
         c.section_id,
         sec.name as section_name
  FROM student_enrollments se
  JOIN students s ON se.student_id = s.id
  JOIN classes c ON se.class_id = c.id
  LEFT JOIN classes cc ON s.current_class_id = cc.id
  LEFT JOIN sections sec ON c.section_id = sec.id
  ORDER BY se.session DESC, sec.name, c.name, s.last_name
`).all();
console.log(JSON.stringify(enrollments, null, 2));

console.log('\n=== ENROLLMENT COUNT BY CLASS/SESSION ===');
const summary = db.prepare(`
  SELECT se.session, sec.name as section_name, c.name as class_name, c.id as class_id,
         COUNT(DISTINCT se.student_id) as student_count
  FROM student_enrollments se
  JOIN classes c ON se.class_id = c.id
  LEFT JOIN sections sec ON c.section_id = sec.id
  ORDER BY se.session DESC, sec.name, c.name
`).all();
console.log(JSON.stringify(summary, null, 2));

console.log('\n=== STUDENTS WITH THEIR current_class_id ===');
const students = db.prepare(`
  SELECT s.id, s.first_name || ' ' || s.last_name as name, s.status, 
         s.current_class_id, c.name as current_class_name, c.section_id,
         sec.name as section_name
  FROM students s
  LEFT JOIN classes c ON s.current_class_id = c.id
  LEFT JOIN sections sec ON c.section_id = sec.id
  WHERE s.status = 'active'
  ORDER BY sec.name, c.name, s.last_name
`).all();
console.log(JSON.stringify(students, null, 2));
