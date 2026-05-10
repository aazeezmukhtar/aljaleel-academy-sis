const dns = require('dns').promises;

const projectRef = 'dimnweltbojljsgoskyp';
const hosts = [
    `db.${projectRef}.supabase.co`,
    `db.${projectRef}.supabase.com`,
    `${projectRef}.supabase.co`,
    `${projectRef}.supabase.com`
];

async function test() {
    for (const host of hosts) {
        try {
            const result = await dns.lookup(host);
            console.log(`✓ ${host} resolves to ${result.address}`);
        } catch (err) {
            console.log(`✗ ${host} failed: ${err.code}`);
        }
    }
}

test();
