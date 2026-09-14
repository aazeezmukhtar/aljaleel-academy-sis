const assert = require('assert');
const {
    normalizeNigerianPhone,
    interpolateTemplate,
    generateAttendanceMessage,
    buildWhatsAppAttendanceAction
} = require('../utils/whatsappHelper');

console.log('--- Running WhatsApp & Attendance Notification Tests ---');

// Test 1: Valid Nigerian phone number formats
console.log('1. Valid Nigerian phone numbers:');
assert.strictEqual(normalizeNigerianPhone('08062418033'), '2348062418033');
assert.strictEqual(normalizeNigerianPhone('+2348062418033'), '2348062418033');
assert.strictEqual(normalizeNigerianPhone('2348062418033'), '2348062418033');
assert.strictEqual(normalizeNigerianPhone('080 6241 8033'), '2348062418033');
assert.strictEqual(normalizeNigerianPhone('+234-806-241-8033'), '2348062418033');
assert.strictEqual(normalizeNigerianPhone('07012345678'), '2347012345678');
assert.strictEqual(normalizeNigerianPhone('09098765432'), '2349098765432');
assert.strictEqual(normalizeNigerianPhone('08111223344'), '2348111223344');
assert.strictEqual(normalizeNigerianPhone('09123456789'), '2349123456789');
console.log('   ✓ All valid Nigerian phone numbers normalized to 234...');

// Test 2: Missing phone numbers
console.log('2. Missing phone numbers:');
assert.strictEqual(normalizeNigerianPhone(null), null);
assert.strictEqual(normalizeNigerianPhone(''), null);
assert.strictEqual(normalizeNigerianPhone('   '), null);
assert.strictEqual(normalizeNigerianPhone(undefined), null);
const missingAction = buildWhatsAppAttendanceAction({ parent_phone: null, total_absences: 12, consecutive_absences: 1 });
assert.strictEqual(missingAction.is_valid, false);
assert.strictEqual(missingAction.whatsapp_url, null);
console.log('   ✓ Missing phone numbers return null / invalid URL safely');

// Test 3: Invalid phone numbers
console.log('3. Invalid phone numbers:');
assert.strictEqual(normalizeNigerianPhone('12345'), null);
assert.strictEqual(normalizeNigerianPhone('abcdefghijk'), null);
assert.strictEqual(normalizeNigerianPhone('080123'), null); // too short
assert.strictEqual(normalizeNigerianPhone('00012345678'), null); // invalid prefix
const invalidAction = buildWhatsAppAttendanceAction({ parent_phone: '12345', total_absences: 12, consecutive_absences: 1 });
assert.strictEqual(invalidAction.is_valid, false);
assert.strictEqual(invalidAction.whatsapp_url, null);
console.log('   ✓ Invalid phone numbers return null / invalid URL safely');

// Test 4: Low attendance only wording
console.log('4. Low attendance only condition:');
const lowMsg = generateAttendanceMessage({
    total_absences: 12,
    consecutive_absences: 1,
    term_limit: 10,
    consecutive_limit: 3,
    context: {
        student_name: 'Fatima Mukhtar',
        class_name: 'Primary 2',
        term: '1st Term',
        session: '2025/2026',
        school_name: 'Al-Jaleel Academy'
    }
});
assert.ok(lowMsg.includes('12 days of absence during the current term'));
assert.ok(lowMsg.includes('Fatima Mukhtar'));
assert.ok(lowMsg.includes('Al-Jaleel Academy'));
assert.ok(!lowMsg.includes('consecutive days'));
console.log('   ✓ Low attendance message matches required wording');

// Test 5: Consecutive absenteeism only wording
console.log('5. Consecutive absenteeism only condition:');
const consecMsg = generateAttendanceMessage({
    total_absences: 4,
    consecutive_absences: 4,
    term_limit: 10,
    consecutive_limit: 3,
    context: {
        student_name: 'Umar Faruk',
        class_name: 'JSS 1',
        school_name: 'Al-Jaleel Academy'
    }
});
assert.ok(consecMsg.includes('absent from school for 4 consecutive days'));
assert.ok(consecMsg.includes('Umar Faruk'));
assert.ok(!consecMsg.includes('recorded 4 days of absence during the current term'));
console.log('   ✓ Consecutive absenteeism message matches required wording');

// Test 6: Both conditions wording
console.log('6. Both conditions combined wording:');
const bothMsg = generateAttendanceMessage({
    total_absences: 14,
    consecutive_absences: 5,
    term_limit: 10,
    consecutive_limit: 3,
    context: {
        student_name: 'Zainab Mukhtar',
        class_name: 'Nursery 2',
        school_name: 'Al-Jaleel Academy'
    }
});
assert.ok(bothMsg.includes('14 days of absence during the current term'));
assert.ok(bothMsg.includes('5 consecutive days of absence'));
assert.ok(bothMsg.includes('Zainab Mukhtar'));
console.log('   ✓ Both conditions combined into a single unified message');

// Test 7: Message URL encoding
console.log('7. WhatsApp URL encoding:');
const action = buildWhatsAppAttendanceAction({
    parent_phone: '08062418033',
    total_absences: 11,
    consecutive_absences: 2,
    term_limit: 10,
    consecutive_limit: 3,
    context: {
        student_name: 'Aliyu Bello',
        school_name: 'Al-Jaleel Academy'
    }
});
assert.strictEqual(action.is_valid, true);
assert.ok(action.whatsapp_url.startsWith('https://wa.me/2348062418033?text='));
assert.ok(!action.whatsapp_url.includes(' ')); // spaces must be encoded
assert.ok(action.whatsapp_url.includes('%20') || action.whatsapp_url.includes('%0A'));
console.log('   ✓ WhatsApp URL correctly structured and encoded');

// Test 8: Special characters in student name (apostrophes, hyphens, accents)
console.log('8. Names with special characters & apostrophes:');
const specialAction = buildWhatsAppAttendanceAction({
    parent_phone: '+234 806 241 8033',
    total_absences: 12,
    consecutive_absences: 4,
    term_limit: 10,
    consecutive_limit: 3,
    context: {
        student_name: "Abdul'Azeez O'Connor-Smith",
        school_name: 'Al-Jaleel & Sons Academy'
    }
});
assert.strictEqual(specialAction.is_valid, true);
assert.ok(specialAction.message.includes("Abdul'Azeez O'Connor-Smith"));
assert.ok(specialAction.whatsapp_url.includes(encodeURIComponent("Abdul'Azeez O'Connor-Smith")));
console.log('   ✓ Special characters safely encoded without URI distortion');

// Test 9: Future-proofing and template customization
console.log('9. Template customization & placeholders:');
const customMsg = generateAttendanceMessage({
    total_absences: 15,
    consecutive_absences: 0,
    term_limit: 10,
    consecutive_limit: 3,
    context: {
        student_name: 'Ibrahim',
        class_name: 'Tahfeez R 2',
        term: '2nd Term',
        session: '2026/2027',
        school_name: 'Darul Quran Institute',
        school_phone: '08000000000'
    },
    customTemplates: {
        LOW_ATTENDANCE: 'Custom alert for {student_name} in {class_name} ({term} {session}): {total_absences} absences. Call {school_phone}. - {school_name}'
    }
});
assert.strictEqual(
    customMsg,
    'Custom alert for Ibrahim in Tahfeez R 2 (2nd Term 2026/2027): 15 absences. Call 08000000000. - Darul Quran Institute'
);
console.log('   ✓ Custom school templates and all placeholders fully supported');

console.log('\nALL 9 TEST SUITES PASSED SUCCESSFULLY! ✓✓✓');
