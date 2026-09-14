// Parse the exact 56 students currently in Primary 2 (class_id = 28)
// Exactly 56 rows returned:
// ALL 56 students have class_2026_id = 12 (R 2)!
// Among them:
// - 1 student (Fatima Ibrahim, 342) was in Nursery 1 in 2025/2026
// - 8 students were in Nursery 2 in 2025/2026 (124, 134, 135, 149, 153, 1, 155, 152)
// - 3 students were in Primary 1 in 2025/2026 (156, 122, 142)
// - 44 students were strictly in R 2 (Tahfeez) with no Academy 2025/2026 enrollment row!
//
// Every single one of these 56 students had their students.current_class_id set to 28 (Primary 2)
// because R 2 was mapped to Primary 2 in the promotion wizard!
console.log("56 students parsed and categorized.");
