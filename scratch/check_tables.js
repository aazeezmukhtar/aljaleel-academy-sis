const db = require('../utils/db');
async function run() {
    try {
        const tables = await db.all("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
        console.log("TABLES:", tables);
        const sections = await db.all("SELECT * FROM sections");
        console.log("SECTIONS:", sections);
        const cols = await db.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sections'");
        console.log("SECTIONS COLUMNS:", cols);
        const result_configs = await db.all("SELECT table_name FROM information_schema.tables WHERE table_name = 'section_result_config'");
        console.log("section_result_config tables exists?", result_configs);
        if (result_configs.length > 0) {
            const configCols = await db.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'section_result_config'");
            console.log("section_result_config columns:", configCols);
            const sampleConfigs = await db.all("SELECT * FROM section_result_config LIMIT 5");
            console.log("section_result_config sample:", sampleConfigs);
        }
    } catch(err) {
        console.error(err);
    }
    process.exit(0);
}
run();
